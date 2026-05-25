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

  // MLS-only build: predictions are shared across all users (the scan
  // stores them against the first admin's user_id as an owner; everyone
  // reads the same rows). Filter by league instead of user_id so a user
  // who DIDN'T own the scan still sees the results. Matches the
  // /api/predictions/week shape used by Dashboard.
  //
  // The confidence filter has been split: we no longer drop low-confidence
  // rows from the SELECT, because that hides recovered rows (which have
  // confidence=0 as a "no AI prediction" sentinel) from the Results
  // table. Instead we keep all rows here and apply the confidence floor
  // only to the hit-rate math below — so recovered rows show up in the
  // Recent list with their FT score but don't pollute the calibration
  // numbers.
  void user;
  // Try with home_goals/away_goals (added in run-migration.sql). On
  // 42703 fall back to the legacy column set — recovered rows still
  // surface, the FT score chip just won't render until migration runs.
  let predictions;
  try {
    predictions = await sql()`
      SELECT id, league, fixture_id, home_team, away_team, kickoff,
             over_line, over_confidence, over_hit, btts, btts_confidence, btts_hit,
             match_data, home_goals, away_goals
      FROM predictions
      WHERE kickoff >= ${since.toISOString()}
      ORDER BY kickoff DESC`;
  } catch (err) {
    if (err && (err.code === '42703' || /column .* does not exist/i.test(err.message || ''))) {
      predictions = await sql()`
        SELECT id, league, fixture_id, home_team, away_team, kickoff,
               over_line, over_confidence, over_hit, btts, btts_confidence, btts_hit,
               match_data
        FROM predictions
        WHERE kickoff >= ${since.toISOString()}
        ORDER BY kickoff DESC`;
    } else {
      throw err;
    }
  }

  // Belt-and-braces dedup: even after run-migration.sql adds the
  // UNIQUE (fixture_id) constraint, there's a window where pre-migration
  // duplicates still exist. Collapse here by keeping the highest-
  // confidence row per fixture_id so the summary count reflects reality
  // and "2 from 2 correct" never shows a 50-row inflated total.
  const byFixture = new Map();
  for (const p of predictions) {
    const key = p.fixture_id;
    if (!key) continue;
    const existing = byFixture.get(key);
    const score = Math.max(Number(p.over_confidence) || 0, Number(p.btts_confidence) || 0);
    const existingScore = existing
      ? Math.max(Number(existing.over_confidence) || 0, Number(existing.btts_confidence) || 0)
      : -1;
    if (!existing || score > existingScore) byFixture.set(key, p);
  }
  const uniquePredictions = Array.from(byFixture.values()).sort(
    (a, b) => new Date(b.kickoff) - new Date(a.kickoff),
  );

  // Rate-eligible rows: every prediction that has a real AI verdict.
  // The "real" filter is the confidence sentinel — recovered placeholder
  // rows from /api/admin/recover-history have confidence = 0 and should
  // stay out of the hit-rate math. Everything else counts, including
  // 53-58% picks, because the dashboard renders them and they reflect
  // real model output.
  //
  // (Previous filter required confidence >= 60. That was right when
  // MatchCard hid sub-60 cards from the dashboard, so they didn't show
  // up as "picks the AI made". MatchCard now renders down to 50, so the
  // filter was hiding 10 of every 12 settled rows from the stats while
  // leaving them visible in the Recent table — wildly inconsistent.)
  const rateEligible = uniquePredictions.filter(
    (p) => Number(p.over_confidence) > 0 || Number(p.btts_confidence) > 0,
  );

  // Settled = has a Boolean result on either side. Pending = neither yet.
  const overSettled = rateEligible.filter((p) => p.over_hit !== null);
  const overHits = overSettled.filter((p) => p.over_hit === true).length;
  const bttsSettled = rateEligible.filter((p) => p.btts_hit !== null);
  const bttsHits = bttsSettled.filter((p) => p.btts_hit === true).length;

  const totalSettledRows = uniquePredictions.filter(
    (p) => p.over_hit !== null || p.btts_hit !== null,
  ).length;
  const pendingRows = uniquePredictions.length - totalSettledRows;

  const totalHits = overHits + bttsHits;
  const totalSettledMarkets = overSettled.length + bttsSettled.length;

  // Per-league summary — counts settled-only.
  const byLeague = {};
  for (const p of uniquePredictions) {
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
  for (const p of uniquePredictions) {
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
      totalPredictions: uniquePredictions.length,
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
    recent: uniquePredictions
      .filter((p) => p.over_hit !== null || p.btts_hit !== null)
      .slice(0, 50)
      .map((p) => {
        // Detect recovered rows via the match_data.recovered flag set by
        // /api/admin/recover-history. The frontend renders these with a
        // distinct "RECOVERED · NO AI PREDICTION" badge so the user
        // knows the score is real but the AI call is a placeholder.
        let recovered = false;
        try {
          const md = typeof p.match_data === 'string' ? JSON.parse(p.match_data) : (p.match_data || {});
          recovered = !!(md && md.recovered);
        } catch { /* ignore */ }
        return {
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
          // Real goal counts when available — populated by the upgraded
          // settle path and by /api/admin/recover-history. Lets the
          // Results card render "FT 2-1" alongside the AI verdict.
          homeGoals: p.home_goals != null ? Number(p.home_goals) : null,
          awayGoals: p.away_goals != null ? Number(p.away_goals) : null,
          recovered,
        };
      }),
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

  // MLS-only shared scan rows — filter by league, not user_id (matches
  // getHistory above). Exclude only the recovered placeholder rows
  // (confidence = 0) — they have no AI verdict to evaluate. Every real
  // AI prediction counts in the calibration buckets, even 53-58% picks,
  // so the bucket centred on "50-60" actually has samples.
  void user;
  const rows = await sql()`
    SELECT over_confidence, over_hit, btts_confidence, btts_hit
    FROM predictions
    WHERE (over_hit IS NOT NULL OR btts_hit IS NOT NULL)
      AND (over_confidence > 0 OR btts_confidence > 0)`;

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

  // Fallback: AI prediction hits across every real settled pick.
  // Excludes only recovered placeholder rows (confidence = 0). A row
  // counts as a "hit" if either market hit. A row breaks the streak
  // when neither market hit (both false) — pending rows are ignored.
  const predRows = await sql()`
    SELECT over_hit, btts_hit, over_confidence, btts_confidence
    FROM predictions
    WHERE league = 'MLS'
      AND (over_hit IS NOT NULL OR btts_hit IS NOT NULL)
      AND (over_confidence > 0 OR btts_confidence > 0)
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
