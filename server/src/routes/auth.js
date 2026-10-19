const express = require('express');
const auth = require('../services/auth');

const router = express.Router();

// Whether login is configured and this browser has a session
router.get('/status', (req, res) => {
  res.json({ configured: auth.isConfigured(), authenticated: auth.isConfigured() && auth.hasValidSession(req) });
});

router.post('/login', (req, res) => {
  if (!auth.isConfigured()) {
    return res.status(503).json({ error: 'Admin login not configured', code: 'LOGIN_NOT_CONFIGURED' });
  }
  if (auth.isCrossSiteWrite(req)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  if (auth.loginBlocked(req)) {
    return res.status(429).json({ error: 'Too many failed logins, try again later' });
  }
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    auth.recordFailedLogin(req);
    console.warn(`Failed admin login from ${req.get('X-Real-IP') || req.ip}`);
    return res.status(401).json({ error: 'Invalid password' });
  }
  auth.clearFailedLogins(req);
  const { token, maxAge } = auth.createSession();
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=${token}; ${auth.cookieAttributes(maxAge)}`);
  res.json({ authenticated: true });
});

router.post('/logout', (req, res) => {
  auth.revokeSession(auth.readCookie(req, auth.COOKIE_NAME));
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; ${auth.cookieAttributes(0)}`);
  res.json({ authenticated: false });
});

module.exports = router;
