// VantaEdge — settle unscored predictions from API-Football final scores.
//
// Runs as a Netlify scheduled function every 2 hours. Selects predictions
// where over_hit IS NULL and kickoff is more than 90 minutes ago, groups by
// fixture_id so each match is fetched from API-Football exactly once, then
// updates every prediction row that points at that fixture.
//
// Manual trigger:
//   curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" \
//        "$SITE/api/results/update?dry=1"

const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const football = require('./_shared/football');

const SCHEDULE = '0 */2 * * *';

// API-Football fixture status codes that mean "final score is locked in".
const TERMINAL_STATUSES = new Set([
  'FT',  // Full Time
  'AET', // After Extra Time
  'PEN', // Penalty Shootout decided
  'AWD', // Awarded (rare)
  'WO',  // Walkover
]);

// Statuses that mean the match is cancelled — no result possible.
const VOID_STATUSES = new Set(['CANC', 'ABD', 'PST']); // Cancelled, Abandoned, Postponed

function isAuthorised(event) {
  if (!event.headers) return false;
  const h = event.headers;
  const isScheduled =
    h['x-nf-event'] === 'schedule' ||
    h['netlify-invocation-source'] === 'schedule' ||
    h['x-netlify-event'] === 'schedule';
  if (isScheduled) return true;
  const auth = h.authorization || h.Authorization || '';
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  return !!process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD;
}

function ninetyMinutesAgoIso() {
  const d = new Date();
  d.setUTCMinutes(d.getUTCMinutes() - 90);
  return d.toISOString();
}

function computeHits(fixture, overLine, bttsCall) {
  const home = fixture && fixture.goals && fixture.goals.home;
  const away = fixture && fixture.goals && fixture.goals.away;
  if (home == null || away == null) return null;
  const totalGoals = Number(home) + Number(away);
  const overHit = totalGoals > Number(overLine);
  // BTTS YES wins when both teams scored; BTTS NO wins when at least one didn't.
  const bothScored = Number(home) > 0 && Number(away) > 0;
  const isYes = String(bttsCall || 'YES').toUpperCase() === 'YES';
  const bttsHit = isYes ? bothScored : !bothScored;
  return { totalGoals, overHit, bttsHit, home: Number(home), away: Number(away) };
}

async function settleBatch({ dryRun = false } = {}) {
  const since = ninetyMinutesAgoIso();
  // Pull unsettled predictions older than now-90min. We dedupe by fixture_id
  // to make a single API call per fixture even when many users predicted it.
  const rows = await sql()`
    SELECT id, user_id, league, fixture_id, kickoff,
           over_line, over_confidence, btts, btts_confidence
    FROM predictions
    WHERE over_hit IS NULL
      AND kickoff <= ${since}
    ORDER BY kickoff ASC
    LIMIT 500`;

  const byFixture = new Map();
  for (const r of rows) {
    if (!byFixture.has(r.fixture_id)) byFixture.set(r.fixture_id, []);
    byFixture.get(r.fixture_id).push(r);
  }

  const report = {
    candidatesUnsettled: rows.length,
    fixturesQueried: 0,
    fixturesSettled: 0,
    fixturesPendingFt: 0,
    fixturesVoided: 0,
    fixturesMissingScore: 0,
    fixturesErrored: 0,
    predictionsUpdated: 0,
    examples: [],
  };

  for (const [fixtureId, preds] of byFixture.entries()) {
    report.fixturesQueried += 1;
    let fixture;
    try {
      fixture = await football.getFixtureById(fixtureId);
    } catch (err) {
      report.fixturesErrored += 1;
      console.error(`[results] fixture ${fixtureId} fetch failed:`, err.message);
      continue;
    }
    if (!fixture) {
      report.fixturesMissingScore += 1;
      continue;
    }
    const statusShort = fixture.fixture && fixture.fixture.status && fixture.fixture.status.short;

    if (VOID_STATUSES.has(statusShort)) {
      // Match was cancelled/postponed — null hits remain, but bump void counter.
      report.fixturesVoided += 1;
      continue;
    }
    if (!TERMINAL_STATUSES.has(statusShort)) {
      report.fixturesPendingFt += 1;
      continue;
    }

    // Each prediction for this fixture has its own over_line + btts call.
    for (const p of preds) {
      const calc = computeHits(fixture, p.over_line, p.btts);
      if (!calc) {
        report.fixturesMissingScore += 1;
        continue;
      }
      if (!dryRun) {
        await sql()`
          UPDATE predictions
          SET over_hit = ${calc.overHit}, btts_hit = ${calc.bttsHit}
          WHERE id = ${p.id}`;
      }
      report.predictionsUpdated += 1;
      if (report.examples.length < 5) {
        report.examples.push({
          fixtureId,
          match: `${fixture.teams && fixture.teams.home && fixture.teams.home.name} ${calc.home}-${calc.away} ${fixture.teams && fixture.teams.away && fixture.teams.away.name}`,
          line: p.over_line,
          overHit: calc.overHit,
          btts: p.btts,
          bttsHit: calc.bttsHit,
        });
      }
    }
    report.fixturesSettled += 1;
  }

  return report;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'results');
    const method = event.httpMethod;

    if (method === 'POST' && path === '/update') {
      if (!isAuthorised(event)) return error(401, 'UNAUTHORIZED');
      const qs = event.queryStringParameters || {};
      const dryRun = qs.dry === '1' || qs.dry === 'true';
      const report = await settleBatch({ dryRun });
      console.log('[results] batch report:', JSON.stringify(report));
      return json(200, report);
    }

    return notFound();
  } catch (err) {
    console.error('results handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};

// Scheduled metadata: every 2 hours on the hour.
exports.config = { schedule: SCHEDULE };
