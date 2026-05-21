const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { requireTier } = require('./_shared/tier');
const { bucketFor, bucketCenter, BUCKET_LABELS } = require('./_shared/calibration');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function pct(numer, denom) {
  if (!denom) return 0;
  return Math.round((numer / denom) * 1000) / 10;
}

function resolveWindow(windowKey, tier) {
  const k = String(windowKey || '').toLowerCase();
  if (k === 'today') return { since: startOfTodayUtc(), label: 'today' };
  if (k === 'week') return { since: daysAgo(7), label: '7d' };
  if (k === 'month') return { since: daysAgo(30), label: '30d' };
  if (k === 'all') return { since: new Date(0), label: 'all' };
  // Default: 30 days for ANALYST, all-time for EDGE.
  return tier === 'EDGE' ? { since: new Date(0), label: 'all' } : { since: daysAgo(30), label: '30d' };
}

async function getHistory(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const qs = event.queryStringParameters || {};
  const { since, label: windowLabel } = resolveWindow(qs.window, user.tier);

  // Excluded from accuracy stats because we never surfaced this as a pick.
  // Hidden ≠ wrong. When BOTH calibrated/raw confidences are <60 the
  // MatchCard renders a neutral "AI not confident — skip" chip and never
  // shows a prediction badge, so it would be unfair to count those rows
  // against (or for) the model's hit rate. We still keep the rows in the
  // table for audit; we just filter them out here.
  const predictions = await sql()`
    SELECT id, league, fixture_id, home_team, away_team, kickoff,
           over_line, over_confidence, over_hit, btts, btts_confidence, btts_hit
    FROM predictions
    WHERE user_id = ${user.id} AND created_at >= ${since.toISOString()}
      AND (over_confidence >= 60 OR btts_confidence >= 60)
    ORDER BY kickoff DESC`;

  // Settled = has a Boolean result on either side. Pending = neither yet.
  const overSettled = predictions.filter((p) => p.over_hit !== null);
  const overHits = overSettled.filter((p) => p.over_hit === true).length;
  const bttsSettled = predictions.filter((p) => p.btts_hit !== null);
  const bttsHits = bttsSettled.filter((p) => p.btts_hit === true).length;

  const totalSettledRows = predictions.filter(
    (p) => p.over_hit !== null || p.btts_hit !== null,
  ).length;
  const pendingRows = predictions.length - totalSettledRows;

  const totalHits = overHits + bttsHits;
  const totalSettledMarkets = overSettled.length + bttsSettled.length;

  // Per-league summary — counts settled-only.
  const byLeague = {};
  for (const p of predictions) {
    if (!byLeague[p.league]) {
      byLeague[p.league] = {
        league: p.league,
        predictions: 0,
        settled: 0,
        hits: 0,
      };
    }
    const row = byLeague[p.league];
    row.predictions += 1;
    if (p.over_hit !== null) {
      row.settled += 1;
      if (p.over_hit === true) row.hits += 1;
    }
    if (p.btts_hit !== null) {
      row.settled += 1;
      if (p.btts_hit === true) row.hits += 1;
    }
  }
  const leagueRows = Object.values(byLeague).map((row) => ({
    ...row,
    accuracy: pct(row.hits, row.settled),
  }));

  let bestLeague = null;
  for (const row of leagueRows) {
    if (row.settled < 3) continue; // ignore tiny samples
    if (!bestLeague || row.accuracy > bestLeague.accuracy) bestLeague = row;
  }

  // Rolling daily accuracy from settled markets only.
  const byDay = {};
  for (const p of predictions) {
    const day = new Date(p.kickoff).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, settled: 0, hits: 0 };
    if (p.over_hit !== null) {
      byDay[day].settled += 1;
      if (p.over_hit === true) byDay[day].hits += 1;
    }
    if (p.btts_hit !== null) {
      byDay[day].settled += 1;
      if (p.btts_hit === true) byDay[day].hits += 1;
    }
  }
  const rolling = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, accuracy: pct(d.hits, d.settled), settled: d.settled }));

  return json(200, {
    summary: {
      window: windowLabel,
      totalPredictions: predictions.length,
      settledMarkets: totalSettledMarkets,
      pendingRows,
      overallAccuracy: pct(totalHits, totalSettledMarkets),
      overAccuracy: pct(overHits, overSettled.length),
      overSettled: overSettled.length,
      overHits,
      bttsAccuracy: pct(bttsHits, bttsSettled.length),
      bttsSettled: bttsSettled.length,
      bttsHits,
      bestLeague: bestLeague ? bestLeague.league : null,
    },
    leagues: leagueRows,
    rolling,
    // Recent table only shows SETTLED rows. Pending predictions clutter
    // the list with rows that have no verdict yet — users find it
    // confusing. Aggregate stats above still count everything correctly.
    recent: predictions
      .filter((p) => p.over_hit !== null || p.btts_hit !== null)
      .slice(0, 50)
      .map((p) => ({
        id: p.id,
        date: p.kickoff,
        league: p.league,
        match: `${p.home_team} vs ${p.away_team}`,
        overLine: p.over_line,
        overConfidence: p.over_confidence,
        overHit: p.over_hit,
        btts: p.btts,
        bttsConfidence: p.btts_confidence,
        bttsHit: p.btts_hit,
      })),
  });
}

// GET /api/history/calibration
//
// Returns the per-bucket hit rate for both markets from the SETTLED rows of
// the calling user. The History page charts the gap between each bucket's
// claimed confidence (bucket centre, 55/65/75/85/95) and the bucket's actual
// hit rate, so the bettor can see where the model is over- or
// under-confident.
async function getCalibration(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  // Excluded from accuracy stats because we never surfaced this as a pick.
  // Hidden ≠ wrong. Same filter as getHistory() above.
  const rows = await sql()`
    SELECT over_confidence, over_hit, btts_confidence, btts_hit
    FROM predictions
    WHERE user_id = ${user.id}
      AND (over_hit IS NOT NULL OR btts_hit IS NOT NULL)
      AND (over_confidence >= 60 OR btts_confidence >= 60)`;

  // Build empty bucket scaffolds so the chart always renders five bars
  // (including ones with zero samples — they just render as 0%).
  function emptyBuckets() {
    return BUCKET_LABELS.map((label) => ({
      label,
      predicted: 0,
      hits: 0,
      hitRate: 0,
      expected: Math.round((bucketCenter(label) || 0) * 100),
    }));
  }
  const over = emptyBuckets();
  const btts = emptyBuckets();
  const overByLabel = Object.fromEntries(over.map((b) => [b.label, b]));
  const bttsByLabel = Object.fromEntries(btts.map((b) => [b.label, b]));

  let samples = 0;
  for (const r of rows) {
    if (r.over_hit !== null && r.over_confidence != null) {
      const lbl = bucketFor(Number(r.over_confidence));
      if (lbl && overByLabel[lbl]) {
        overByLabel[lbl].predicted += 1;
        if (r.over_hit === true) overByLabel[lbl].hits += 1;
        samples += 1;
      }
    }
    if (r.btts_hit !== null && r.btts_confidence != null) {
      const lbl = bucketFor(Number(r.btts_confidence));
      if (lbl && bttsByLabel[lbl]) {
        bttsByLabel[lbl].predicted += 1;
        if (r.btts_hit === true) bttsByLabel[lbl].hits += 1;
        samples += 1;
      }
    }
  }
  for (const b of over) {
    b.hitRate = b.predicted ? Math.round((b.hits / b.predicted) * 1000) / 10 : 0;
  }
  for (const b of btts) {
    b.hitRate = b.predicted ? Math.round((b.hits / b.predicted) * 1000) / 10 : 0;
  }

  return json(200, {
    samples,
    over: { buckets: over },
    btts: { buckets: btts },
  });
}

// GET /api/history/streak
//
// Returns the user's current consecutive WIN streak across their logged
// bankroll entries (the most concrete signal of "am I winning?"). When the
// user hasn't logged any settled bets yet we fall back to counting
// consecutive AI prediction hits — picks where EITHER market hit count as
// a hit; we only break the streak when the most recent settled row
// recorded zero hits. Auth-required, NO tier gate (FREE users still see it).
async function getStreak(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  // Try bankroll first — actual won/lost bets the user logged.
  const betRows = await sql()`
    SELECT result FROM bankroll_entries
    WHERE user_id = ${user.id} AND type = 'BET' AND result IS NOT NULL AND result <> 'PENDING'
    ORDER BY created_at DESC
    LIMIT 100`;

  let streak = 0;
  if (betRows.length > 0) {
    for (const row of betRows) {
      if (row.result === 'WIN') streak += 1;
      else break;
    }
    return json(200, { streak, source: 'bankroll' });
  }

  // Fallback: AI prediction hits for picks we actually surfaced (conf >= 60).
  // A row counts as a "hit" if either market hit. A row breaks the streak
  // when neither market hit (both false) — pending rows are ignored.
  const predRows = await sql()`
    SELECT over_hit, btts_hit, over_confidence, btts_confidence
    FROM predictions
    WHERE user_id = ${user.id}
      AND (over_hit IS NOT NULL OR btts_hit IS NOT NULL)
      AND (over_confidence >= 60 OR btts_confidence >= 60)
    ORDER BY kickoff DESC
    LIMIT 100`;
  for (const r of predRows) {
    const oneHit = r.over_hit === true || r.btts_hit === true;
    if (oneHit) streak += 1;
    else break;
  }
  return json(200, { streak, source: 'predictions' });
}

async function getAccuracy(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const rows = await sql()`SELECT id, date, total_predictions AS "totalPredictions", hits, accuracy, league
                           FROM prediction_history
                           WHERE user_id = ${user.id}
                           ORDER BY date ASC`;
  return json(200, { rows });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');

    const path = subPath(event, 'history');
    if (path === '/' || path === '') return await getHistory(event);
    if (path === '/streak' || path === '/streak/') return await getStreak(event);
    if (path === '/accuracy') return await getAccuracy(event);
    if (path === '/calibration' || path === '/calibration/') return await getCalibration(event);
    return notFound();
  } catch (err) {
    console.error('history handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
