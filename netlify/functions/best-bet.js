const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { readCookies } = require('./_shared/cookies');
const { verifyAccess } = require('./_shared/jwt');

function todayStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function detectUserTier(event) {
  try {
    const cookies = readCookies(event);
    if (!cookies.accessToken) return null;
    const decoded = verifyAccess(cookies.accessToken);
    return decoded.tier || 'FREE';
  } catch {
    return null;
  }
}

async function computeBestBet() {
  const today = todayStr();

  // Return cached daily pick if we already locked one in today.
  const cached = await sql()`SELECT * FROM best_bet WHERE date = ${today}`;
  if (cached.length) return cached[0];

  // Otherwise score every prediction created today by the same formula and
  // pick the best. Confidence is always required (>=70); EV is optional and
  // tightens the threshold when present.
  const candidates = await sql()`
    SELECT id, league, home_team, away_team, kickoff, over_line, over_confidence, ev_edge_over,
           (over_confidence * 0.6 + COALESCE(ev_edge_over, 0) * 0.4) AS score
    FROM predictions
    WHERE created_at >= ${startOfTodayIso()}
      AND over_confidence >= 70
      AND (ev_edge_over IS NULL OR ev_edge_over >= 8)
    ORDER BY score DESC
    LIMIT 1`;

  if (candidates.length === 0) return null;

  const c = candidates[0];
  await sql()`
    INSERT INTO best_bet (date, prediction_id, league, home_team, away_team, bet_type,
                          line, confidence, ev_edge, score, kickoff)
    VALUES (${today}, ${c.id}, ${c.league}, ${c.home_team}, ${c.away_team}, 'OVER',
            ${c.over_line}, ${c.over_confidence}, ${c.ev_edge_over}, ${c.score}, ${c.kickoff})
    ON CONFLICT (date) DO NOTHING`;

  return c;
}

function shapeForTier(row, tier) {
  if (!row) return null;
  const base = {
    date: row.date || todayStr(),
    league: row.league,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    betType: row.bet_type || 'OVER',
    line: row.line ?? row.over_line ?? null,
    kickoff: row.kickoff || null,
  };
  // FREE users get a teaser — match and bet type only.
  if (!tier || tier === 'FREE') {
    return { ...base, teaser: true };
  }
  return {
    ...base,
    teaser: false,
    confidence: row.confidence ?? row.over_confidence ?? null,
    evEdge: row.ev_edge ?? row.ev_edge_over ?? null,
    score: row.score ?? null,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');
    const tier = detectUserTier(event);
    const row = await computeBestBet();
    return json(200, { bestBet: shapeForTier(row, tier), tier });
  } catch (err) {
    console.error('best-bet handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
