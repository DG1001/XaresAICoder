const express = require('express');
const auth = require('../services/auth');
const users = require('../services/users');

const router = express.Router();

// Whether login is configured, and who this browser is logged in as
router.get('/status', (req, res) => {
  const user = auth.isConfigured() ? auth.sessionUser(req) : null;
  res.json({
    configured: auth.isConfigured(),
    authenticated: !!user,
    ...(user && { role: user.role }),
    ...(user && user.role === 'group' && { username: user.username, groups: user.groups })
  });
});

router.post('/login', async (req, res) => {
  if (!auth.isConfigured()) {
    return res.status(503).json({ error: 'Admin login not configured', code: 'LOGIN_NOT_CONFIGURED' });
  }
  if (auth.isCrossSiteWrite(req)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  if (auth.loginBlocked(req)) {
    return res.status(429).json({ error: 'Too many failed logins, try again later' });
  }
  // { password } or { username: "admin", password }: admin;
  // { username, password }: group user
  const { username, password } = req.body || {};
  const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
  let session;
  if (!name || name === 'admin') {
    if (auth.checkPassword(password)) session = { uid: 'admin', version: 0, role: 'admin' };
  } else {
    const user = await users.verifyLogin(name, password);
    if (user) session = { uid: user.id, version: user.sessionVersion, role: 'group' };
  }
  if (!session) {
    auth.recordFailedLogin(req);
    console.warn(`Failed login${name ? ` as ${name}` : ''} from ${req.get('X-Real-IP') || req.ip}`);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  auth.clearFailedLogins(req);
  const { token, maxAge } = auth.createSession(session.uid, session.version);
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=${token}; ${auth.cookieAttributes(maxAge)}`);
  res.json({ authenticated: true, role: session.role });
});

router.post('/logout', (req, res) => {
  auth.revokeSession(auth.readCookie(req, auth.COOKIE_NAME));
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; ${auth.cookieAttributes(0)}`);
  res.json({ authenticated: false });
});

module.exports = router;
