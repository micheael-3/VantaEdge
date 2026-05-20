const bcrypt = require('bcryptjs');
const { sql } = require('./_shared/db');
const { json, error, notFound, parseBody, subPath } = require('./_shared/response');
const { readCookies, makeSetCookie, makeClearCookie } = require('./_shared/cookies');
const {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
} = require('./_shared/jwt');
const { requireUser } = require('./_shared/auth-mw');

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeUser(u) {
  return { id: u.id, email: u.email, tier: u.tier };
}

async function setAuthCookies(user) {
  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  const refreshHash = await bcrypt.hash(refreshToken, 10);
  await sql()`UPDATE users SET refresh_token = ${refreshHash} WHERE id = ${user.id}`;
  return [
    makeSetCookie('accessToken', accessToken, ACCESS_MAX_AGE),
    makeSetCookie('refreshToken', refreshToken, REFRESH_MAX_AGE),
  ];
}

async function register(event) {
  const { email, password, referralCode } = parseBody(event);
  if (!validEmail(email)) return error(400, 'Invalid email');
  if (typeof password !== 'string' || password.length < 8) {
    return error(400, 'Password must be at least 8 characters');
  }
  const existing = await sql()`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
  if (existing.length) return error(409, 'Email already registered');

  // Validate referral code if supplied. Don't block on invalid — silently drop.
  let referredBy = null;
  if (typeof referralCode === 'string' && /^[A-Z0-9]{4,12}$/.test(referralCode.toUpperCase())) {
    const code = referralCode.toUpperCase();
    const match = await sql()`SELECT code FROM affiliates WHERE code = ${code}`;
    if (match.length) referredBy = code;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const rows = await sql()`INSERT INTO users (email, password_hash, tier, referred_by)
                           VALUES (${email.toLowerCase()}, ${passwordHash}, 'FREE', ${referredBy})
                           RETURNING id, email, tier`;
  const user = rows[0];
  const cookies = await setAuthCookies(user);
  return json(201, { user: safeUser(user) }, { multiValueHeaders: { 'Set-Cookie': cookies } });
}

async function login(event) {
  const { email, password } = parseBody(event);
  if (!email || !password) return error(400, 'Email and password required');
  const rows = await sql()`SELECT id, email, tier, password_hash FROM users
                           WHERE email = ${String(email).toLowerCase()}`;
  const user = rows[0];
  if (!user) return error(401, 'Invalid credentials');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return error(401, 'Invalid credentials');
  const cookies = await setAuthCookies(user);
  return json(200, { user: safeUser(user) }, { multiValueHeaders: { 'Set-Cookie': cookies } });
}

async function refresh(event) {
  const token = readCookies(event).refreshToken;
  if (!token) return error(401, 'UNAUTHORIZED');
  let decoded;
  try {
    decoded = verifyRefresh(token);
  } catch {
    return error(401, 'UNAUTHORIZED');
  }
  const rows = await sql()`SELECT id, email, tier, refresh_token FROM users WHERE id = ${decoded.id}`;
  const user = rows[0];
  if (!user || !user.refresh_token) return error(401, 'UNAUTHORIZED');
  const matches = await bcrypt.compare(token, user.refresh_token);
  if (!matches) return error(401, 'UNAUTHORIZED');
  const cookies = await setAuthCookies(user);
  return json(200, { user: safeUser(user) }, { multiValueHeaders: { 'Set-Cookie': cookies } });
}

async function logout(event) {
  const token = readCookies(event).accessToken;
  if (token) {
    try {
      const decoded = verifyAccess(token);
      if (decoded && decoded.id) {
        await sql()`UPDATE users SET refresh_token = NULL WHERE id = ${decoded.id}`;
      }
    } catch {
      // ignore
    }
  }
  const cookies = [makeClearCookie('accessToken'), makeClearCookie('refreshToken')];
  return json(200, { success: true }, { multiValueHeaders: { 'Set-Cookie': cookies } });
}

async function me(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  const [extra] = await sql()`
    SELECT email_notifications, onboarding_completed, preferred_leagues,
           min_confidence, default_market
    FROM users WHERE id = ${user.id}`;
  return json(200, {
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      dailyRefreshes: user.daily_refreshes,
      emailNotifications: extra ? !!extra.email_notifications : true,
      onboardingCompleted: extra ? !!extra.onboarding_completed : false,
      preferredLeagues: extra && extra.preferred_leagues ? extra.preferred_leagues : null,
      minConfidence: extra && extra.min_confidence != null ? Number(extra.min_confidence) : 65,
      defaultMarket: extra && extra.default_market ? extra.default_market : 'all',
    },
  });
}

exports.handler = async (event) => {
  try {
    const path = subPath(event, 'auth');
    const method = event.httpMethod;
    if (method === 'OPTIONS') return { statusCode: 204, body: '' };

    if (method === 'POST' && path === '/register') return await register(event);
    if (method === 'POST' && path === '/login') return await login(event);
    if (method === 'POST' && path === '/refresh') return await refresh(event);
    if (method === 'POST' && path === '/logout') return await logout(event);
    if (method === 'GET' && path === '/me') return await me(event);

    return notFound();
  } catch (err) {
    console.error('auth handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
