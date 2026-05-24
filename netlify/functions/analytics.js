// /api/analytics — lightweight event collection for the promo banner
// system. Auth-optional: guests and FREE users fire these events too,
// so the handler accepts unauthed POSTs and trusts the client's
// `userTier` hint for segmentation (we cross-check it server-side when
// a session cookie is present — anonymous bodies stay as-is).
//
// Endpoints:
//   POST /api/analytics/banner
//     Body: { event: 'impression'|'click'|'dismiss', bannerId, userTier? }
//     Auth: optional
//     Returns: { ok: true }
//
//   GET /api/analytics/banner/stats           (admin-only)
//     Returns aggregated counts per banner per event for the Banner
//     Stats card in the admin panel.

const { sql } = require('./_shared/db');
const { json, error, notFound, methodNotAllowed, parseBody, subPath } = require('./_shared/response');
const { requireUser } = require('./_shared/auth-mw');

const ALLOWED_EVENTS = new Set(['impression', 'click', 'dismiss']);
const ALLOWED_BANNER_IDS = new Set(['pro_upgrade', 'ebook', 'affiliate', 'social_proof']);

function isMissingTableErr(err) {
  return (
    err &&
    (err.code === '42P01' ||
      /relation "?banner_events"? does not exist/i.test(err.message || ''))
  );
}

// Best-effort tier resolution. If the request carries a valid session
// cookie we trust the server-side tier; otherwise fall back to the
// client's hint (guest pages can't have an authoritative tier without a
// DB lookup, so the hint is the most we can do).
async function resolveTier(event, hint) {
  try {
    const { user } = await requireUser(event);
    if (user) {
      if (user.is_admin) return 'pro'; // admins count as PRO for banner segmentation
      if (user.tier === 'ANALYST' || user.tier === 'EDGE') return 'pro';
      if (user.isGuest) return 'guest';
      return 'free';
    }
  } catch {
    /* no session — fall through */
  }
  if (hint === 'guest' || hint === 'free' || hint === 'pro') return hint;
  return null;
}

async function recordBannerEvent(event) {
  const body = parseBody(event);
  const bannerId = String(body.bannerId || '').trim();
  const eventType = String(body.event || '').trim();
  const hint = body.userTier ? String(body.userTier).toLowerCase() : null;

  if (!ALLOWED_EVENTS.has(eventType)) return error(400, 'invalid event');
  if (!ALLOWED_BANNER_IDS.has(bannerId)) return error(400, 'invalid bannerId');

  const tier = await resolveTier(event, hint);

  try {
    await sql()`
      INSERT INTO banner_events (banner_id, event, user_tier)
      VALUES (${bannerId}, ${eventType}, ${tier})`;
    return json(200, { ok: true });
  } catch (err) {
    if (isMissingTableErr(err)) {
      // Table not migrated — degrade silently. Frontend treats analytics
      // as best-effort and won't notice.
      return json(200, { ok: true, warning: 'banner_events table missing' });
    }
    console.error('[analytics POST] failed:', err.message);
    return error(500, err.message || 'insert failed');
  }
}

// Admin-only aggregate read. Returns:
// { banners: [{ bannerId, impression, click, dismiss }], totals: {...} }
async function bannerStats(event) {
  const { res, user } = await requireUser(event);
  if (res) return res;
  if (!user || !user.is_admin) return error(403, 'Admin only');

  try {
    const rows = await sql()`
      SELECT banner_id, event, COUNT(*)::int AS n
      FROM banner_events
      GROUP BY banner_id, event`;

    const byBanner = {};
    let total = { impression: 0, click: 0, dismiss: 0 };
    for (const r of rows) {
      const id = r.banner_id;
      const ev = r.event;
      const n = Number(r.n || 0);
      if (!byBanner[id]) byBanner[id] = { impression: 0, click: 0, dismiss: 0 };
      if (byBanner[id][ev] != null) byBanner[id][ev] = n;
      if (total[ev] != null) total[ev] += n;
    }

    const banners = Array.from(ALLOWED_BANNER_IDS).map((id) => {
      const row = byBanner[id] || { impression: 0, click: 0, dismiss: 0 };
      const ctr = row.impression > 0
        ? Math.round((row.click / row.impression) * 1000) / 10 // 1dp %
        : 0;
      return {
        bannerId: id,
        impression: row.impression,
        click: row.click,
        dismiss: row.dismiss,
        ctr,
      };
    });

    return json(200, { banners, totals: total });
  } catch (err) {
    if (isMissingTableErr(err)) {
      return json(200, {
        banners: Array.from(ALLOWED_BANNER_IDS).map((id) => ({
          bannerId: id, impression: 0, click: 0, dismiss: 0, ctr: 0,
        })),
        totals: { impression: 0, click: 0, dismiss: 0 },
        warning: 'banner_events table missing — run schema.sql',
      });
    }
    console.error('[analytics stats] failed:', err.message);
    return error(500, err.message || 'stats fetch failed');
  }
}

exports.handler = async (event) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    const path = subPath(event, 'analytics');
    const method = event && event.httpMethod;

    if (method === 'POST' && (path === '/banner' || path === '/banner/')) {
      return await recordBannerEvent(event);
    }
    if (method === 'GET' && (path === '/banner/stats' || path === '/banner/stats/')) {
      return await bannerStats(event);
    }
    if (method && method !== 'GET' && method !== 'POST') return methodNotAllowed();
    return notFound();
  } catch (err) {
    console.error('analytics handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
