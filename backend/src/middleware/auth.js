const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies.accessToken;
  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
}

module.exports = authMiddleware;
