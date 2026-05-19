const crypto = require('crypto');
const { sql } = require('./_shared/db');
const { json, error, notFound, parseRaw, subPath } = require('./_shared/response');

const PRODUCT_TO_TIER = {
  vantaedge_scout_monthly: 'SCOUT',
  vantaedge_analyst_monthly: 'ANALYST',
  vantaedge_edge_monthly: 'EDGE',
};

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifySignature(event) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const headers = event.headers || {};
  const headerAuth = headers.authorization || headers.Authorization || headers['x-revenuecat-signature'] || '';
  if (!headerAuth) return false;
  const provided = headerAuth.replace(/^Bearer\s+/i, '').trim();
  return timingSafeEqual(provided, secret);
}

async function revenuecat(event) {
  if (!verifySignature(event)) return error(401, 'invalid signature');

  let body;
  try {
    body = JSON.parse(parseRaw(event) || '{}');
  } catch {
    return error(400, 'invalid JSON');
  }

  const ev = body && body.event;
  if (!ev || !ev.type) return error(400, 'missing event');

  const productId = ev.product_id || (Array.isArray(ev.entitlement_ids) && ev.entitlement_ids[0]);
  const appUserId = ev.app_user_id;
  const aliases = Array.isArray(ev.aliases) ? ev.aliases : [];
  const lookupIds = [appUserId, ...aliases].filter(Boolean);

  let user = null;
  if (lookupIds.length) {
    const matches = await sql()`SELECT id, tier FROM users WHERE revenuecat_id = ANY(${lookupIds})`;
    user = matches[0] || null;
  }
  if (!user && appUserId && appUserId.includes('@')) {
    const matches = await sql()`SELECT id, tier FROM users WHERE email = ${appUserId.toLowerCase()}`;
    user = matches[0] || null;
  }
  if (!user) return json(200, { received: true, matched: false });

  const type = ev.type;
  let newTier = user.tier;
  if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'PRODUCT_CHANGE' || type === 'UNCANCELLATION') {
    newTier = PRODUCT_TO_TIER[productId] || newTier;
  } else if (type === 'CANCELLATION' || type === 'EXPIRATION') {
    newTier = 'FREE';
  }

  await sql()`UPDATE users
              SET tier = ${newTier},
                  revenuecat_id = COALESCE(${appUserId}, revenuecat_id)
              WHERE id = ${user.id}`;

  return json(200, { received: true });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'POST') return error(405, 'Method not allowed');
    const path = subPath(event, 'webhook');
    if (path === '/revenuecat') return await revenuecat(event);
    return notFound();
  } catch (err) {
    console.error('webhook handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
