const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/email', authMiddleware, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!password) return res.status(400).json({ error: 'Current password required' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing && existing.id !== user.id) return res.status(409).json({ error: 'Email taken' });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: email.toLowerCase() },
    });
    return res.json({ user: { id: updated.id, email: updated.email, tier: updated.tier } });
  } catch (err) {
    return next(err);
  }
});

router.post('/password', authMiddleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash, refreshToken: null } });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.delete('/', authMiddleware, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (!password) return res.status(400).json({ error: 'Password required' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    await prisma.prediction.deleteMany({ where: { userId: user.id } });
    await prisma.predictionHistory.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
