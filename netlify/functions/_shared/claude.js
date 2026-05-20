const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-3.5-haiku';

const SYSTEM_PROMPT = `You are an expert football analyst specialising in goals markets across MLS, Bundesliga, and Eredivisie.

Each league has distinct scoring tendencies:
- MLS: High variance, weak defences, altitude/travel factors.
- Bundesliga: High-press transitions, consistently high scoring.
- Eredivisie: Highest goals/game in Europe, very open play.

You will receive, per match:
- League name
- Each team's recent form (sequence of W / L / D from the last 5 games)
- Rest days since each team last played
- Season goals/game stats (avgFor, avgAgainst) for each team

Analyse the data and return predictions for:

1. OVER LINE: Most statistically justified line. Choose from: 0.5, 1.5, 2.5, 3.5, 4.5. Account for league context. Do not default to 2.5.

2. BTTS: YES or NO. Both teams to score.

3. FIRST HALF OVER: Most justified first half over line. Choose from: 0.5, 1.5, 2.5. (Include only if first_half requested)

4. ASIAN HANDICAP: Suggested handicap line for the stronger team. Format: '-0.5', '-1', '-1.5', '+0.5' etc. (Include only if asian_handicap requested)

HOW TO WEIGHT THE INPUTS:

- Form: a string of W's suggests momentum; mix of L/D suggests inconsistency. The home team's home form and the away team's away form are the most predictive signals.
- Rest days: < 3 days short rest can suppress scoring; 4-6 days is normal; 7+ days is well-rested.
- Goals/game stats: sum the home team's avgFor and the away team's avgAgainst (and vice versa) to estimate expected goals. Lean Over when the combined expectation is comfortably above the line; lean Under when below.

For every prediction: confidence 0-100, reasoning 2-3 sentences referencing specific stats from the data provided (form, rest days, goals/game — whichever drove the call).

Return ONLY valid JSON, no markdown, no text outside JSON:
{
  "over": { "line": number, "confidence": number, "reasoning": string },
  "btts": { "prediction": "YES"|"NO", "confidence": number, "reasoning": string },
  "firstHalf": { "line": number, "confidence": number, "reasoning": string } | null,
  "asianHandicap": { "line": string, "team": string, "confidence": number, "reasoning": string } | null
}`;

function fallback(reason) {
  return {
    over: { line: 2.5, confidence: 50, reasoning: 'Analysis unavailable.' },
    btts: { prediction: 'YES', confidence: 50, reasoning: 'Analysis unavailable.' },
    firstHalf: null,
    asianHandicap: null,
    aiStatus: 'fallback',
    aiReason: reason || 'unknown',
  };
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
    'X-Title': 'VantaEdge',
  };
  if (process.env.URL) headers['HTTP-Referer'] = process.env.URL;

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 1000,
  };

  // 15s timeout — anything slower would lose the Netlify 26s function
  // timeout race anyway. Better to bail and return the analytical
  // fallback for that one fixture than stall every other fixture too.
  const res = await axios.post(OPENROUTER_URL, body, { headers, timeout: 15000 });
  const data = res.data;
  if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('OpenRouter returned no choices');
  }
  return data.choices[0].message.content;
}

async function analyseMatch(matchData, includeFirstHalf = false, includeAsianHandicap = false) {
  if (!process.env.OPENROUTER_API_KEY) return fallback('OPENROUTER_API_KEY env var not set');

  const userMessage = `Analyse this match and return predictions per the system instructions.

Flags:
- first_half: ${includeFirstHalf ? 'YES' : 'NO'}
- asian_handicap: ${includeAsianHandicap ? 'YES' : 'NO'}

Match data:
${JSON.stringify(matchData, null, 2)}`;

  try {
    const text = await callOpenRouter(userMessage);
    let parsed = safeParseJSON(text);
    if (!parsed) {
      const retryText = await callOpenRouter(
        `${userMessage}\n\nIMPORTANT: respond ONLY with valid JSON matching the schema. No markdown, no commentary.`,
      );
      parsed = safeParseJSON(retryText);
    }
    if (!parsed) return fallback('OpenRouter returned non-JSON twice');

    if (!parsed.over || typeof parsed.over.line !== 'number') parsed.over = fallback().over;
    if (!parsed.btts || !parsed.btts.prediction) parsed.btts = fallback().btts;
    if (!includeFirstHalf) parsed.firstHalf = null;
    if (!includeAsianHandicap) parsed.asianHandicap = null;
    parsed.aiStatus = 'ok';
    return parsed;
  } catch (err) {
    const status = err.response && err.response.status;
    const detail = err.response && err.response.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
    console.error(`OpenRouter API error: status=${status} detail=${detail}`);
    let reason;
    if (status === 401) reason = 'OpenRouter 401 — invalid/revoked OPENROUTER_API_KEY';
    else if (status === 402) reason = 'OpenRouter 402 — out of credits';
    else if (status === 404) reason = 'OpenRouter 404 — model not found';
    else if (status === 429) reason = 'OpenRouter 429 — rate limited';
    else reason = `OpenRouter error (status ${status || 'n/a'}): ${detail.slice(0, 200)}`;
    return fallback(reason);
  }
}

module.exports = { analyseMatch };
