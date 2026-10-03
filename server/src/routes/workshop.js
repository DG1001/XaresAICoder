const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { writeJsonAtomic, readJson } = require('../services/persistence');

const router = express.Router();

const CLAIMS_FILE  = path.join('/app', 'workspaces', 'workshop-claims.json');
const HISTORY_FILE = path.join('/app', 'workspaces', 'workshop-claims-history.json');

// In-memory maps are the primary truth; files are persistence only
const claims  = new Map(); // projectId → active claim
const history = [];        // released claims (append-only)

// --- Persistence ---

async function loadClaims() {
  try {
    const parsed = await readJson(CLAIMS_FILE);
    if (!parsed) return;
    for (const [projectId, claim] of Object.entries(parsed)) {
      claims.set(projectId, claim);
    }
    console.log(`Workshop: loaded ${claims.size} active claim(s) from disk`);
  } catch (err) {
    console.error('Workshop: failed to load claims:', err.message);
  }
}

async function saveClaims() {
  try {
    await writeJsonAtomic(CLAIMS_FILE, Object.fromEntries(claims));
  } catch (err) {
    console.error('Workshop: failed to save claims:', err.message);
  }
}

async function loadHistory() {
  try {
    const parsed = await readJson(HISTORY_FILE);
    if (!Array.isArray(parsed)) return;
    history.push(...parsed);
    console.log(`Workshop: loaded ${history.length} history entry/entries from disk`);
  } catch (err) {
    console.error('Workshop: failed to load history:', err.message);
  }
}

async function saveHistory() {
  try {
    await writeJsonAtomic(HISTORY_FILE, history);
  } catch (err) {
    console.error('Workshop: failed to save history:', err.message);
  }
}

loadClaims();
loadHistory();

// --- Auth helper ---

// Constant-time comparison (hashing first makes the lengths equal).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Admin endpoints expose participant names and emails, so they fail closed:
// without WORKSHOP_ADMIN_PASSWORD they are disabled. The password is only
// accepted in the X-Admin-Password header (percent-encoded), never in the URL,
// where it would end up in access logs and caches.
function requireAdmin(req, res) {
  const adminPassword = (process.env.WORKSHOP_ADMIN_PASSWORD || '').trim();
  if (!adminPassword) {
    res.status(503).json({ error: 'Workshop admin is disabled. Set WORKSHOP_ADMIN_PASSWORD to enable it.' });
    return false;
  }
  let provided = req.get('X-Admin-Password') || '';
  try { provided = decodeURIComponent(provided); } catch { /* use raw value */ }
  if (!safeEqual(provided.trim(), adminPassword)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Claims are processed one at a time: the duplicate-email check, picking a
// free workspace and recording the claim must not interleave, otherwise two
// participants can be handed the same workspace.
let claimQueue = Promise.resolve();
function withClaimLock(fn) {
  const run = claimQueue.then(fn, fn);
  claimQueue = run.catch(() => {});
  return run;
}

// --- Workshop project helpers ---

function getWorkshopGroup() {
  return (process.env.WORKSHOP_GROUP || '').trim();
}

function isWorkshopProject(project) {
  const group = getWorkshopGroup();
  if (!group) return false;
  return new RegExp('^' + group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+').test(project.projectName || project.name || '');
}

async function getWorkshopProjects() {
  const workspaceService = require('../services/workspace');
  const projects = await workspaceService.listProjects();
  return projects.filter(isWorkshopProject);
}

// --- Routes ---

// GET /api/workshop/status
router.get('/status', async (req, res) => {
  try {
    const projects = await getWorkshopProjects();
    const claimedProjectIds = new Set(claims.keys());
    res.json({
      available: projects.filter(p => p.status === 'running' && !claimedProjectIds.has(p.projectId)).length,
      total:     projects.length,
      claimed:   projects.filter(p => claimedProjectIds.has(p.projectId)).length
    });
  } catch (error) {
    console.error('Workshop status error:', error);
    res.status(500).json({ error: 'Failed to get workshop status', message: error.message });
  }
});

// POST /api/workshop/claim
router.post('/claim', async (req, res) => {
  try {
    const { name, email } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name ist erforderlich.' });
    }
    if (name.trim().length > 100 || /[\x00-\x1f\x7f]/.test(name)) {
      return res.status(400).json({ error: 'Der Name darf höchstens 100 Zeichen lang sein und keine Steuerzeichen enthalten.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || email.trim().length > 254 || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
    }

    const trimmedName  = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    const result = await withClaimLock(async () => {
      for (const claim of claims.values()) {
        if (claim.email.toLowerCase() === trimmedEmail) {
          // No workspace URL here: otherwise anyone who knows a participant's
          // email address could look up their workspace.
          return { status: 409, body: {
            error: 'Diese E-Mail-Adresse ist bereits registriert. Falls du den Link zu deinem Workspace verloren hast, wende dich bitte an die Workshop-Leitung.'
          } };
        }
      }

      const projects = await getWorkshopProjects();
      const freeProject = projects.find(
        p => p.status === 'running' && !claims.has(p.projectId) && p.workspaceUrl
      );

      if (!freeProject) {
        return { status: 503, body: {
          error: 'Leider sind keine Workspaces mehr verfügbar. Bitte wenden Sie sich an den Workshop-Leiter.'
        } };
      }

      const claim = {
        name:         trimmedName,
        email:        trimmedEmail,
        projectName:  freeProject.projectName || freeProject.name,
        workspaceUrl: freeProject.workspaceUrl,
        group:        getWorkshopGroup(),
        claimedAt:    new Date().toISOString()
      };

      claims.set(freeProject.projectId, claim);
      await saveClaims();

      return { status: 200, body: { workspaceUrl: freeProject.workspaceUrl, projectName: claim.projectName } };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Workshop claim error:', error);
    res.status(500).json({ error: 'Interner Fehler. Bitte versuche es erneut.' });
  }
});

// GET /api/workshop/claims  (admin)
router.get('/claims', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const claimList = Array.from(claims.entries()).map(([projectId, c]) => ({
      projectId,
      name:         c.name,
      email:        c.email,
      projectName:  c.projectName,
      workspaceUrl: c.workspaceUrl,
      claimedAt:    c.claimedAt
    }));
    res.json({ claims: claimList, history });
  } catch (error) {
    console.error('Workshop claims list error:', error);
    res.status(500).json({ error: 'Failed to get claims', message: error.message });
  }
});

// POST /api/workshop/claims/:projectId/release  (admin)
router.post('/claims/:projectId/release', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { projectId } = req.params;

    if (!claims.has(projectId)) {
      return res.status(404).json({ error: 'Claim nicht gefunden.' });
    }

    const claim = claims.get(projectId);

    // Move to history log
    history.push({
      ...claim,
      projectId,
      releasedAt: new Date().toISOString()
    });

    claims.delete(projectId);

    await Promise.all([saveClaims(), saveHistory()]);

    res.json({ success: true, released: claim });
  } catch (error) {
    console.error('Workshop release error:', error);
    res.status(500).json({ error: 'Failed to release claim', message: error.message });
  }
});

module.exports = router;
