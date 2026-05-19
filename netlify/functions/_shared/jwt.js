const jwt = require('jsonwebtoken');

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60;

function signAccess(user) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ id: user.id, email: user.email, tier: user.tier }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function signRefresh(user) {
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET is not set');
  return jwt.sign({ id: user.id, type: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

function verifyAccess(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function verifyRefresh(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  ACCESS_TTL,
  REFRESH_TTL,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
};
