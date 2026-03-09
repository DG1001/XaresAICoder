const express = require('express');
const cors = require('cors');
require('dotenv').config();

const projectsRouter = require('./routes/projects');
const workspaceRouter = require('./routes/workspace');
const workshopRouter = require('./routes/workshop');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

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
    protocol: process.env.PROTOCOL || 'http'
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
    const result = await whitelistService.applyWhitelist(domains);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Apply whitelist error:', error);
    res.status(500).json({ error: 'Failed to apply whitelist', message: error.message });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`XaresAICoder Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;