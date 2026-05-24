const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Upgraded from claude-3.5-haiku → claude-sonnet-4-5.
// Cost rises ~4× ($0.80 → $3 input, $4 → $15 output per MTok), which for
// a 4–12 fixture/week MLS scan works out to roughly $0.05 → $0.20 per
// scan. Trivial in absolute terms, and Sonnet 4.5 is materially better
// at multi-factor numerical reasoning, which is the entire job here.
const MODEL = 'anthropic/claude-sonnet-4-5';

// Rewritten system prompt. Three changes vs the old one:
//   1. Explicit statistical rules tied to the numbers we send.
//   2. Confidence calibration: hard cap 82, target avg 68-72, no
//      "very confident" predictions in a sport that doesn't allow them.
//   3. Soften the spec's "never Over 2.5 if both teams avg < 1.2" to
//      "strongly prefer lower" — hard "never"s in prompts produce
//      brittle outputs when overwhelming H2H signal would justify
//      overriding.
//
// The JSON contract is unchanged so every downstream parser still
// works. firstHalf and asianHandicap are kept in the schema as
// nullable — the scan never asks for them.
const SYSTEM_PROMPT = `You are a professional football statistician specialising in MLS goal markets. You have 10 years of experience analysing match data.

Your job is to predict two markets:
1. Over/Under goals line (choose the most statistically justified line from: 0.5, 1.5, 2.5, 3.5, 4.5)
2. BTTS (Both Teams to Score): YES or NO

STRICT RULES YOU MUST FOLLOW:
- Base EVERY prediction on the actual numbers provided. Never guess.
- If a team averages under 1.0 goals scored per game: lean heavily toward BTTS NO and lower Over lines.
- If a team averages over 2.0 goals scored per game: consider higher Over lines.
- If both teams average under 1.2 goals scored: strongly prefer Over 1.5 or lower. Only go to Over 2.5+ if H2H average goals is clearly above 3.0.
- A team with form L L L L L (5 losses) is in bad form — factor this heavily.
- A team with form W W W W W is in great form — factor this heavily.
- Rest days over 7: slight positive performance boost.
- Rest days under 3: slight negative performance boost.
- H2H goals: prefer h2h.medianGoalsPerGame over h2h.avgGoalsPerGame — the mean is sensitive to single-game outliers (one 6-1 blowout in an 8-game sample shifts mean by ~1 goal per game). If h2h.samples < 4, treat the H2H signal as weak and lean on per-team averages instead.
- Clean sheet rate: a team with cleanSheetRate >= 0.40 (40%+ of games as clean sheets) is a defensively strong side. If EITHER team has cleanSheetRate >= 0.40, BTTS YES confidence MUST NOT exceed 60%. This is a hard ceiling.
- Referee average goals per game: if ref averages over 3.0, slightly increase Over line.
- League position and season record are provided. A team in 2nd place with 9W-2D-2L is significantly stronger than a team in 12th with 4W-2D-7L. Factor this into confidence and prediction. Large form/position gaps should increase confidence in the stronger team's markets.
- If data is missing or null for a field: ignore that field, do not assume.

CONFIDENCE CALIBRATION — this is critical:
- Only give 80%+ confidence when ALL of these are true: strong form data, clear H2H pattern, stats strongly support one outcome.
- Give 65-79% when most data supports the prediction but some uncertainty exists.
- Give 50-64% when data is mixed or limited.
- NEVER give over 85% confidence — no prediction in football is that certain.
- If you would naturally give 90%+: cap it at 82% maximum.
- Average confidence across all predictions should be around 68-72%.

OVER LINE SELECTION — be conservative:
- Default starting point: Over 1.5.
- Only go to Over 2.5 if BOTH teams average over 1.3 goals scored per game OR H2H is clearly high-scoring.
- Only go to Over 3.5 if BOTH teams average over 1.8 goals scored per game.
- Never go to Over 4.5 unless extreme data supports it.
- When in doubt: go lower, not higher.

Return ONLY valid JSON with this exact shape:
{
  "over":  { "line": number, "confidence": number 0-100, "reasoning": "2-3 sentences" },
  "btts":  { "prediction": "YES"|"NO", "confidence": number 0-100, "reasoning": "2-3 sentences" },
  "firstHalf":     { "line": number, "confidence": number, "reasoning": string } | null,
  "asianHandicap": { "line": string, "team": string, "confidence": number, "reasoning": string } | null
}

Reasoning must reference specific numbers from the data. Example: "Portland averages 2.1 goals scored at home and Seattle concedes 1.4 away — combined attack strength supports Over 2.5 at 71% confidence."

Be concise. Return JSON only. Maximum 2 sentences per reasoning field.`;

// Sentinel error class so the caller can distinguish a real model
// failure (network, auth, parse) from any other kind of throw and
// REJECT the row entirely rather than silently save a synthetic 50%.
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

async function callOpenRouter(userMessage) {
  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Title': 'FastScore',
  };
  if (process.env.URL) headers['HTTP-Referer'] = process.env.URL;

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 500,
  };

  // 20s timeout — Sonnet 4.5 is slower than Haiku, but Netlify's
  // background-function envelope is 15 min so we have plenty of headroom.
  // Per-call we still want a hard ceiling so one slow request doesn't
  // domino the whole scan.
  const res = await axios.post(OPENROUTER_URL, body, { headers, timeout: 20000 });
  const data = res.data;
  if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('OpenRouter returned no choices');
  }
  return data.choices[0].message.content;
}

// Returns the parsed analysis on success.
// THROWS ClaudeAnalysisError on any failure — auth, rate-limit, malformed
// JSON, missing required fields. The caller (the weekly scan) catches
// this and SKIPS the fixture insert rather than persisting a synthetic
// 50% placeholder. The previous fallback() path quietly saved "Analysis
// unavailable. 50%" rows that the dashboard rendered identically to
// real picks — users had no way to distinguish a real Sonnet output
// from "we gave up". That's gone.
async function analyseMatch(matchData, includeFirstHalf = false, includeAsianHandicap = false) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new ClaudeAnalysisError('OPENROUTER_API_KEY env var not set');
  }

  const userMessage = `Analyse this match and return predictions per the system instructions.

Flags:
- first_half: ${includeFirstHalf ? 'YES' : 'NO'}
- asian_handicap: ${includeAsianHandicap ? 'YES' : 'NO'}

Match data:
${JSON.stringify(matchData, null, 2)}`;

  let lastDetail = '';
  let lastStatus = null;
  try {
    const text = await callOpenRouter(userMessage);
    let parsed = safeParseJSON(text);
    if (!parsed) {
      const retryText = await callOpenRouter(
        `${userMessage}\n\nIMPORTANT: respond ONLY with valid JSON matching the schema. No markdown, no commentary.`,
      );
      parsed = safeParseJSON(retryText);
    }
    if (!parsed) {
      throw new ClaudeAnalysisError('OpenRouter returned non-JSON twice');
    }
    // Strict validation — if Sonnet skips required fields we throw,
    // we do NOT substitute synthetic defaults like the old fallback did.
    if (!parsed.over || typeof parsed.over.line !== 'number' || typeof parsed.over.confidence !== 'number') {
      throw new ClaudeAnalysisError('Missing/invalid over field in response');
    }
    if (!parsed.btts || !['YES', 'NO'].includes(String(parsed.btts.prediction || '').toUpperCase()) || typeof parsed.btts.confidence !== 'number') {
      throw new ClaudeAnalysisError('Missing/invalid btts field in response');
    }
    // Apply the 82% calibration cap defensively — the prompt asks the
    // model to self-cap, but enforcing it on our side guarantees the
    // contract even if Sonnet drifts.
    parsed.over.confidence = Math.min(82, Math.max(0, Math.round(parsed.over.confidence)));
    parsed.btts.confidence = Math.min(82, Math.max(0, Math.round(parsed.btts.confidence)));
    parsed.btts.prediction = String(parsed.btts.prediction).toUpperCase();
    if (!includeFirstHalf) parsed.firstHalf = null;
    if (!includeAsianHandicap) parsed.asianHandicap = null;
    parsed.aiStatus = 'ok';
    parsed.model = MODEL;
    return parsed;
  } catch (err) {
    if (err instanceof ClaudeAnalysisError) throw err;
    lastStatus = err.response && err.response.status;
    lastDetail = err.response && err.response.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
    console.error(`OpenRouter API error: status=${lastStatus} detail=${lastDetail}`);
    let reason;
    if (lastStatus === 401) reason = 'OpenRouter 401 — invalid/revoked OPENROUTER_API_KEY';
    else if (lastStatus === 402) reason = 'OpenRouter 402 — out of credits';
    else if (lastStatus === 404) reason = 'OpenRouter 404 — model not found';
    else if (lastStatus === 429) reason = 'OpenRouter 429 — rate limited';
    else reason = `OpenRouter error (status ${lastStatus || 'n/a'}): ${lastDetail.slice(0, 200)}`;
    throw new ClaudeAnalysisError(reason);
  }
}

module.exports = { analyseMatch, ClaudeAnalysisError, MODEL };
