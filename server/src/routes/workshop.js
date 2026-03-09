const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

const CLAIMS_FILE  = path.join('/app', 'workspaces', 'workshop-claims.json');
const HISTORY_FILE = path.join('/app', 'workspaces', 'workshop-claims-history.json');

// In-memory maps are the primary truth; files are persistence only
const claims  = new Map(); // projectId → active claim
const history = [];        // released claims (append-only)

// --- Persistence ---

async function loadClaims() {
  try {
    const data = await fs.readFile(CLAIMS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    for (const [projectId, claim] of Object.entries(parsed)) {
      claims.set(projectId, claim);
    }
    console.log(`Workshop: loaded ${claims.size} active claim(s) from disk`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Workshop: failed to load claims:', err.message);
    }
  }
}

async function saveClaims() {
  try {
    const obj = {};
    for (const [projectId, claim] of claims) {
      obj[projectId] = claim;
    }
    await fs.writeFile(CLAIMS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Workshop: failed to save claims:', err.message);
  }
}

async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(data);
    history.push(...parsed);
    console.log(`Workshop: loaded ${history.length} history entry/entries from disk`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Workshop: failed to load history:', err.message);
    }
  }
}

async function saveHistory() {
  try {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Workshop: failed to save history:', err.message);
  }
}

loadClaims();
loadHistory();

// --- Auth helper ---

function requireAdmin(req, res) {
  const adminPassword = (process.env.WORKSHOP_ADMIN_PASSWORD || '').trim();
  if (!adminPassword) return true; // no password configured → open
  const provided = (req.query.password || req.headers['x-admin-password'] || '').trim();
  if (provided !== adminPassword) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// --- Workshop project helpers ---

function getWorkshopGroup() {
  return (process.env.WORKSHOP_GROUP || '').trim();
}

function isWorkshopProject(project) {
  const group = getWorkshopGroup();
  if (!group) return false;
  return (project.projectName || project.name || '').startsWith(group);
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
    const { name, email } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name ist erforderlich.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
    }

    const trimmedName  = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    for (const claim of claims.values()) {
      if (claim.email.toLowerCase() === trimmedEmail) {
        return res.status(409).json({
          error: 'Diese E-Mail-Adresse ist bereits registriert.',
          workspaceUrl: claim.workspaceUrl,
          projectName:  claim.projectName
        });
      }
    }

    const projects = await getWorkshopProjects();
    const claimedProjectIds = new Set(claims.keys());
    const freeProject = projects.find(
      p => p.status === 'running' && !claimedProjectIds.has(p.projectId) && p.workspaceUrl
    );

    if (!freeProject) {
      return res.status(503).json({
        error: 'Leider sind keine Workspaces mehr verfügbar. Bitte wenden Sie sich an den Workshop-Leiter.'
      });
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
    saveClaims();

    res.json({ workspaceUrl: freeProject.workspaceUrl, projectName: claim.projectName });
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

    // Persist both asynchronously
    saveClaims();
    saveHistory();

    res.json({ success: true, released: claim });
  } catch (error) {
    console.error('Workshop release error:', error);
    res.status(500).json({ error: 'Failed to release claim', message: error.message });
  }
});

module.exports = router;
