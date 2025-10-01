const express = require('express');
const workspaceService = require('../services/workspace');

const router = express.Router();

// Create new project
router.post('/create', async (req, res) => {
  try {
    const { projectName, projectType, memoryLimit, cpuCores, passwordProtected, password, createGitRepo, gitUrl, gitUsername, gitToken, group } = req.body;
    
    if (!projectName) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'projectName is required'
      });
    }

    // Validate Git URL if using git-clone type
    if (projectType === 'git-clone') {
      if (!gitUrl) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'gitUrl is required when using git-clone project type'
        });
      }

      // Validate Git URL format (only HTTP/HTTPS)
      const urlPattern = /^https?:\/\/.+/i;
      if (!urlPattern.test(gitUrl)) {
        return res.status(400).json({
          error: 'Invalid Git URL',
          message: 'Only HTTP and HTTPS Git URLs are supported for security'
        });
      }
    }

    // Validate memory limit
    const validMemoryLimits = ['1g', '2g', '4g', '8g', '16g'];
    if (memoryLimit && !validMemoryLimits.includes(memoryLimit)) {
      return res.status(400).json({
        error: 'Invalid memory limit',
        message: 'Memory limit must be one of: 1g, 2g, 4g, 8g, 16g'
      });
    }

    // Validate CPU cores
    const validCpuCores = ['1', '2', '4', '8'];
    if (cpuCores && !validCpuCores.includes(cpuCores)) {
      return res.status(400).json({
        error: 'Invalid CPU cores',
        message: 'CPU cores must be one of: 1, 2, 4, 8'
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

    const project = await workspaceService.createProject(projectName, projectType || 'empty', {
      memoryLimit: memoryLimit || '2g', // Default to 2g if not specified
      cpuCores: cpuCores || '2', // Default to 2 cores if not specified
      passwordProtected: !!passwordProtected,
      password: passwordProtected ? password : null,
      createGitRepo: !!createGitRepo,
      gitUrl: gitUrl || null,
      gitUsername: gitUsername || null,
      gitToken: gitToken || null,
      group: group || null // Will default to 'Uncategorized' in service
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

// Get all groups (must be before /:projectId route)
router.get('/groups', async (req, res) => {
  try {
    const groups = await workspaceService.getGroups();

    res.json({
      success: true,
      groups
    });

  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      error: 'Failed to get groups',
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

// Get project notes
router.get('/:projectId/notes', async (req, res) => {
  try {
    const { projectId } = req.params;
    const notes = await workspaceService.getProjectNotes(projectId);
    
    res.json({
      success: true,
      notes: notes || ''
    });

  } catch (error) {
    console.error('Get project notes error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
    res.status(statusCode).json({
      error: 'Failed to get project notes',
      message: error.message
    });
  }
});

// Update project notes
router.put('/:projectId/notes', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { notes } = req.body;

    // Validate notes length (limit to 10KB)
    if (notes && notes.length > 10240) {
      return res.status(400).json({
        error: 'Notes too long',
        message: 'Notes must be less than 10KB'
      });
    }

    await workspaceService.updateProjectNotes(projectId, notes || '');

    res.json({
      success: true,
      message: 'Notes updated successfully'
    });

  } catch (error) {
    console.error('Update project notes error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
    res.status(statusCode).json({
      error: 'Failed to update project notes',
      message: error.message
    });
  }
});

// Update project group
router.put('/:projectId/group', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { group } = req.body;

    if (!group || typeof group !== 'string') {
      return res.status(400).json({
        error: 'Invalid group',
        message: 'Group name is required and must be a string'
      });
    }

    const result = await workspaceService.updateProjectGroup(projectId, group);

    res.json(result);

  } catch (error) {
    console.error('Update project group error:', error);
    let statusCode = 500;
    if (error.message === 'Project not found') statusCode = 404;
    if (error.message.includes('Group name')) statusCode = 400;

    res.status(statusCode).json({
      error: 'Failed to update project group',
      message: error.message
    });
  }
});

module.exports = router;