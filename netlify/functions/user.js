const bcrypt = require('bcryptjs');
const { sql } = require('./_shared/db');
const { json, error, notFound, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { makeClearCookie } = require('./_shared/cookies');
const { LEAGUES } = require('./_shared/tier');

const VALID_LEAGUE_IDS = new Set(Object.keys(LEAGUES).map((k) => Number(k)));
const VALID_MARKETS = new Set(['all', 'over', 'btts']);

async function savePreferences(event, isOnboarding) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const body = parseBody(event);

  // Sanitise + validate every input. Each field is optional in the
  // /preferences path; /onboarding accepts the same shape so the Settings
  // page and the welcome flow share an endpoint.
  let preferredLeagues = null;
  if (Array.isArray(body.preferredLeagues)) {
    const cleaned = body.preferredLeagues
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && VALID_LEAGUE_IDS.has(n));
    if (cleaned.length === 0) return error(400, 'Pick at least one league');
    preferredLeagues = Array.from(new Set(cleaned));
  }

  let minConfidence = null;
  if (body.minConfidence !== undefined) {
    const n = parseInt(body.minConfidence, 10);
    if (!Number.isFinite(n) || n < 50 || n > 85) return error(400, 'minConfidence must be 50-85');
    minConfidence = n;
  }

  let defaultMarket = null;
  if (body.defaultMarket !== undefined) {
    const m = String(body.defaultMarket).toLowerCase();
    if (!VALID_MARKETS.has(m)) return error(400, 'defaultMarket must be all|over|btts');
    defaultMarket = m;
  }

  // Build a partial update — coalesce keeps unchanged columns intact.
  await sql()`
    UPDATE users SET
      preferred_leagues    = COALESCE(${preferredLeagues}::integer[], preferred_leagues),
      min_confidence       = COALESCE(${minConfidence}::integer, min_confidence),
      default_market       = COALESCE(${defaultMarket}::text, default_market),
      onboarding_completed = CASE WHEN ${isOnboarding} THEN TRUE ELSE onboarding_completed END
    WHERE id = ${user.id}`;

  const [updated] = await sql()`
    SELECT preferred_leagues, min_confidence, default_market, onboarding_completed
    FROM users WHERE id = ${user.id}`;

  return json(200, {
    success: true,
    user: {
      preferredLeagues: updated.preferred_leagues,
      minConfidence: updated.min_confidence,
      defaultMarket: updated.default_market,
      onboardingCompleted: !!updated.onboarding_completed,
    },
  });
}

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function updateEmail(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const { email, password } = parseBody(event);
  if (!validEmail(email)) return error(400, 'Invalid email');
  if (!password) return error(400, 'Current password required');
  const rows = await sql()`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (rows.length === 0) return error(401, 'UNAUTHORIZED');
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return error(401, 'Invalid credentials');
  const existing = await sql()`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
  if (existing.length && existing[0].id !== user.id) return error(409, 'Email taken');
  const updated = await sql()`UPDATE users SET email = ${email.toLowerCase()}
                              WHERE id = ${user.id}
                              RETURNING id, email, tier`;
  return json(200, { user: updated[0] });
}

async function updatePassword(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const { currentPassword, newPassword } = parseBody(event);
  if (!currentPassword || !newPassword) return error(400, 'Both passwords required');
  if (newPassword.length < 8) return error(400, 'New password must be at least 8 characters');
  const rows = await sql()`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (rows.length === 0) return error(401, 'UNAUTHORIZED');
  const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!ok) return error(401, 'Invalid credentials');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await sql()`UPDATE users SET password_hash = ${passwordHash}, refresh_token = NULL WHERE id = ${user.id}`;
  return json(200, { success: true });
}

async function deleteAccount(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const { password } = parseBody(event);
  if (!password) return error(400, 'Password required');
  const rows = await sql()`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (rows.length === 0) return error(401, 'UNAUTHORIZED');
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return error(401, 'Invalid credentials');
  await sql()`DELETE FROM users WHERE id = ${user.id}`;
  return json(
    200,
    { success: true },
    { multiValueHeaders: { 'Set-Cookie': [makeClearCookie('accessToken'), makeClearCookie('refreshToken')] } },
  );
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'user');
    const method = event.httpMethod;
    if (method === 'POST' && path === '/email') return await updateEmail(event);
    if (method === 'POST' && path === '/password') return await updatePassword(event);
    if (method === 'POST' && (path === '/onboarding' || path === '/preferences')) {
      return await savePreferences(event, path === '/onboarding');
    }
    if (method === 'DELETE' && (path === '/' || path === '')) return await deleteAccount(event);
    return notFound();
  } catch (err) {
    console.error('user handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
