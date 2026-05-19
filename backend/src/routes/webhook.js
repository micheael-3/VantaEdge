const express = require('express');
const crypto = require('crypto');
const prisma = require('../prisma/client');

const router = express.Router();

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

function verifySignature(req) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  const headerAuth = req.headers['authorization'] || req.headers['x-revenuecat-signature'] || '';
  if (!headerAuth) return false;
  const provided = headerAuth.replace(/^Bearer\s+/i, '').trim();
  return timingSafeEqual(provided, secret);
}

router.post('/revenuecat', async (req, res, next) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).json({ error: 'invalid signature' });
    }
    const event = req.body && req.body.event;
    if (!event || !event.type) {
      return res.status(400).json({ error: 'missing event' });
    }

    const productId = event.product_id || (Array.isArray(event.entitlement_ids) && event.entitlement_ids[0]);
    const appUserId = event.app_user_id;
    const aliases = event.aliases || [];
    const lookupIds = [appUserId, ...aliases].filter(Boolean);

    let user = null;
    if (lookupIds.length) {
      user = await prisma.user.findFirst({ where: { OR: lookupIds.map((id) => ({ revenuecatId: id })) } });
    }
    if (!user && appUserId && appUserId.includes('@')) {
      user = await prisma.user.findUnique({ where: { email: appUserId.toLowerCase() } });
    }
    if (!user) {
      return res.status(200).json({ received: true, matched: false });
    }

    const type = event.type;
    let newTier = user.tier;

    if (type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'PRODUCT_CHANGE' || type === 'UNCANCELLATION') {
      newTier = PRODUCT_TO_TIER[productId] || newTier;
    } else if (type === 'CANCELLATION' || type === 'EXPIRATION') {
      newTier = 'FREE';
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { tier: newTier, revenuecatId: appUserId || user.revenuecatId },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
