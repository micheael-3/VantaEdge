const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prisma/client');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const ACCESS_MAX_AGE = 15 * 60 * 1000;
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    sameSite: isProd() ? 'none' : 'lax',
    secure: isProd(),
    maxAge,
    path: '/',
  };
}

function signAccess(user) {
  return jwt.sign({ id: user.id, email: user.email, tier: user.tier }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function signRefresh(user) {
  return jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

async function setAuthCookies(res, user) {
  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  const refreshHash = await bcrypt.hash(refreshToken, 10);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: refreshHash } });
  res.cookie('accessToken', accessToken, cookieOpts(ACCESS_MAX_AGE));
  res.cookie('refreshToken', refreshToken, cookieOpts(REFRESH_MAX_AGE));
}

function safeUser(u) {
  return { id: u.id, email: u.email, tier: u.tier };
}

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), passwordHash, tier: 'FREE' },
    });
    await setAuthCookies(res, user);
    return res.status(201).json({ user: safeUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    await setAuthCookies(res, user);
    return res.json({ user: safeUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.refreshToken;
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.refreshToken) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const matches = await bcrypt.compare(token, user.refreshToken);
    if (!matches) return res.status(401).json({ error: 'UNAUTHORIZED' });
    await setAuthCookies(res, user);
    return res.json({ user: safeUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.accessToken;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded && decoded.id) {
          await prisma.user.update({ where: { id: decoded.id }, data: { refreshToken: null } });
        }
      } catch {
        // ignored
      }
    }
    res.clearCookie('accessToken', { ...cookieOpts(0), maxAge: undefined });
    res.clearCookie('refreshToken', { ...cookieOpts(0), maxAge: undefined });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    return res.json({
      user: { id: user.id, email: user.email, tier: user.tier, dailyRefreshes: user.dailyRefreshes },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
