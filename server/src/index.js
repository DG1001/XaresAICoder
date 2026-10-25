const express = require('express');
const cors = require('cors');
require('dotenv').config();

const projectsRouter = require('./routes/projects');
const workspaceRouter = require('./routes/workspace');
const workshopRouter = require('./routes/workshop');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const auth = require('./services/auth');
const access = require('./services/access');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Admin login for everything under /api except health, login itself and the
// workshop endpoints (see services/auth.js)
app.use('/api', auth.requireLogin);
// Group users: only their projects and a few actions (services/access.js)
app.use('/api', access.restrictGroupUsers);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
  const config = {
    gitServerEnabled: process.env.ENABLE_GIT_SERVER === 'true',
    showDiskUsage: process.env.SHOW_DISK_USAGE === 'true',
    enableProxy: process.env.ENABLE_PROXY === 'true',
    baseDomain: process.env.BASE_DOMAIN || 'localhost',
    basePort: process.env.BASE_PORT || '80',
    protocol: process.env.PROTOCOL || 'http',
    // Default for the per-workspace "allow sudo" choice
    workspaceSudoDefault: process.env.WORKSPACE_SUDO_ENABLED === 'true'
  };

  if (config.gitServerEnabled) {
    // Construct Git server URL
    if (config.basePort === '80' && config.protocol === 'http') {
      config.gitServerUrl = `${config.protocol}://${config.baseDomain}/git/`;
    } else if (config.basePort === '443' && config.protocol === 'https') {
      config.gitServerUrl = `${config.protocol}://${config.baseDomain}/git/`;
    } else {
      config.gitServerUrl = `${config.protocol}://${config.baseDomain}:${config.basePort}/git/`;
    }
  }

  res.json(config);
});

// Resource limits endpoint
app.get('/api/limits', (req, res) => {
  const workspaceService = require('./services/workspace');
  res.json(workspaceService.limits);
});

// Whitelist API routes
const whitelistService = require('./services/whitelist');

app.get('/api/whitelist', async (req, res) => {
  try {
    const result = await whitelistService.getWhitelist();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Get whitelist error:', error);
    res.status(500).json({ error: 'Failed to get whitelist', message: error.message });
  }
});

app.put('/api/whitelist', async (req, res) => {
  try {
    const { domains } = req.body;
    if (!Array.isArray(domains)) {
      return res.status(400).json({ error: 'Invalid request', message: 'domains must be an array' });
    }
    if (domains.length > 5000) {
      return res.status(400).json({ error: 'Invalid request', message: 'Too many domains (max 5000)' });
    }
    const result = await whitelistService.applyWhitelist(domains);
    res.json({ success: true, ...result });
  } catch (error) {
    const status = error.code === 'INVALID' ? 400 : error.code === 'PARSE' ? 422 : 500;
    if (status === 500) console.error('Apply whitelist error:', error);
    res.status(status).json({ error: 'Failed to apply whitelist', message: error.message });
  }
});

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/workshop', workshopRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`XaresAICoder Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);

  // Regenerate the dynamic nginx alias config so it matches projects.json
  // after a server restart. Wait until workspaceService has finished loading
  // projects from disk, otherwise generated config would be empty.
  try {
    const aliasesService = require('./services/aliasesService');
    const workspaceService = require('./services/workspace');
    const dockerService = require('./services/docker');
    // Deny the API to workspace networks before anything else, then give
    // proxied workspaces fixed IPs and move them to their network
    try {
      await aliasesService.writeApiAccessConfig(await dockerService.getWorkspaceNetworkRanges());
    } catch (err) {
      console.error('Could not write API access rules for workspace networks:', err);
    }
    await workspaceService.whenReady.catch(() => {});
    await workspaceService.migrateWorkspaceNetworks();
    await aliasesService.generateNginxConfig(workspaceService);
    await aliasesService.reloadNginx().catch(err =>
      console.warn('Initial nginx reload skipped:', err.message)
    );
    console.log('Alias nginx config regenerated on boot');
  } catch (err) {
    console.error('Failed to regenerate alias config on boot:', err);
  }

  // Per-workspace Forgejo users for workspaces created before them. Last,
  // because it waits for Forgejo, which starts together with this server.
  require('./services/workspace').migrateForgejoUsers().catch(err =>
    console.error('Forgejo user migration failed:', err));
});

module.exports = app;