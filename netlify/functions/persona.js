// GET /api/persona
//
// Public, no-auth endpoint that returns the AI's current "persona state".
// The dashboard's BestBetBanner fetches this on mount to render the
// mood dot + catchphrase. Tiny payload, cheap to call, cached for ~5
// minutes by the function-instance memory cache below.
//
// Persona state is written by agent-accuracy at 3am UTC from the
// previous 24h hit-rate. Three moods:
//   dominant     → avg > 0.70
//   analytical   → 0.45 ≤ avg ≤ 0.70 (default)
//   humble       → avg < 0.45
//
// Singleton row in persona_state (id locked to 1 by CHECK constraint).
// If the table or row doesn't exist yet (e.g. migration hasn't run),
// we return the analytical default so the frontend doesn't choke.

const { sql } = require('./_shared/db');
const { json, error, methodNotAllowed } = require('./_shared/response');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;

const DEFAULT_STATE = {
  mood: 'analytical',
  catchphrase: 'The data never lies.',
  updatedAt: null,
};

function isMissingTableErr(err) {
  return (
    err &&
    (err.code === '42P01' ||
      /relation "?persona_state"? does not exist/i.test(err.message || ''))
  );
}

async function getPersona() {
  // Function-instance cache. The frontend hits this on every dashboard
  // mount; caching for 5 minutes is more than enough to keep the DB
  // load trivial without making the mood feel stale (it only rewrites
  // once a day anyway).
  if (cache && cache.expires > Date.now()) return cache.value;
  try {
    const rows = await sql()`
      SELECT mood, catchphrase, updated_at
      FROM persona_state
      WHERE id = 1
      LIMIT 1`;
    let value = DEFAULT_STATE;
    if (rows && rows[0]) {
      value = {
        mood: rows[0].mood || DEFAULT_STATE.mood,
        catchphrase: rows[0].catchphrase || DEFAULT_STATE.catchphrase,
        updatedAt: rows[0].updated_at || null,
      };
    }
    cache = { value, expires: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (err) {
    if (isMissingTableErr(err)) {
      console.warn('[persona] table missing — returning default state. Run run-migration.sql.');
      return DEFAULT_STATE;
    }
    throw err;
  }
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event && event.httpMethod && event.httpMethod !== 'GET') return methodNotAllowed();
    const value = await getPersona();
    return json(200, value);
  } catch (err) {
    console.error('persona handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
