const crypto = require('crypto');
const { sql } = require('./_shared/db');
const { json, error } = require('./_shared/response');

// Whop webhook handler — replaces the legacy RevenueCat handler.
//
// Whop sends standard JSON to a single endpoint and signs the raw body with
// HMAC-SHA256 using the secret you reveal in the dashboard. The signature is
// delivered in the `whop-signature` header.
//
// Schema note: the users table still has a `revenuecat_id` column. We
// intentionally do NOT read or write that column from here — leaving the
// declaration in place keeps old rows valid, same defensive pattern used for
// the legacy SCOUT tier enum value.

const VALID_TIER = 'ANALYST';
const FREE_TIER = 'FREE';

// Constant-time string compare. Pads the shorter buffer so length mismatches
// don't short-circuit timing-safe semantics in a way that leaks length, and
// always returns false when lengths differ.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Whop signs the raw request body with HMAC-SHA256(secret, body). We accept
// either the raw hex digest, the base64 digest, or a `sha256=<hex>` prefix —
// Whop's docs have varied on the exact format and different libraries emit
// different shapes. Comparing against all three keeps us forward-compatible.
function verifyWhopSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const provided = String(signatureHeader).trim();
  const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8');
  const hex = hmac.digest('hex');
  const hmacB64 = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const prefixed = `sha256=${hex}`;
  return (
    safeEqual(provided, hex) ||
    safeEqual(provided, hmacB64) ||
    safeEqual(provided, prefixed)
  );
}

function readRawBody(event) {
  if (!event.body) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
}

function headerLookup(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

function extractEmail(payload) {
  // Whop payloads commonly look like { data: { user: { email } } } but the
  // schema has wobbled across product types — also check a couple of
  // fallbacks so we don't drop legitimate events on shape drift.
  const data = (payload && payload.data) || {};
  const candidates = [
    data.user && data.user.email,
    data.member && data.member.email,
    data.email,
    payload && payload.user && payload.user.email,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string') return c.trim().toLowerCase();
  }
  return '';
}

async function setUserTier(email, tier) {
  if (!email) {
    console.warn(`[WHOP_WEBHOOK] missing email on event, tier=${tier}`);
    return { matched: false };
  }
  const rows = await sql()`
    SELECT id, email, tier FROM users WHERE LOWER(email) = LOWER(${email})
  `;
  if (rows.length === 0) {
    console.log(`[WHOP_WEBHOOK] no user for email=${email} intended tier=${tier}`);
    return { matched: false };
  }
  const user = rows[0];
  await sql()`UPDATE users SET tier = ${tier} WHERE LOWER(email) = LOWER(${email})`;
  console.log(
    `[WHOP_WEBHOOK] user=${user.id} email=${user.email} tier ${user.tier} -> ${tier}`,
  );
  return { matched: true, userId: user.id };
}

async function handleWhop(event) {
  const rawBody = readRawBody(event);
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  const signature = headerLookup(event.headers, 'whop-signature');

  if (secret) {
    if (!verifyWhopSignature(rawBody, signature, secret)) {
      console.warn('[WHOP_WEBHOOK] invalid signature');
      return error(401, 'invalid signature');
    }
  } else {
    // Dev convenience: without a secret we accept the webhook so local /
    // staging environments work. Production must always set the secret.
    console.warn(
      '[WHOP_WEBHOOK] WHOP_WEBHOOK_SECRET is unset — accepting unsigned webhook (dev only)',
    );
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return error(400, 'invalid JSON');
  }

  // Whop's payloads use `action` for the event type in newer docs but some
  // products still emit `event`. Check both, prefer `action`.
  const action = payload.action || payload.event || '';
  const email = extractEmail(payload);

  if (action === 'membership.went_valid' || action === 'membership.was_created') {
    await setUserTier(email, VALID_TIER);
    return json(200, { received: true, action });
  }
  if (action === 'membership.went_invalid') {
    await setUserTier(email, FREE_TIER);
    return json(200, { received: true, action });
  }

  console.log(`[WHOP_WEBHOOK] ignoring unrecognized action="${action}"`);
  return json(200, { received: true, ignored: true, action });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'POST') return error(405, 'Method not allowed');
    // The netlify.toml redirect /api/webhook/* → /.netlify/functions/webhook/:splat
    // routes /api/webhook/whop here. We don't branch on sub-path anymore — Whop
    // is the only payment provider — but any POST to /api/webhook/* is handled.
    return await handleWhop(event);
  } catch (err) {
    console.error('webhook handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
