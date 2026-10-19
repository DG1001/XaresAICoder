const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Admin login for the platform API: one shared password (ADMIN_PASSWORD),
// sessions as signed, HttpOnly cookies. Without a password the API stays
// locked (deploy.sh generates one).

const COOKIE_NAME = 'xares_admin';
const SECRET_FILE = path.join('/app', 'workspaces', '.session-secret');
const SESSION_HOURS = Math.min(Math.max(parseFloat(process.env.ADMIN_SESSION_HOURS) || 12, 0.25), 24 * 30);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;

// Paths under /api that work without a session. The workshop router checks
// admin access itself (session or WORKSHOP_ADMIN_PASSWORD), its participant
// endpoints are public.
const PUBLIC_PATHS = [/^\/health$/, /^\/auth\//, /^\/workshop(\/|$)/];

function adminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

// Signing key per server installation, kept in the data volume so sessions
// survive restarts. Mixed with the password: changing it ends all sessions.
let secret = null;
function signingKey() {
  if (!secret) {
    try {
      secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    } catch {
      secret = crypto.randomBytes(32).toString('hex');
      try {
        fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
        fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
      } catch (err) {
        console.warn(`Could not persist session secret (${err.message}); sessions end on restart`);
      }
    }
  }
  return crypto.createHmac('sha256', secret).update('session:' + adminPassword()).digest();
}

function sign(payload) {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

// Constant-time comparison (hashing first makes the lengths equal)
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Logged-out sessions until they would have expired anyway (in memory: a
// restart forgets them, the cookie is cleared in the browser regardless)
const revoked = new Map();

function createSession() {
  const expires = Math.floor(Date.now() / 1000) + Math.round(SESSION_HOURS * 3600);
  const payload = `${expires}.${crypto.randomBytes(12).toString('base64url')}`;
  return { token: `${payload}.${sign(payload)}`, maxAge: expires * 1000 - Date.now() };
}

function verifySession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !adminPassword()) return false;
  const [expires, nonce, signature] = parts;
  if (!safeEqual(signature, sign(`${expires}.${nonce}`))) return false;
  if (!(Number(expires) * 1000 > Date.now())) return false;
  return !revoked.has(nonce);
}

function revokeSession(token) {
  const [expires, nonce] = String(token || '').split('.');
  if (!nonce) return;
  revoked.set(nonce, Number(expires) * 1000);
  for (const [n, until] of revoked) if (until < Date.now()) revoked.delete(n);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function cookieAttributes(maxAgeMs) {
  const secure = process.env.PROTOCOL === 'https' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}${secure}`;
}

function hasValidSession(req) {
  return verifySession(readCookie(req, COOKIE_NAME));
}

// Workspace apps run on subdomains of the platform domain: same-site, so the
// browser sends SameSite=Strict cookies along. A request that changes state
// must therefore come from the dashboard's own origin. Clients without
// Origin/Sec-Fetch-Site (curl, scripts) are not browsers and pass.
function isCrossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const fetchSite = req.get('Sec-Fetch-Site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return true;
  const origin = req.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).hostname !== req.hostname;
  } catch {
    return true; // "null" and other opaque origins
  }
}

// Session or nothing, for code that has its own fallback (workshop admin)
function isAdminRequest(req) {
  return !!adminPassword() && hasValidSession(req) && !isCrossSiteWrite(req);
}

function requireLogin(req, res, next) {
  if (PUBLIC_PATHS.some(p => p.test(req.path))) return next();
  if (!adminPassword()) {
    return res.status(503).json({
      error: 'Admin login not configured',
      code: 'LOGIN_NOT_CONFIGURED',
      message: 'Set ADMIN_PASSWORD in .env and redeploy (./deploy.sh generates one).'
    });
  }
  if (!hasValidSession(req)) {
    return res.status(401).json({ error: 'Login required', code: 'LOGIN_REQUIRED' });
  }
  if (isCrossSiteWrite(req)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
}

// Failed logins per client (nginx passes the client in X-Real-IP; the API is
// only reachable through nginx)
const failedLogins = new Map();

function clientKey(req) {
  return req.get('X-Real-IP') || req.ip || 'unknown';
}

function loginBlocked(req) {
  const entry = failedLogins.get(clientKey(req));
  if (!entry) return false;
  if (Date.now() - entry.since > LOGIN_WINDOW_MS) {
    failedLogins.delete(clientKey(req));
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}

function recordFailedLogin(req) {
  if (failedLogins.size > 1000) {
    for (const [k, e] of failedLogins) if (Date.now() - e.since > LOGIN_WINDOW_MS) failedLogins.delete(k);
  }
  const key = clientKey(req);
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.since > LOGIN_WINDOW_MS) {
    failedLogins.set(key, { count: 1, since: Date.now() });
  } else {
    entry.count++;
  }
}

function checkPassword(password) {
  return !!adminPassword() && typeof password === 'string' && safeEqual(password, adminPassword());
}

module.exports = {
  COOKIE_NAME,
  requireLogin,
  isAdminRequest,
  hasValidSession,
  isCrossSiteWrite,
  createSession,
  revokeSession,
  readCookie,
  cookieAttributes,
  checkPassword,
  loginBlocked,
  recordFailedLogin,
  clearFailedLogins: req => failedLogins.delete(clientKey(req)),
  isConfigured: () => !!adminPassword(),
  safeEqual
};
