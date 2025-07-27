const { v4: uuidv4 } = require('uuid');
const dockerService = require('./docker');

class WorkspaceService {
  constructor() {
    this.projects = new Map();
    this.maxWorkspacesPerUser = parseInt(process.env.MAX_WORKSPACES_PER_USER) || 5;
    
    // Start cleanup interval
    setInterval(() => {
      this.cleanupWorkspaces();
    }, 10 * 60 * 1000); // Every 10 minutes
  }

  async createProject(projectName, projectType, userId = 'default') {
    try {
      // Validate input
      if (!projectName || !projectType) {
        throw new Error('Project name and type are required');
      }

      if (!['python-flask', 'node-react'].includes(projectType)) {
        throw new Error('Invalid project type. Supported: python-flask, node-react');
      }

      // Check workspace limit
      const userProjects = Array.from(this.projects.values())
        .filter(p => p.userId === userId);
      
      if (userProjects.length >= this.maxWorkspacesPerUser) {
        throw new Error(`Maximum ${this.maxWorkspacesPerUser} workspaces per user`);
      }

      // Generate unique project ID
      const projectId = uuidv4();

      // Create Docker container
      const workspace = await dockerService.createWorkspaceContainer(projectId, projectType);

      // Store project metadata
      const project = {
        projectId,
        projectName: projectName.trim(),
        projectType,
        userId,
        createdAt: new Date(),
        lastAccessed: new Date(),
        status: 'running',
        workspaceUrl: workspace.workspaceUrl
      };

      this.projects.set(projectId, project);

      return {
        projectId,
        projectName: project.projectName,
        projectType,
        workspaceUrl: workspace.workspaceUrl,
        status: 'running',
        createdAt: project.createdAt
      };

    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  }

  async getProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Update last accessed time
    project.lastAccessed = new Date();

    // Get current status from Docker
    const dockerStatus = await dockerService.getProjectStatus(projectId);
    project.status = dockerStatus.status;

    return {
      ...project,
      containerInfo: dockerStatus.containerInfo
    };
  }

  async startProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    try {
      const result = await dockerService.startWorkspace(projectId);
      project.status = result.status || 'running';
      project.lastAccessed = new Date();
      
      return {
        success: true,
        message: result.message,
        project: {
          ...project,
          status: project.status
        }
      };
    } catch (error) {
      console.error('Error starting project:', error);
      throw error;
    }
  }

  async stopProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    try {
      const result = await dockerService.stopWorkspaceContainer(projectId);
      project.status = result.status || 'stopped';
      
      return {
        success: true,
        message: result.message,
        project: {
          ...project,
          status: project.status
        }
      };
    } catch (error) {
      console.error('Error stopping project:', error);
      throw error;
    }
  }

  async deleteProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    try {
      await dockerService.stopWorkspace(projectId);
      this.projects.delete(projectId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting project:', error);
      throw error;
    }
  }

  async listProjects(userId = 'default') {
    const userProjects = Array.from(this.projects.values())
      .filter(p => p.userId === userId)
      .sort((a, b) => b.lastAccessed - a.lastAccessed);

    // Update status for all projects in parallel
    const projectsWithStatus = await Promise.all(
      userProjects.map(async (p) => {
        try {
          const dockerStatus = await dockerService.getProjectStatus(p.projectId);
          p.status = dockerStatus.status;
          
          return {
            projectId: p.projectId,
            projectName: p.projectName,
            projectType: p.projectType,
            status: p.status,
            workspaceUrl: p.workspaceUrl,
            createdAt: p.createdAt,
            lastAccessed: p.lastAccessed
          };
        } catch (error) {
          console.error(`Error getting status for project ${p.projectId}:`, error);
          return {
            projectId: p.projectId,
            projectName: p.projectName,
            projectType: p.projectType,
            status: 'error',
            workspaceUrl: p.workspaceUrl,
            createdAt: p.createdAt,
            lastAccessed: p.lastAccessed
          };
        }
      })
    );

    return projectsWithStatus;
  }

  async cleanupWorkspaces() {
    try {
      await dockerService.cleanupInactiveWorkspaces();
      
      // Remove project metadata for cleaned up workspaces
      for (const [projectId, project] of this.projects) {
        const dockerStatus = await dockerService.getProjectStatus(projectId);
        if (dockerStatus.status === 'not_found') {
          this.projects.delete(projectId);
        }
      }
    } catch (error) {
      console.error('Error during workspace cleanup:', error);
    }
  }

  getStats() {
    return {
      totalProjects: this.projects.size,
      runningProjects: Array.from(this.projects.values())
        .filter(p => p.status === 'running').length,
      maxWorkspacesPerUser: this.maxWorkspacesPerUser
    };
  }
}

module.exports = new WorkspaceService();