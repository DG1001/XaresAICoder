const express = require('express');
const workspaceService = require('../services/workspace');

const router = express.Router();

// Create new project
router.post('/create', async (req, res) => {
  try {
    const { projectName, projectType, memoryLimit, passwordProtected, password, createGitRepo } = req.body;
    
    if (!projectName || !projectType) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'projectName and projectType are required'
      });
    }

    // Validate memory limit
    const validMemoryLimits = ['1g', '2g', '4g'];
    if (memoryLimit && !validMemoryLimits.includes(memoryLimit)) {
      return res.status(400).json({
        error: 'Invalid memory limit',
        message: 'Memory limit must be one of: 1g, 2g, 4g'
      });
    }

    // Validate password if protection is enabled
    if (passwordProtected) {
      if (!password || password.length < 8) {
        return res.status(400).json({
          error: 'Invalid password',
          message: 'Password must be at least 8 characters long'
        });
      }
      
      if (password.length > 50) {
        return res.status(400).json({
          error: 'Invalid password',
          message: 'Password must be less than 50 characters'
        });
      }
    }

    const project = await workspaceService.createProject(projectName, projectType, {
      memoryLimit: memoryLimit || '2g', // Default to 2g if not specified
      passwordProtected: !!passwordProtected,
      password: passwordProtected ? password : null,
      createGitRepo: !!createGitRepo
    });
    
    res.status(201).json({
      success: true,
      project
    });

  } catch (error) {
    console.error('Create project error:', error);
    res.status(400).json({
      error: 'Failed to create project',
      message: error.message
    });
  }
});

// Get project details
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await workspaceService.getProject(projectId);
    
    res.json({
      success: true,
      project
    });

  } catch (error) {
    console.error('Get project error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
    res.status(statusCode).json({
      error: 'Failed to get project',
      message: error.message
    });
  }
});

// Delete project
router.delete('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { password } = req.body;
    const result = await workspaceService.deleteProject(projectId, password);
    
    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('Delete project error:', error);
    let statusCode = 500;
    if (error.message === 'Project not found') statusCode = 404;
    if (error.message === 'Invalid password for protected workspace') statusCode = 401;
    
    res.status(statusCode).json({
      error: 'Failed to delete project',
      message: error.message
    });
  }
});

// List all projects
router.get('/', async (req, res) => {
  try {
    const projects = await workspaceService.listProjects();
    
    res.json({
      success: true,
      projects,
      count: projects.length
    });

  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({
      error: 'Failed to list projects',
      message: error.message
    });
  }
});

// Start project
router.post('/:projectId/start', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { password } = req.body;
    const result = await workspaceService.startProject(projectId, password);
    
    res.json(result);

  } catch (error) {
    console.error('Start project error:', error);
    let statusCode = 500;
    if (error.message === 'Project not found') statusCode = 404;
    if (error.message === 'Invalid password for protected workspace') statusCode = 401;
    
    res.status(statusCode).json({
      error: 'Failed to start project',
      message: error.message
    });
  }
});

// Stop project
router.post('/:projectId/stop', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { password } = req.body;
    const result = await workspaceService.stopProject(projectId, password);
    
    res.json(result);

  } catch (error) {
    console.error('Stop project error:', error);
    let statusCode = 500;
    if (error.message === 'Project not found') statusCode = 404;
    if (error.message === 'Invalid password for protected workspace') statusCode = 401;
    
    res.status(statusCode).json({
      error: 'Failed to stop project',
      message: error.message
    });
  }
});

module.exports = router;