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
  // Guests have no DB row — return the synthetic guest shape so the
  // frontend bootstrap can detect "guest mode" without crashing.
  if (user.isGuest) {
    return json(200, {
      user: null,
      isGuest: true,
    });
  }
  const [extra] = await sql()`
    SELECT email_notifications, onboarding_completed, preferred_leagues,
           min_confidence, default_market
    FROM users WHERE id = ${user.id}`;
  return json(200, {
    user: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      isAdmin: !!user.is_admin,
      dailyRefreshes: user.daily_refreshes,
      emailNotifications: extra ? !!extra.email_notifications : true,
      onboardingCompleted: extra ? !!extra.onboarding_completed : false,
      preferredLeagues: extra && extra.preferred_leagues ? extra.preferred_leagues : null,
      minConfidence: extra && extra.min_confidence != null ? Number(extra.min_confidence) : 65,
      defaultMarket: extra && extra.default_market ? extra.default_market : 'all',
    },
  });
}

// POST /api/auth/guest
//
// Mints a guest access token (no refresh token, no DB row). Frontend
// calls this when a visitor clicks "Start Free" on the landing page so
// the predictions cascade sees a valid JWT and serves data. Idempotent
// — calling it twice just overwrites the cookie. Cookie has the same
// 15-min TTL as a real access token; the frontend re-mints on demand
// using the sessionStorage `__fs_guest` flag.
async function guestSession() {
  if (!process.env.JWT_SECRET) return error(500, 'JWT_SECRET not set');
  const accessToken = signAccess({ id: null, email: null, tier: 'GUEST' });
  const cookies = [makeSetCookie('accessToken', accessToken, ACCESS_MAX_AGE)];
  return json(200, { ok: true, isGuest: true }, { multiValueHeaders: { 'Set-Cookie': cookies } });
}

// Diagnostic: returns the raw user row from the DB for the current JWT,
// PLUS lists every user with is_admin = TRUE so we can verify the admin
// SQL actually matched a row. Auth-required (JWT cookie) — no extra
// secret needed since the only sensitive info revealed is your own row.
async function whoami(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;

  // Raw row from DB — bypasses the auth-mw resilience fallback so we see
  // the real values, including is_admin.
  let rawRow = null;
  let columnExists = true;
  try {
    const rows = await sql()`SELECT id, email, tier, is_admin, created_at
                             FROM users WHERE id = ${user.id}`;
    rawRow = rows[0] || null;
  } catch (err) {
    columnExists = false;
    rawRow = { error: err.message, code: err.code };
  }

  // Who else is admin? Lists all admins so we can spot if the UPDATE
  // matched the wrong row, or if there are zero admins at all.
  let allAdmins = [];
  try {
    allAdmins = await sql()`SELECT id, email, tier, is_admin FROM users WHERE is_admin = TRUE`;
  } catch {
    allAdmins = [{ error: 'is_admin column missing — run /api/migrate' }];
  }

  // Case-insensitive match for the specific email so we can see whether
  // the user's email-at-signup matches what they expected.
  const targetEmail = 'panayidesmichalis81@gmail.com';
  let exactMatch = null;
  try {
    const rows = await sql()`SELECT id, email, tier, is_admin
                             FROM users
                             WHERE LOWER(email) = LOWER(${targetEmail})`;
    exactMatch = rows[0] || null;
  } catch (err) {
    exactMatch = { error: err.message };
  }

  return json(200, {
    diagnostic: 'whoami',
    jwtUser: {
      id: user.id,
      email: user.email,
      tier: user.tier,
      is_admin_from_authMw: !!user.is_admin,
    },
    rawDbRow: rawRow,
    is_admin_column_exists: columnExists,
    foundUserByTargetEmail: exactMatch,
    allAdminUsersInDb: allAdmins,
    hint:
      rawRow && rawRow.is_admin
        ? 'is_admin=TRUE in DB. If the UI still shows you as FREE, log out and log back in to refresh the JWT cookie.'
        : exactMatch && exactMatch.id !== user.id
        ? 'The target email exists in DB but as a DIFFERENT user from the one you are logged in as. You signed up with a different email/account.'
        : exactMatch && !exactMatch.is_admin
        ? 'Target email exists but is_admin=FALSE in DB. The UPDATE SQL did not run successfully or matched 0 rows.'
        : !exactMatch
        ? 'No user with that email exists in the DB. Check what email you actually signed up with.'
        : 'is_admin=FALSE on your row. Run the admin UPDATE SQL.',
  });
}

// One-shot admin grant. Gated on the ADMIN_PASSWORD env var so only the
// site operator can call it. Hits the real Neon DB the deployed function
// is connected to — no chance of accidentally running against the wrong
// branch like the SQL editor allows.
//
// Usage: GET /api/auth/grant-admin?key=<ADMIN_PASSWORD>&email=<email>
async function grantAdmin(event) {
  const params = (event && event.queryStringParameters) || {};
  const supplied = params.key || '';
  const expected = process.env.ADMIN_PASSWORD || '';
  const email = (params.email || '').trim();

  if (!expected) {
    return json(500, { error: 'ADMIN_PASSWORD env var is not set on the server.' });
  }
  if (supplied !== expected) {
    return json(401, { error: 'Unauthorized. Append ?key=<ADMIN_PASSWORD>&email=<email>.' });
  }
  if (!email) {
    return json(400, { error: 'Missing ?email= parameter.' });
  }

  try {
    const rows = await sql()`
      UPDATE users
      SET is_admin = TRUE
      WHERE LOWER(email) = LOWER(${email})
      RETURNING id, email, tier, is_admin`;

    if (rows.length === 0) {
      // List candidate emails so the operator can see what's actually
      // in the DB and pick the right one.
      const candidates = await sql()`
        SELECT email FROM users
        ORDER BY created_at DESC
        LIMIT 20`;
      return json(404, {
        error: `No user found with email ${email}`,
        hint: 'The email did not match any row in the DB (case-insensitive). One of these existing emails is yours:',
        existingEmails: candidates.map((r) => r.email),
      });
    }

    return json(200, {
      ok: true,
      message: 'Admin granted. Log out and log back in to refresh your JWT cookie, then the Admin Panel link will appear in the sidebar.',
      updatedUser: rows[0],
    });
  } catch (err) {
    if (err && (err.code === '42703' || /column "?is_admin"? does not exist/i.test(err.message || ''))) {
      return json(500, {
        error: 'is_admin column is missing — hit /api/migrate?key=<ADMIN_PASSWORD> first to apply the schema.',
        details: err.message,
      });
    }
    return json(500, { error: err.message, code: err.code });
  }
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
    if (method === 'POST' && path === '/guest') return await guestSession();
    if (method === 'GET' && path === '/me') return await me(event);
    if (method === 'GET' && path === '/whoami') return await whoami(event);
    if (method === 'GET' && path === '/grant-admin') return await grantAdmin(event);

    return notFound();
  } catch (err) {
    console.error('auth handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
