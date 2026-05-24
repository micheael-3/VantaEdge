// Helper around the learned_rules table. Read on every prediction; write
// after every autopsy / pattern mining pass.
//
// Sport-agnostic: every call site passes a (sport, league) pair from the
// SPORTS config in _shared/sports.js. Default values exist only to keep
// pre-migration code paths from crashing.

const { sql } = require('./db');

// Function-instance cache so a 12-fixture scan doesn't hammer the DB
// 12 times. 5-min TTL — short enough that newly-added rules show up
// in the next scan, long enough to keep query count trivial.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key=sport|league → {value, expires}

function isMissingTableErr(err) {
  return (
    err &&
    (err.code === '42P01' ||
      /relation "?learned_rules"? does not exist/i.test(err.message || ''))
  );
}

// Return all ACTIVE rules for the given sport+league. Falls back to an
// empty array on any error (missing table, network blip) — the
// prediction pipeline must never crash because we couldn't load rules.
async function loadActiveRules(sport, league) {
  const sportKey = String(sport || '').toLowerCase();
  const leagueKey = String(league || '').toLowerCase();
  const cacheKey = `${sportKey}|${leagueKey}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const rows = await sql()`
      SELECT id, condition, adjustment, confidence, supporting_predictions,
             accuracy_improvement, source
      FROM learned_rules
      WHERE active = TRUE
        AND (LOWER(sport) = ${sportKey} OR LOWER(league) = ${leagueKey})
      ORDER BY confidence DESC NULLS LAST, supporting_predictions DESC
      LIMIT 25`;
    const value = rows.map((r) => ({
      id: r.id,
      condition: r.condition,
      adjustment: r.adjustment,
      confidence: r.confidence,
      supportingPredictions: r.supporting_predictions,
      accuracyImprovement: r.accuracy_improvement,
      source: r.source,
    }));
    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    if (isMissingTableErr(err)) {
      console.warn('[learned-rules] table missing — returning empty list. Run run-migration.sql.');
    } else {
      console.warn(`[learned-rules] load failed (${sportKey}/${leagueKey}): ${err.message}`);
    }
    return [];
  }
}

// Format rules as a system-prompt block. Designed to be appended to the
// Analyst's prompt. Returns an empty string when there are no rules so
// the prompt stays clean for sports that haven't accumulated rules yet.
function formatRulesForPrompt(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return '';
  const lines = rules.slice(0, 15).map((r, i) => {
    const conf = r.confidence != null ? ` (rule confidence ${r.confidence}%)` : '';
    return `${i + 1}. WHEN ${r.condition}\n   THEN ${r.adjustment}${conf}`;
  });
  return (
    `\nLEARNED RULES FROM PAST PREDICTIONS — apply these BEFORE producing your verdict.\n` +
    `For each rule that matches this match's data, acknowledge it in the reasoning and adjust accordingly:\n` +
    lines.join('\n')
  );
}

// Insert a new rule. Best-effort. Returns null on failure.
async function insertRule({ sport, league, condition, adjustment, confidence, source }) {
  try {
    const rows = await sql()`
      INSERT INTO learned_rules
        (sport, league, condition, adjustment, confidence, source)
      VALUES
        (${String(sport || '').toLowerCase()},
         ${String(league || '').toLowerCase()},
         ${condition}, ${adjustment}, ${confidence || null}, ${source || 'autopsy'})
      RETURNING id`;
    invalidateCache();
    return rows[0] && rows[0].id;
  } catch (err) {
    console.warn(`[learned-rules] insert failed: ${err.message}`);
    return null;
  }
}

function invalidateCache() {
  cache.clear();
}

module.exports = {
  loadActiveRules,
  formatRulesForPrompt,
  insertRule,
  invalidateCache,
};
