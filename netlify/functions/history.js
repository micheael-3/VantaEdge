const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { requireTier } = require('./_shared/tier');

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

  const predictions = await sql()`
    SELECT id, league, fixture_id, home_team, away_team, kickoff,
           over_line, over_confidence, over_hit, btts, btts_confidence, btts_hit
    FROM predictions
    WHERE user_id = ${user.id} AND created_at >= ${since.toISOString()}
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
    if (path === '/accuracy') return await getAccuracy(event);
    return notFound();
  } catch (err) {
    console.error('history handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
