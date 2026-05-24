// agent-autopsy — daily 4 AM Cyprus.
//
// For every prediction settled in the last 24 hours, ask Claude:
//   "you predicted X. The result was Y. Why were you right/wrong?
//    Write ONE concrete rule that should apply to similar matches."
//
// Stores the autopsy in prediction_autopsy and, when the rule's
// self-rated confidence is >= 70, inserts it into learned_rules so the
// next prediction round picks it up via _shared/learned-rules.
//
// Sport-agnostic: loops over activeSports() from _shared/sports.js.
// MLS today; UFC / CL / World Cup the moment they're added to that
// config.

const axios = require('axios');
const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');
const { markRun, setState } = require('./_shared/agent');
const { activeSports, findByLeagueLabel } = require('./_shared/sports');
const { insertRule } = require('./_shared/learned-rules');

const SCHEDULE = '0 4 * * *';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-sonnet-4-5';

const SYSTEM_PROMPT = (
  `You are reviewing a sports prediction post-match. The prediction has been ` +
  `settled with a real result. Your job is to write a brief, useful autopsy.\n\n` +
  `Be specific. Cite numbers from the data you were given. Identify which ` +
  `data points were actually predictive vs which misled the model. Then ` +
  `propose ONE concrete rule that, if applied to similar future matches, ` +
  `would have produced a better verdict.\n\n` +
  `Return ONLY valid JSON with this shape:\n` +
  `{\n` +
  `  "wasCorrect": boolean,\n` +
  `  "primaryReason": string,\n` +
  `  "misleadingFactors": string[],\n` +
  `  "newRule": {\n` +
  `    "condition": string,\n` +
  `    "adjustment": string,\n` +
  `    "confidence": number\n` +
  `  } | null\n` +
  `}\n\n` +
  `Rules:\n` +
  `  • condition: a precise machine-readable predicate (e.g. ` +
  `'referee_avg_goals < 2.0 AND h2h_under_rate > 0.6').\n` +
  `  • adjustment: a concrete action (e.g. ` +
  `'reduce over line by 1 step, cut confidence by 15%').\n` +
  `  • confidence: 0-100, how confident you are this rule generalises. ` +
  `Only rules >= 70 get stored. Be honest — if the result was random ` +
  `variance, return newRule: null.\n` +
  `  • Output JSON only. No markdown.`
);

function isMissingTableErr(err) {
  return err && (err.code === '42P01' || /relation .* does not exist/i.test(err.message || ''));
}

function safeParseJSON(text) {
  if (!text) return null;
  const t = String(text).trim();
  try { return JSON.parse(t); } catch { /* try slicing */ }
  const i = t.indexOf('{'); const j = t.lastIndexOf('}');
  if (i !== -1 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
  }
  return null;
}

async function callClaude(userMessage) {
  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Title': 'FastScore Autopsy',
  };
  if (process.env.URL) headers['HTTP-Referer'] = process.env.URL;
  const res = await axios.post(OPENROUTER_URL, {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 500,
  }, { headers, timeout: 25000 });
  return res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
    ? res.data.choices[0].message.content
    : null;
}

function buildUserMessage(p, md) {
  const matchLabel = `${p.home_team} vs ${p.away_team}`;
  const overOutcome = p.over_hit === true ? 'HIT' : p.over_hit === false ? 'MISS' : 'PENDING';
  const bttsOutcome = p.btts_hit === true ? 'HIT' : p.btts_hit === false ? 'MISS' : 'PENDING';
  const scoreLine = (p.home_goals != null && p.away_goals != null)
    ? `${p.home_goals}-${p.away_goals}`
    : 'unknown';
  return [
    `Match: ${matchLabel}`,
    `League: ${p.league}`,
    `Kickoff: ${p.kickoff}`,
    `Final score: ${scoreLine}`,
    ``,
    `Your prediction at scan time:`,
    `  Over ${p.over_line} @ ${p.over_confidence}% — ${overOutcome}`,
    `  BTTS ${p.btts} @ ${p.btts_confidence}% — ${bttsOutcome}`,
    ``,
    `Data you used:`,
    JSON.stringify(md || {}, null, 2),
    ``,
    `Write the autopsy + one rule. JSON only.`,
  ].join('\n');
}

async function autopsyForSport(sport) {
  if (!process.env.OPENROUTER_API_KEY) {
    return { sport: sport.id, skipped: 'no OPENROUTER_API_KEY' };
  }
  let rows;
  try {
    rows = await sql()`
      SELECT id, league, fixture_id, home_team, away_team, kickoff,
             over_line, over_confidence, over_hit, btts, btts_confidence, btts_hit,
             home_goals, away_goals, match_data
      FROM predictions
      WHERE LOWER(league) = ${sport.name.toLowerCase()}
        AND settled_at IS NOT NULL
        AND settled_at >= NOW() - INTERVAL '24 hours'
        AND id NOT IN (SELECT prediction_id FROM prediction_autopsy WHERE prediction_id IS NOT NULL)
      ORDER BY settled_at DESC
      LIMIT 25`;
  } catch (err) {
    if (isMissingTableErr(err)) {
      return { sport: sport.id, skipped: 'prediction_autopsy table missing — run run-migration.sql' };
    }
    return { sport: sport.id, error: err.message };
  }

  const out = { sport: sport.id, league: sport.name, scanned: rows.length, written: 0, rulesAdded: 0, errors: [] };

  for (const p of rows) {
    let md = {};
    try {
      md = typeof p.match_data === 'string' ? JSON.parse(p.match_data) : (p.match_data || {});
    } catch { /* leave as {} */ }

    let parsed = null;
    try {
      const text = await callClaude(buildUserMessage(p, md));
      parsed = safeParseJSON(text);
    } catch (err) {
      out.errors.push({ predictionId: p.id, stage: 'claude', error: err.message });
      continue;
    }
    if (!parsed) {
      out.errors.push({ predictionId: p.id, stage: 'parse', error: 'non-JSON response' });
      continue;
    }

    // Persist the autopsy. Best-effort INSERT — if it fails we log and move on.
    try {
      await sql()`
        INSERT INTO prediction_autopsy
          (prediction_id, sport, league, was_correct, primary_reason, misleading_factors, raw_response)
        VALUES
          (${p.id}, ${sport.id}, ${sport.name},
           ${typeof parsed.wasCorrect === 'boolean' ? parsed.wasCorrect : null},
           ${parsed.primaryReason || null},
           ${parsed.misleadingFactors ? JSON.stringify(parsed.misleadingFactors) : null}::jsonb,
           ${JSON.stringify(parsed)}::jsonb)`;
      out.written += 1;
    } catch (err) {
      out.errors.push({ predictionId: p.id, stage: 'insert-autopsy', error: err.message });
      continue;
    }

    // If the model's rule confidence clears the 70 threshold, store the
    // rule so subsequent predictions get it in their Analyst prompt.
    const nr = parsed.newRule;
    if (nr && typeof nr.condition === 'string' && typeof nr.adjustment === 'string') {
      const ruleConf = Number(nr.confidence) || 0;
      if (ruleConf >= 70) {
        const ruleId = await insertRule({
          sport: sport.id,
          league: sport.name,
          condition: nr.condition.slice(0, 500),
          adjustment: nr.adjustment.slice(0, 500),
          confidence: Math.min(100, Math.max(0, Math.round(ruleConf))),
          source: 'autopsy',
        });
        if (ruleId) out.rulesAdded += 1;
      }
    }
  }

  return out;
}

async function run() {
  const t0 = Date.now();
  const sports = activeSports();
  const reports = [];
  for (const sport of sports) {
    try {
      reports.push(await autopsyForSport(sport));
    } catch (err) {
      reports.push({ sport: sport.id, error: err.message });
    }
  }
  const report = { durationMs: Date.now() - t0, sports: reports };
  try {
    await markRun('autopsy_last_run');
    await setState('autopsy_last_report', { ...report, at: new Date().toISOString() });
  } catch { /* state table optional */ }
  console.log('[agent-autopsy] report:', JSON.stringify(report));
  return report;
}

function isAuthorised(event) {
  if (!event || !event.headers) return false;
  const h = event.headers;
  const scheduled =
    h['x-nf-event'] === 'schedule' ||
    h['netlify-invocation-source'] === 'schedule' ||
    h['x-netlify-event'] === 'schedule';
  if (scheduled) return true;
  const auth = h.authorization || h.Authorization || '';
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  return !!process.env.ADMIN_PASSWORD && provided === process.env.ADMIN_PASSWORD;
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event && event.httpMethod && !isAuthorised(event)) return error(401, 'UNAUTHORIZED');
    const report = await run();
    return event ? json(200, report) : report;
  } catch (err) {
    console.error('[agent-autopsy] fatal:', err);
    return error(500, err.message || 'Internal server error');
  }
};

exports.run = run;
exports.config = { schedule: SCHEDULE };
