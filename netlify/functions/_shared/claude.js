const axios = require('axios');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-3.5-haiku';

const SYSTEM_PROMPT = `You are an expert football analyst specialising in goals markets across MLS, Bundesliga, Eredivisie, Championship, Ligue 1, Scottish Premiership, La Liga, and Premier League.

Each league has distinct scoring tendencies:
- MLS: High variance, weak defences, altitude/travel factors
- Bundesliga: High-press transitions, consistently high scoring
- Eredivisie: Highest goals/game in Europe, very open play
- Championship: 46-game fatigue, physical, lots of 2-3 goal games
- Ligue 1: Open mid-table, PSG inflates averages
- Scottish Prem: Celtic/Rangers dominance, rest of league very open
- La Liga: Tactically conservative mid-table, top-heavy
- Premier League: Competitive, tight margins, hard to predict

Analyse the provided match data and return predictions for:

1. OVER LINE: Most statistically justified line. Choose from: 0.5, 1.5, 2.5, 3.5, 4.5. Account for league context. Do not default to 2.5.

2. BTTS: YES or NO. Both teams to score.

3. FIRST HALF OVER: Most justified first half over line. Choose from: 0.5, 1.5, 2.5. (Include only if first_half requested)

4. ASIAN HANDICAP: Suggested handicap line for the stronger team. Format: '-0.5', '-1', '-1.5', '+0.5' etc. (Include only if asian_handicap requested)

EXTRA CONTEXT WHEN PRESENT — weight these alongside the base data:

- xG / goals-per-game: a team consistently scoring above their xG is on a hot streak that will regress; below xG is unlucky and due to revert. Weight the underlying chance creation, not the raw goals.
- Weather:
  - Heavy rain (precipitation > 5 mm) — reduce total goals by ~0.3 and slightly reduce BTTS probability.
  - Strong wind (> 40 km/h) — reduce total goals by ~0.2; long-range shooting suffers.
  - Extreme heat (> 32°C) — reduce second-half goals as fatigue rises; lower BTTS.
  - Cold (< 2°C) — minimal direct effect but factor it for away sides travelling from warmer climates.
  - Normal — no adjustment.
- Referee tendency: when avg goals/game is materially above the league average (~2.6), boost the goals lean. When materially below, fade it.
- Injuries / suspensions:
  - Missing goalkeeper — increase opposition scoring expectation by 0.2-0.3.
  - Missing key striker (or any flagged 'key' attacker) — reduce that team's scoring expectation and reduce BTTS probability.
  - Multiple absences (3+) — general performance degradation; nudge opposition scoring up.

For every prediction: confidence 0-100, reasoning 2-3 sentences referencing specific stats from the data provided (form, xG, weather, ref, injuries, H2H — whichever drove the call).

Return ONLY valid JSON, no markdown, no text outside JSON:
{
  "over": { "line": number, "confidence": number, "reasoning": string },
  "btts": { "prediction": "YES"|"NO", "confidence": number, "reasoning": string },
  "firstHalf": { "line": number, "confidence": number, "reasoning": string } | null,
  "asianHandicap": { "line": string, "team": string, "confidence": number, "reasoning": string } | null
}`;

function fallback() {
  return {
    over: { line: 2.5, confidence: 50, reasoning: 'Analysis unavailable.' },
    btts: { prediction: 'YES', confidence: 50, reasoning: 'Analysis unavailable.' },
    firstHalf: null,
    asianHandicap: null,
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

  const res = await axios.post(OPENROUTER_URL, body, { headers, timeout: 30000 });
  const data = res.data;
  if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('OpenRouter returned no choices');
  }
  return data.choices[0].message.content;
}

async function analyseMatch(matchData, includeFirstHalf = false, includeAsianHandicap = false) {
  if (!process.env.OPENROUTER_API_KEY) return fallback();

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
    if (!parsed) return fallback();

    if (!parsed.over || typeof parsed.over.line !== 'number') parsed.over = fallback().over;
    if (!parsed.btts || !parsed.btts.prediction) parsed.btts = fallback().btts;
    if (!includeFirstHalf) parsed.firstHalf = null;
    if (!includeAsianHandicap) parsed.asianHandicap = null;
    return parsed;
  } catch (err) {
    const detail = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('OpenRouter API error:', detail);
    return fallback();
  }
}

module.exports = { analyseMatch };
