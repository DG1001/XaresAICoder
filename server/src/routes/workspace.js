const express = require('express');
const workspaceService = require('../services/workspace');

const router = express.Router();

// Get workspace statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = workspaceService.getStats();
    
    res.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to get stats',
      message: error.message
    });
  }
});

// Cleanup inactive workspaces (manual trigger)
router.post('/cleanup', async (req, res) => {
  try {
    await workspaceService.cleanupWorkspaces();
    
    res.json({
      success: true,
      message: 'Workspace cleanup completed'
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      error: 'Failed to cleanup workspaces',
      message: error.message
    });
  }
});

module.exports = router;