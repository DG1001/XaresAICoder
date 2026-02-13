const express = require('express');
const workspaceService = require('../services/workspace');
const dockerService = require('../services/docker');

const router = express.Router();

// Create new project
router.post('/create', async (req, res) => {
  try {
    const { projectName, projectType, memoryLimit, cpuCores, passwordProtected, password, createGitRepo, gitUrl, gitUsername, gitToken, group, useProxy } = req.body;
    
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
      group: group || null, // Will default to 'Uncategorized' in service
      useProxy: useProxy !== undefined ? useProxy : (process.env.ENABLE_PROXY === 'true') // Default to global proxy setting
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

// Update workspace password
router.put('/:projectId/password', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { currentPassword, newPassword, removePassword } = req.body;

    // Validate new password if provided
    if (newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({
          error: 'Invalid password',
          message: 'Password must be at least 8 characters long'
        });
      }
      if (newPassword.length > 50) {
        return res.status(400).json({
          error: 'Invalid password',
          message: 'Password must be less than 50 characters'
        });
      }
    }

    if (!newPassword && !removePassword) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Either newPassword or removePassword must be provided'
      });
    }

    const result = await workspaceService.updatePassword(projectId, {
      currentPassword,
      newPassword,
      removePassword: !!removePassword
    });

    res.json({
      success: true,
      message: removePassword ? 'Password protection removed' : 'Password updated successfully',
      passwordProtected: result.passwordProtected
    });

  } catch (error) {
    console.error('Update password error:', error);
    let statusCode = 500;
    if (error.message === 'Project not found') statusCode = 404;
    if (error.message === 'Invalid current password') statusCode = 401;
    if (error.message === 'Current password is required for protected workspaces') statusCode = 401;
    if (error.message.includes('Password must be')) statusCode = 400;

    res.status(statusCode).json({
      error: 'Failed to update password',
      message: error.message
    });
  }
});

// Get disk usage for a project
router.get('/:projectId/disk-usage', async (req, res) => {
  try {
    const { projectId } = req.params;
    const diskUsage = await workspaceService.getProjectDiskUsage(projectId);

    res.json({
      success: true,
      diskUsage
    });

  } catch (error) {
    console.error('Get disk usage error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
    res.status(statusCode).json({
      error: 'Failed to get disk usage',
      message: error.message
    });
  }
});

// Get squid proxy logs for a project
router.get('/:projectId/squid-logs', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { lines = 50 } = req.query;

    // Get workspace IP address
    const ipAddress = await dockerService.getWorkspaceIPAddress(projectId);
    if (!ipAddress) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found or not using proxy'
      });
    }

    // Get squid logs filtered by IP
    const logs = await dockerService.getSquidLogsForWorkspace(ipAddress, parseInt(lines));

    res.json({
      success: true,
      logs,
      ipAddress
    });

  } catch (error) {
    console.error('Get squid logs error:', error);
    const statusCode = error.message === 'Project not found' ? 404 : 500;
    res.status(statusCode).json({
      error: 'Failed to get squid logs',
      message: error.message
    });
  }
});

// Get LLM conversations for a project
router.get('/:projectId/llm-conversations', async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      limit = 100,
      offset = 0,
      model,
      dateFrom,
      dateTo
    } = req.query;

    const ipAddress = await dockerService.getWorkspaceIPAddress(projectId);
    if (!ipAddress) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found or not using proxy'
      });
    }

    const conversations = await dockerService.getLLMConversationsForWorkspace(
      ipAddress,
      parseInt(limit),
      parseInt(offset),
      { model, dateFrom, dateTo }
    );

    res.json({
      success: true,
      projectId,
      ipAddress,
      conversations,
      count: conversations.length
    });

  } catch (error) {
    console.error('Get LLM conversations error:', error);
    res.status(500).json({
      error: 'Failed to get LLM conversations',
      message: error.message
    });
  }
});

// Generate documentation from LLM conversations
router.post('/:projectId/generate-documentation', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { format = 'markdown', type = 'clean' } = req.body;

    const ipAddress = await dockerService.getWorkspaceIPAddress(projectId);
    if (!ipAddress) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    const conversations = await dockerService.getLLMConversationsForWorkspace(
      ipAddress,
      10000  // Get all
    );

    const { generateDocumentationFromConversations } = require('../services/documentation');
    const documentation = generateDocumentationFromConversations(conversations, format, type);

    res.json({
      success: true,
      projectId,
      format,
      type,
      documentation,
      conversationCount: conversations.length
    });

  } catch (error) {
    console.error('Generate documentation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate documentation',
      message: error.message
    });
  }
});

// Delete all LLM conversations for a project
router.delete('/:projectId/llm-conversations', async (req, res) => {
  try {
    const { projectId } = req.params;

    const ipAddress = await dockerService.getWorkspaceIPAddress(projectId);
    if (!ipAddress) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    await dockerService.deleteAllLLMConversations(ipAddress);

    res.json({
      success: true,
      message: 'All conversations deleted successfully'
    });

  } catch (error) {
    console.error('Delete all conversations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete conversations',
      message: error.message
    });
  }
});

// Delete a specific LLM conversation
router.delete('/:projectId/llm-conversations/:timestamp', async (req, res) => {
  try {
    const { projectId, timestamp } = req.params;

    const ipAddress = await dockerService.getWorkspaceIPAddress(projectId);
    if (!ipAddress) {
      return res.status(404).json({
        success: false,
        message: 'Workspace not found'
      });
    }

    await dockerService.deleteLLMConversation(ipAddress, timestamp);

    res.json({
      success: true,
      message: 'Conversation deleted successfully'
    });

  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete conversation',
      message: error.message
    });
  }
});

module.exports = router;