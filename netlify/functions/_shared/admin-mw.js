const crypto = require('crypto');
const { error } = require('./response');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(event) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return error(503, 'Admin disabled (ADMIN_PASSWORD not set)');
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  if (!auth) return error(401, 'UNAUTHORIZED');
  const provided = auth.replace(/^Bearer\s+/i, '').trim();
  if (!timingSafeEqual(provided, secret)) return error(401, 'UNAUTHORIZED');
  return null;
}

module.exports = { requireAdmin };
