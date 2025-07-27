const express = require('express');
const workspaceService = require('../services/workspace');

const router = express.Router();

// Create new project
router.post('/create', async (req, res) => {
  try {
    const { projectName, projectType } = req.body;
    
    if (!projectName || !projectType) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'projectName and projectType are required'
      });
    }

    const project = await workspaceService.createProject(projectName, projectType);
    
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
    const result = await workspaceService.deleteProject(projectId);
    
    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('Delete project error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
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
    const result = await workspaceService.startProject(projectId);
    
    res.json(result);

  } catch (error) {
    console.error('Start project error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
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
    const result = await workspaceService.stopProject(projectId);
    
    res.json(result);

  } catch (error) {
    console.error('Stop project error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
    res.status(statusCode).json({
      error: 'Failed to stop project',
      message: error.message
    });
  }
});

module.exports = router;