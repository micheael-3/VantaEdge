const bcrypt = require('bcryptjs');
const { sql } = require('./_shared/db');
const { json, error, notFound, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');
const { makeClearCookie } = require('./_shared/cookies');

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
    if (method === 'DELETE' && (path === '/' || path === '')) return await deleteAccount(event);
    return notFound();
  } catch (err) {
    console.error('user handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
