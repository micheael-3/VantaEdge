const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { requireTier } = require('./_shared/tier');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function getHistory(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const gate = requireTier(user, 'ANALYST');
  if (gate) return gate;

  const isEdge = user.tier === 'EDGE';
  const since = isEdge ? new Date(0) : daysAgo(30);

  const predictions = await sql()`
    SELECT id, league, fixture_id, home_team, away_team, kickoff,
           over_line, over_confidence, over_hit, btts, btts_confidence, btts_hit
    FROM predictions
    WHERE user_id = ${user.id} AND created_at >= ${since.toISOString()}
    ORDER BY kickoff DESC`;

  const settled = predictions.filter((p) => p.over_hit !== null || p.btts_hit !== null);
  const overHits = settled.filter((p) => p.over_hit === true).length;
  const totalOver = settled.filter((p) => p.over_hit !== null).length;
  const bttsHits = settled.filter((p) => p.btts_hit === true).length;
  const totalBtts = settled.filter((p) => p.btts_hit !== null).length;

  const byLeague = {};
  for (const p of predictions) {
    if (!byLeague[p.league]) byLeague[p.league] = { league: p.league, predictions: 0, hits: 0 };
    byLeague[p.league].predictions += 1;
    if (p.over_hit === true) byLeague[p.league].hits += 1;
  }
  const leagueRows = Object.values(byLeague).map((row) => ({
    ...row,
    accuracy: row.predictions ? Math.round((row.hits / row.predictions) * 1000) / 10 : 0,
  }));

  let bestLeague = null;
  for (const row of leagueRows) {
    if (!bestLeague || row.accuracy > bestLeague.accuracy) bestLeague = row;
  }

  const byDay = {};
  for (const p of predictions) {
    const day = new Date(p.kickoff).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, total: 0, hits: 0 };
    byDay[day].total += 1;
    if (p.over_hit === true) byDay[day].hits += 1;
  }
  const rolling = Object.values(byDay)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, accuracy: d.total ? Math.round((d.hits / d.total) * 1000) / 10 : 0 }));

  const overall =
    totalOver + totalBtts > 0
      ? Math.round(((overHits + bttsHits) / (totalOver + totalBtts)) * 1000) / 10
      : 0;

  return json(200, {
    summary: {
      totalPredictions: predictions.length,
      overallAccuracy: overall,
      bestLeague: bestLeague ? bestLeague.league : null,
      windowDays: isEdge ? null : 30,
    },
    leagues: leagueRows,
    rolling,
    recent: predictions.slice(0, 50).map((p) => ({
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
