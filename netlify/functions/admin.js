const { sql } = require('./_shared/db');
const { json, error, notFound, subPath, parseBody } = require('./_shared/response');
const { requireAdmin } = require('./_shared/admin-mw');
const { getQuotaSnapshot, isConfigured, listLeagueConfig, setLeagueEnabled } = require('./_shared/odds');
const { LEAGUES } = require('./_shared/tier');
const { getState, buildAgentStatus } = require('./_shared/agent');

function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function listUsers(_event) {
  const rows = await sql()`
    SELECT u.id, u.email, u.tier, u.created_at,
           COALESCE(COUNT(p.id), 0)::int AS total_predictions
    FROM users u
    LEFT JOIN predictions p ON p.user_id = u.id
    GROUP BY u.id, u.email, u.tier, u.created_at
    ORDER BY u.created_at DESC`;
  return json(200, {
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      tier: r.tier,
      createdAt: r.created_at,
      totalPredictions: Number(r.total_predictions),
    })),
  });
}

async function listPredictionsToday(_event) {
  const since = startOfTodayUtc();
  const rows = await sql()`
    SELECT id, league, home_team, away_team, kickoff,
           over_line, over_confidence, btts, btts_confidence, created_at
    FROM predictions
    WHERE created_at >= ${since}
    ORDER BY created_at DESC
    LIMIT 1000`;
  return json(200, {
    predictions: rows.map((p) => ({
      id: p.id,
      league: p.league,
      homeTeam: p.home_team,
      awayTeam: p.away_team,
      kickoff: p.kickoff,
      overLine: p.over_line,
      overConfidence: p.over_confidence,
      btts: p.btts,
      bttsConfidence: p.btts_confidence,
      createdAt: p.created_at,
    })),
  });
}

async function stats(_event) {
  const since = startOfTodayUtc();
  const [userCountRow] = await sql()`SELECT COUNT(*)::int AS n FROM users`;
  const [predTodayRow] = await sql()`SELECT COUNT(*)::int AS n FROM predictions WHERE created_at >= ${since}`;
  const [predAllRow] = await sql()`SELECT COUNT(*)::int AS n FROM predictions`;
  const perLeague = await sql()`
    SELECT league, COUNT(*)::int AS count
    FROM predictions
    GROUP BY league
    ORDER BY count DESC`;
  return json(200, {
    totalUsers: Number(userCountRow.n),
    totalPredictionsToday: Number(predTodayRow.n),
    totalPredictionsAllTime: Number(predAllRow.n),
    perLeague: perLeague.map((r) => ({ league: r.league, count: Number(r.count) })),
  });
}

async function loginPing(event) {
  // Lets the frontend verify the password without leaking any data.
  // requireAdmin already ran in the handler before this is reached.
  void event;
  return json(200, { ok: true });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const gate = requireAdmin(event);
    if (gate) return gate;

    const path = subPath(event, 'admin');
    const method = event.httpMethod;

    if (method === 'GET' && path === '/users') return await listUsers(event);
    if (method === 'GET' && path === '/predictions') return await listPredictionsToday(event);
    if (method === 'GET' && path === '/stats') return await stats(event);
    if (method === 'GET' && path === '/odds-quota') {
      return json(200, { oddsConfigured: isConfigured(), quota: getQuotaSnapshot() });
    }
    if (method === 'GET' && path === '/odds-config') {
      const rows = await listLeagueConfig();
      const enriched = rows.map((r) => ({
        ...r,
        name: LEAGUES[r.leagueId] ? LEAGUES[r.leagueId].name : `League ${r.leagueId}`,
      }));
      return json(200, { leagues: enriched });
    }
    if (method === 'POST' && path === '/odds-config') {
      const body = parseBody(event);
      const leagueId = parseInt(body.leagueId, 10);
      if (!leagueId || !LEAGUES[leagueId]) return error(400, 'Invalid leagueId');
      const enabled = !!body.enabled;
      await setLeagueEnabled(leagueId, enabled);
      return json(200, { leagueId, enabled });
    }
    if (method === 'GET' && path === '/agent') {
      const status = await buildAgentStatus();
      const reportKeys = [
        'scanner_last_report',
        'odds_monitor_last_report',
        'results_last_report',
        'accuracy_last_report',
        'alerts_last_report',
        'best_bet_last_report',
      ];
      const reports = {};
      for (const k of reportKeys) reports[k] = await getState(k);

      const sharp = await sql()`
        SELECT fixture_id, league, home_team, away_team, market, line, opening_odds, current_odds,
               movement_pct, bookmaker, significance, detected_at
        FROM odds_movements
        WHERE is_sharp_move = TRUE AND detected_at >= NOW() - INTERVAL '24 hours'
        ORDER BY detected_at DESC
        LIMIT 50`;
      const recentAlerts = await sql()`
        SELECT id, type, severity, message, processed, created_at
        FROM agent_alerts
        ORDER BY created_at DESC
        LIMIT 50`;
      return json(200, { status, reports, sharp, recentAlerts });
    }
    if (method === 'POST' && path === '/agent/trigger') {
      const body = parseBody(event);
      const name = String(body.name || '');
      const validNames = new Set(['agent-scanner', 'agent-odds-monitor', 'agent-results', 'agent-accuracy', 'agent-alerts', 'agent-best-bet']);
      if (!validNames.has(name)) return error(400, 'Unknown agent name');
      // Manual triggers re-use the admin password for upstream auth.
      const fn = require(`./${name}`);
      const inv = await fn.handler({
        httpMethod: 'POST',
        headers: { authorization: `Bearer ${process.env.ADMIN_PASSWORD || ''}` },
        queryStringParameters: {},
      });
      return json(200, { triggered: name, response: inv && JSON.parse(inv.body || '{}') });
    }
    if (method === 'POST' && path === '/login') return await loginPing(event);

    return notFound();
  } catch (err) {
    console.error('admin handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
