const axios = require('axios');
const { sql } = require('./db');
const { loadActiveRules, formatRulesForPrompt } = require('./learned-rules');
const { findByLeagueLabel } = require('./sports');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// All three agents run on claude-sonnet-4-5 via OpenRouter. Cost is ~3x
// a single-call analyse, which for a 4–12 fixture/week MLS scan is still
// well under $1/scan. The accuracy gain from the analyst → devil's
// advocate → adjudicator handoff is meaningful: the adjudicator sees
// both the bullish case and the bearish case before committing to a
// confidence number.
const MODEL = 'anthropic/claude-sonnet-4-5';

// ---------- Self-reflection memory ----------
//
// Before every Analyst call we inject the model's last 5 settled
// predictions for the league as a "here's how you did" prefix. The DB
// hit is cached per function-instance for 5 minutes so a 12-fixture
// scan doesn't slam the DB 12 times.
const REFLECTION_TTL_MS = 5 * 60 * 1000;
const reflectionCache = new Map(); // league → { value, expires }

async function fetchRecentReflectionLines(league) {
  if (!league) return [];
  const now = Date.now();
  const hit = reflectionCache.get(league);
  if (hit && hit.expires > now) return hit.value;
  let lines = [];
  try {
    const rows = await sql()`
      SELECT home_team, away_team, over_line, over_confidence, over_hit,
             btts, btts_confidence, btts_hit, kickoff
      FROM predictions
      WHERE league = ${league} AND over_hit IS NOT NULL
      ORDER BY kickoff DESC
      LIMIT 5`;
    lines = rows.map((r) => {
      const over = `Over ${r.over_line} @ ${r.over_confidence}% → ${r.over_hit ? 'HIT' : 'MISS'}`;
      const btts = `BTTS ${r.btts} @ ${r.btts_confidence}% → ${r.btts_hit ? 'HIT' : 'MISS'}`;
      return `${r.home_team} vs ${r.away_team}: ${over}; ${btts}`;
    });
  } catch (err) {
    console.warn(`[claude reflection] DB query failed for ${league}: ${err.message}`);
    lines = [];
  }
  reflectionCache.set(league, { value: lines, expires: now + REFLECTION_TTL_MS });
  return lines;
}

function reflectionBlock(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 'YOUR RECENT RESULTS: no settled predictions yet for this league. No prior mistakes to learn from.';
  }
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  // Count Over-line misses in the reflection set so the prompt can be
  // explicit about correcting bias. If 2+ of the last 5 Over picks
  // missed, the model gets a stronger "stop defaulting to Over 2.5"
  // instruction — concrete, actionable, anchored in real misses.
  let overMisses = 0;
  for (const line of lines) {
    const m = String(line).match(/Over\s+\d+\.\d+\s+@\s+\d+%\s+→\s+(HIT|MISS)/i);
    if (m && m[1].toUpperCase() === 'MISS') overMisses += 1;
  }
  const correction = overMisses >= 2
    ? '\n\nBIAS CORRECTION (URGENT): you missed ' + overMisses +
      ' of your last ' + lines.length + ' Over picks. Stop defaulting ' +
      'to Over 2.5. Reassess: were you overconfident because the ' +
      'headline number "felt" right? If the combined goals/game data ' +
      'argued for fewer goals, you should have picked Over 1.5 or ' +
      'Over 0.5. Apply that correction to this match — be willing to ' +
      'pick a lower line with conviction instead of a higher line with hope.'
    : '';
  return (
    'YOUR RECENT RESULTS (most recent first):\n' +
    numbered +
    '\nLearn from your mistakes. If you were overconfident on a MISS, ' +
    'discount similar profiles here. If you nailed a HIT with a clear ' +
    'signal, keep doing that.' +
    correction
  );
}

// ---------- Agent system prompts ----------

function analystSystemPrompt(reflection, learnedRulesBlock) {
  return (
    `You are an elite MLS football statistician with 10+ years of analysing match data.\n\n` +
    `Your job: produce a detailed, NUMBER-DRIVEN prediction report for the ` +
    `match you're given. The report must cover:\n` +
    `  • Predicted Over line (choose from 0.5 / 1.5 / 2.5 / 3.5 / 4.5)\n` +
    `  • Predicted BTTS (YES or NO)\n` +
    `  • A confidence number for each (50–85% — never above 85%)\n` +
    `  • 3–4 sentences of reasoning that cite SPECIFIC numbers from the data\n\n` +
    `Hard rules:\n` +
    `  • Cite per-team goals/game, clean-sheet rates, H2H median, form, league position.\n` +
    `  • If H2H samples < 4, treat that signal as weak.\n` +
    `  • If either team has clean_sheet_rate ≥ 0.40, BTTS-YES cannot exceed 60%.\n` +
    `  • BTTS NO is required when EITHER of these is true:\n` +
    `      (a) either team has failed to score in 3 or more of their last 5 games, OR\n` +
    `      (b) either team's goals-scored average is below 0.8 per game.\n` +
    `    In those cases you MUST predict BTTS NO. Do not default to YES.\n` +
    `  • Confidence cap is 85%. Average confidence target is ~70%.\n` +
    `  • If you can't justify a pick with the numbers, drop confidence — don't fabricate.\n\n` +
    `LINE-SELECTION DIRECTIVE — read every word, this is where most ` +
    `models fail:\n` +
    `  • Do NOT default to Over 2.5 unless your confidence on Over 2.5 ` +
    `is ≥ 65%. Over 2.5 is the most-bet market — and the most-missed.\n` +
    `  • Compute confidence for EACH candidate line (0.5, 1.5, 2.5, 3.5, ` +
    `4.5) using combined-goals-per-game, recent form, and the H2H ` +
    `goal median. PICK THE LINE WITH THE HIGHEST CONFIDENCE.\n` +
    `  • In MLS the combined-goals average is typically 2.4–2.8. That ` +
    `means Over 2.5 is roughly a coin flip on average — only call it ` +
    `with conviction when BOTH teams average ≥1.5 goals scored OR the ` +
    `H2H median is ≥3.\n` +
    `  • If your Over 2.5 confidence falls between 50% and 64%, you ` +
    `MUST escalate to Over 1.5: that same match is typically 70–80% ` +
    `likely for Over 1.5. Picking Over 2.5 at 55% when Over 1.5 would ` +
    `be 78% is a STRICTLY DOMINATED choice. Don't make it.\n` +
    `  • If combined goals/game is < 2.4, you cannot pick Over 2.5. ` +
    `Drop to Over 1.5 (or Over 0.5 if both teams average < 1.0).\n` +
    `  • A confident "Over 1.5 at 75%" beats an uncertain "Over 2.5 at ` +
    `55%" every single time. The goal is real edges, not headline ` +
    `lines. Casual bettors prefer big numbers; you don't.\n\n` +
    `CONFIDENCE CAPS BY DATA QUALITY — apply BEFORE settling on a number:\n` +
    `  • If home.avgGoalsFor < 1.2 AND away.avgGoalsFor < 1.2 → confidence MAX 62%.\n` +
    `  • If H2H avg total goals < 2.0 → drop the Over line by one level ` +
    `(e.g. you were going Over 2.5, now go Over 1.5) AND cap confidence at 70%.\n` +
    `  • If the referee's goals-per-game stat is below 2.2 → reduce confidence by 8 pts.\n` +
    `  • If either team has rest days = 0 (just played) → reduce confidence by 5 pts.\n` +
    `  • HARD ceiling is 78% UNLESS every signal (form, H2H, goals/game, refs, ` +
    `rest, BTTS rates) ALL point the same way. Treat 78% as your normal cap; 80–85% reserved.\n` +
    `  • Target average confidence across the week's slate: 63–68%. If you find ` +
    `yourself at 70%+ on most matches you are overconfident — recalibrate down.\n\n` +
    reflectionBlock(reflection) +
    (learnedRulesBlock || '')
  );
}

const DEVILS_ADVOCATE_PROMPT = (
  `You are a critical risk analyst reviewing an AI prediction.\n\n` +
  `You will be given:\n` +
  `  1. The original match data (numbers).\n` +
  `  2. Another analyst's prediction report.\n\n` +
  `Your job: find the HOLES in this prediction. Output exactly:\n` +
  `  • 3 numbered reasons this prediction could be wrong, each citing a ` +
  `specific data point or absent data point.\n` +
  `  • A risk score from 1 to 10 (10 = very risky), on its own line as:\n` +
  `      RISK_SCORE: <n>\n\n` +
  `Do not propose a different prediction. Just attack the existing one. ` +
  `Be specific. Vague risks ("anything can happen in football") are ` +
  `worthless — quote numbers from the data.\n\n` +
  `RISK SCORE CALIBRATION — read carefully:\n` +
  `  • 1-3 = LOW: the prediction has strong, clean data supporting it ` +
  `(consistent form, clear H2H signal, no contradictions). Most matches ` +
  `should land here.\n` +
  `  • 4-6 = MODERATE: minor concerns — small sample size on one stat, ` +
  `mixed form, one missing data point. Normal football uncertainty.\n` +
  `  • 7-8 = HIGH: real red flags — data is thinly sourced, signals ` +
  `contradict each other, or the prediction depends on a single fragile ` +
  `data point.\n` +
  `  • 9-10 = SEVERE: reserved for predictions with major data gaps, ` +
  `directly contradictory evidence, or where the analyst is clearly ` +
  `overconfident given the data. RARE — should be one in twenty matches ` +
  `or fewer.\n\n` +
  `Default to LOW (1-3) when the analyst's reasoning is sound. Do not ` +
  `inflate risk to seem thorough. "I could imagine a scenario where..." ` +
  `is not a risk — only ACTUAL data gaps or contradictions count.`
);

const ADJUDICATOR_PROMPT = (
  `You are the final decision maker.\n\n` +
  `You will be given:\n` +
  `  1. An analyst's prediction report.\n` +
  `  2. A devil's advocate critique with a RISK_SCORE.\n\n` +
  `DEFAULT BEHAVIOUR: trust the analyst. The devil's advocate's job is\n` +
  `to surface concerns; that doesn't automatically mean the analyst was\n` +
  `wrong. When the analyst's reasoning is sound and references real\n` +
  `numbers, KEEP THE ANALYST'S CONFIDENCE.\n\n` +
  `Confidence adjustment rules — apply only one:\n` +
  `  • risk_score ≤ 6 → KEEP the analyst's confidence verbatim.\n` +
  `  • risk_score 7-8 → reduce confidence by 3 percentage points.\n` +
  `  • risk_score 9-10 → reduce confidence by 6 percentage points.\n` +
  `  • Floor: 50. Ceiling: 85.\n\n` +
  `Do NOT compound multiple safety mechanisms. The analyst already\n` +
  `enforces the clean-sheet cap on BTTS YES; do not re-cut for the same\n` +
  `reason. If the analyst returned 72%, the devil scored 5, and you\n` +
  `output anything other than 72%, you are wrong.\n\n` +
  `Return ONLY valid JSON with this exact shape:\n` +
  `{\n` +
  `  "over":  { "line": number, "confidence": number, "reasoning": string },\n` +
  `  "btts":  { "prediction": "YES"|"NO", "confidence": number, "reasoning": string },\n` +
  `  "keyFactor": string,\n` +
  `  "riskFlag": boolean,\n` +
  `  "riskScore": number,\n` +
  `  "firstHalf":     { "line": number, "confidence": number, "reasoning": string } | null,\n` +
  `  "asianHandicap": { "line": string, "team": string, "confidence": number, "reasoning": string } | null\n` +
  `}\n\n` +
  `Rules:\n` +
  `  • confidence numbers are integers in the 50–85 range. No exceptions.\n` +
  `  • reasoning fields max 2 sentences each and must reference numbers.\n` +
  `  • keyFactor: the single biggest reason for the verdict, one sentence.\n` +
  `  • riskFlag = (riskScore >= 9).\n` +
  `  • firstHalf and asianHandicap are nullable — leave null unless asked.\n` +
  `  • Output JSON only. No markdown, no commentary, no prose preamble.`
);

class ClaudeAnalysisError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ClaudeAnalysisError';
    this.reason = reason;
  }
}

function safeParseJSON(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callOpenRouter({ systemPrompt, userMessage, maxTokens = 700 }) {
  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Title': 'FastScore',
  };
  if (process.env.URL) headers['HTTP-Referer'] = process.env.URL;

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: maxTokens,
  };

  // 25s per agent → three agents serial = ~45-60s wall, fine for the
  // 15-min background-function envelope. Per-call ceiling keeps one
  // slow request from dominoing the whole scan.
  const res = await axios.post(OPENROUTER_URL, body, { headers, timeout: 25000 });
  const data = res.data;
  if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('OpenRouter returned no choices');
  }
  return data.choices[0].message.content;
}

function extractRiskScore(critiqueText) {
  if (!critiqueText) return null;
  const m = String(critiqueText).match(/RISK[_\s]?SCORE\s*[:=]\s*(\d{1,2})/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, n));
}

// Map an OpenRouter axios error to a ClaudeAnalysisError with a tight reason.
function classifyHttpError(err) {
  if (err instanceof ClaudeAnalysisError) return err;
  const status = err.response && err.response.status;
  const detail = err.response && err.response.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
  console.error(`OpenRouter API error: status=${status} detail=${detail}`);
  if (status === 401) return new ClaudeAnalysisError('OpenRouter 401 — invalid/revoked OPENROUTER_API_KEY');
  if (status === 402) return new ClaudeAnalysisError('OpenRouter 402 — out of credits');
  if (status === 404) return new ClaudeAnalysisError('OpenRouter 404 — model not found');
  if (status === 429) return new ClaudeAnalysisError('OpenRouter 429 — rate limited');
  return new ClaudeAnalysisError(`OpenRouter error (status ${status || 'n/a'}): ${(detail || '').slice(0, 200)}`);
}

// Run the three agents serially and return the merged result.
// Returns: parsed JSON from the Adjudicator with an extra `debate`
// field carrying the analyst + critique transcripts for storage.
async function runEnsemble(matchData, { includeFirstHalf, includeAsianHandicap, leagueForReflection }) {
  const leagueLabel = leagueForReflection || (matchData && matchData.league) || 'MLS';
  const sportEntry = findByLeagueLabel(leagueLabel);
  const sportKey = sportEntry ? sportEntry.id : leagueLabel.toLowerCase();
  const leagueKey = sportEntry ? sportEntry.name : leagueLabel;
  const reflection = await fetchRecentReflectionLines(leagueLabel);
  // Learned rules — injected into the Analyst's system prompt so the
  // model has to acknowledge them before producing a verdict. Best-
  // effort: load failures return an empty string and the prompt is
  // identical to the pre-Intelligence behaviour.
  const rules = await loadActiveRules(sportKey, leagueKey);
  const learnedRulesBlock = formatRulesForPrompt(rules);
  const matchJson = JSON.stringify(matchData, null, 2);

  // 1. ANALYST — free-text prediction report.
  let analystText;
  try {
    analystText = await callOpenRouter({
      systemPrompt: analystSystemPrompt(reflection, learnedRulesBlock),
      userMessage: `Analyse this match. Output your full prediction report.\n\nMatch data:\n${matchJson}`,
      maxTokens: 700,
    });
  } catch (err) {
    throw classifyHttpError(err);
  }
  if (!analystText) throw new ClaudeAnalysisError('Analyst returned empty response');

  // 2. DEVIL'S ADVOCATE — critique with RISK_SCORE.
  let critiqueText;
  try {
    critiqueText = await callOpenRouter({
      systemPrompt: DEVILS_ADVOCATE_PROMPT,
      userMessage:
        `Original match data:\n${matchJson}\n\n` +
        `Analyst's prediction report:\n${analystText}\n\n` +
        `Find the holes. List exactly 3 reasons. End with "RISK_SCORE: <n>" on its own line.`,
      maxTokens: 500,
    });
  } catch (err) {
    throw classifyHttpError(err);
  }
  if (!critiqueText) throw new ClaudeAnalysisError("Devil's advocate returned empty response");
  const riskScore = extractRiskScore(critiqueText);

  // 3. ADJUDICATOR — produces the final JSON verdict.
  let verdictText;
  try {
    verdictText = await callOpenRouter({
      systemPrompt: ADJUDICATOR_PROMPT,
      userMessage:
        `Analyst's report:\n${analystText}\n\n` +
        `Devil's advocate critique:\n${critiqueText}\n\n` +
        `Return ONLY the JSON verdict per the schema. ` +
        `${includeFirstHalf ? 'Include firstHalf.' : 'Set firstHalf=null.'} ` +
        `${includeAsianHandicap ? 'Include asianHandicap.' : 'Set asianHandicap=null.'}`,
      maxTokens: 500,
    });
  } catch (err) {
    throw classifyHttpError(err);
  }
  let parsed = safeParseJSON(verdictText);
  if (!parsed) {
    // One retry with an explicit JSON-only nudge.
    try {
      const retry = await callOpenRouter({
        systemPrompt: ADJUDICATOR_PROMPT,
        userMessage:
          `Analyst's report:\n${analystText}\n\nDevil's advocate critique:\n${critiqueText}\n\n` +
          `IMPORTANT: respond ONLY with valid JSON matching the schema. No markdown, no commentary.`,
        maxTokens: 500,
      });
      parsed = safeParseJSON(retry);
    } catch (err) {
      throw classifyHttpError(err);
    }
  }
  if (!parsed) throw new ClaudeAnalysisError('Adjudicator returned non-JSON twice');

  // Strict shape validation — no synthetic 50% defaults like the legacy
  // path used to do. A malformed response throws and the scan hard-skips
  // the row rather than persisting a placeholder.
  if (!parsed.over || typeof parsed.over.line !== 'number' || typeof parsed.over.confidence !== 'number') {
    throw new ClaudeAnalysisError('Adjudicator missing/invalid over field');
  }
  if (!parsed.btts || !['YES', 'NO'].includes(String(parsed.btts.prediction || '').toUpperCase()) || typeof parsed.btts.confidence !== 'number') {
    throw new ClaudeAnalysisError('Adjudicator missing/invalid btts field');
  }

  // Defensive 85% cap server-side. The adjudicator's prompt already says
  // 50–85, but enforcing here guarantees the contract even if the model
  // drifts. Coerce to integer.
  parsed.over.confidence = Math.min(85, Math.max(0, Math.round(parsed.over.confidence)));
  parsed.btts.confidence = Math.min(85, Math.max(0, Math.round(parsed.btts.confidence)));
  parsed.btts.prediction = String(parsed.btts.prediction).toUpperCase();

  // Defensive risk-reduction ladder matching the new adjudicator prompt:
  //   risk ≤ 6: no reduction
  //   risk 7-8: −3 points
  //   risk ≥ 9: −6 points
  // This is the LAST defence — the adjudicator is supposed to do it
  // itself. We only nudge if the model returned a number that ignored
  // the rule. Floor 50.
  const finalRisk = typeof parsed.riskScore === 'number' ? parsed.riskScore : riskScore;
  if (typeof finalRisk === 'number') {
    let cut = 0;
    if (finalRisk >= 9) cut = 6;
    else if (finalRisk >= 7) cut = 3;
    if (cut > 0) {
      parsed.over.confidence = Math.max(50, parsed.over.confidence - cut);
      parsed.btts.confidence = Math.max(50, parsed.btts.confidence - cut);
    }
  }
  parsed.riskScore = typeof finalRisk === 'number' ? finalRisk : null;
  parsed.riskFlag = !!(parsed.riskScore != null && parsed.riskScore >= 9);

  if (!includeFirstHalf) parsed.firstHalf = null;
  if (!includeAsianHandicap) parsed.asianHandicap = null;

  parsed.aiStatus = 'ok';
  parsed.model = MODEL;

  // Store the full debate transcript for the dashboard and for the
  // accuracy-history surface. Trimmed slightly to keep JSONB rows sane.
  parsed.debate = {
    model: MODEL,
    analyst: String(analystText).slice(0, 4000),
    devilsAdvocate: String(critiqueText).slice(0, 3000),
    adjudicator: String(verdictText || '').slice(0, 3000),
    riskScore: parsed.riskScore,
    keyFactor: parsed.keyFactor || null,
    // Snapshot of the active learned rules the Analyst saw. Admin
    // Intelligence tab uses this to audit which rules were applied
    // to which predictions.
    rulesApplied: rules.map((r) => ({ id: r.id, condition: r.condition, adjustment: r.adjustment })),
    generatedAt: new Date().toISOString(),
  };

  return parsed;
}

// Public API — same signature as the pre-ensemble version, so every
// caller (predictions-scan-background.js, predictions.js) keeps working.
async function analyseMatch(matchData, includeFirstHalf = false, includeAsianHandicap = false) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new ClaudeAnalysisError('OPENROUTER_API_KEY env var not set');
  }
  try {
    return await runEnsemble(matchData, {
      includeFirstHalf,
      includeAsianHandicap,
      leagueForReflection: (matchData && matchData.league) || 'MLS',
    });
  } catch (err) {
    throw classifyHttpError(err);
  }
}

module.exports = { analyseMatch, ClaudeAnalysisError, MODEL };
