const cookie = require('cookie');

function isProd() {
  return process.env.NODE_ENV !== 'development';
}

function readCookies(event) {
  const header = event.headers && (event.headers.cookie || event.headers.Cookie);
  if (!header) return {};
  try {
    return cookie.parse(header);
  } catch {
    return {};
  }
}

function makeSetCookie(name, value, maxAgeSeconds) {
  return cookie.serialize(name, value, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

function makeClearCookie(name) {
  return cookie.serialize(name, '', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

module.exports = { readCookies, makeSetCookie, makeClearCookie, isProd };
