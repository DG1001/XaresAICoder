const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const dockerService = require('./docker');
const gitService = require('./git');

class WorkspaceService {
  constructor() {
    this.projects = new Map();
    this.maxWorkspacesPerUser = parseInt(process.env.MAX_WORKSPACES_PER_USER) || 5;
    this.persistenceFile = path.join('/app', 'workspaces', 'projects.json');
    this.showDiskUsage = process.env.SHOW_DISK_USAGE === 'true';

    // Load existing projects on startup
    this.loadProjectsFromDisk();

    // Automatic cleanup removed - users manage workspace lifecycle manually
  }


  async createProject(projectName, projectType, options = {}, userId = 'default') {
    try {
      // Validate input
      if (!projectName || !projectType) {
        throw new Error('Project name and type are required');
      }

      if (!['empty', 'git-clone'].includes(projectType)) {
        throw new Error('Invalid project type. Supported: empty, git-clone');
      }

      // Check workspace limit
      const userProjects = Array.from(this.projects.values())
        .filter(p => p.userId === userId);
      
      if (userProjects.length >= this.maxWorkspacesPerUser) {
        throw new Error(`Maximum ${this.maxWorkspacesPerUser} workspaces per user`);
      }

      // Generate unique project ID
      const projectId = uuidv4();

      // Hash password if provided
      let passwordHash = null;
      if (options.passwordProtected && options.password) {
        passwordHash = await bcrypt.hash(options.password, 10);
      }

      // Validate and set group
      let projectGroup = (options.group || '').trim();
      if (!projectGroup) {
        projectGroup = 'Uncategorized';
      } else if (projectGroup.length > 50) {
        throw new Error('Group name must be 50 characters or less');
      } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(projectGroup)) {
        throw new Error('Group name can only contain letters, numbers, spaces, hyphens, and underscores');
      }

      // Store project metadata immediately with "creating" status
      const project = {
        projectId,
        projectName: projectName.trim(),
        projectType,
        memoryLimit: options.memoryLimit || '2g',
        cpuCores: options.cpuCores || '2',
        userId,
        group: projectGroup,
        passwordProtected: options.passwordProtected || false,
        passwordHash: passwordHash, // Store hashed password
        createGitRepo: options.createGitRepo || false,
        gitRepository: null, // Will be set if Git repo is created
        gitUrl: options.gitUrl || null, // Store Git URL for cloned repositories
        createdAt: new Date(),
        lastAccessed: new Date(),
        status: 'creating',
        workspaceUrl: null // Will be set when container is ready
      };

      this.projects.set(projectId, project);

      // Save to disk immediately
      await this.saveProjectsToDisk();

      // Start container creation asynchronously
      this.createWorkspaceAsync(projectId, projectType, options);

      // Return immediately with creating status
      return {
        projectId,
        projectName: project.projectName,
        projectType,
        memoryLimit: project.memoryLimit,
        passwordProtected: project.passwordProtected,
        createGitRepo: project.createGitRepo,
        workspaceUrl: null,
        status: 'creating',
        createdAt: project.createdAt,
        ...(project.passwordProtected && options.password && { password: options.password })
      };

    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  }

  async createWorkspaceAsync(projectId, projectType, options) {
    try {
      console.log(`Starting asynchronous workspace creation for project ${projectId}`);
      
      let gitRepository = null;
      
      // Create Git repository if requested and Git server is available
      if (options.createGitRepo && gitService.isGitServerAvailable()) {
        try {
          console.log(`Creating Git repository for project ${projectId}`);
          const project = this.projects.get(projectId);
          if (project) {
            const repoResult = await gitService.createGitRepository(
              project.projectName,
              `Repository for ${project.projectName} (${projectType})`,
              false // public by default
            );
            
            if (repoResult.success) {
              gitRepository = repoResult.repository;
              console.log(`Git repository created: ${gitRepository.name}`);
            }
          }
        } catch (gitError) {
          console.error(`Failed to create Git repository for project ${projectId}:`, gitError);
          // Continue with workspace creation even if Git repo creation fails
        }
      }
      
      // Create Docker container with auth options and Git config
      const workspace = await dockerService.createWorkspaceContainer(projectId, projectType, {
        memoryLimit: options.memoryLimit || '2g',
        cpuCores: options.cpuCores || '2',
        passwordProtected: options.passwordProtected || false,
        password: options.password || null,
        gitRepository: gitRepository,
        gitUrl: options.gitUrl || null,
        gitUsername: options.gitUsername || null,
        gitToken: options.gitToken || null
      });

      // Update project with workspace URL, Git info, and running status
      const project = this.projects.get(projectId);
      if (project) {
        project.status = 'running';
        project.workspaceUrl = workspace.workspaceUrl;
        project.gitRepository = gitRepository;
        project.lastAccessed = new Date();
        
        // Save updated project to disk
        await this.saveProjectsToDisk();
        
        console.log(`Workspace creation completed for project ${projectId}: ${workspace.workspaceUrl}`);
        if (gitRepository) {
          console.log(`Git repository configured: ${gitRepository.webUrl}`);
        }
      } else {
        console.error(`Project ${projectId} not found when trying to update after container creation`);
      }

    } catch (error) {
      console.error(`Error in async workspace creation for project ${projectId}:`, error);
      
      // Update project status to error
      const project = this.projects.get(projectId);
      if (project) {
        project.status = 'error';
        project.lastAccessed = new Date();
        await this.saveProjectsToDisk();
      }
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
    
    // Special handling for creating projects:
    // Only update to running if we have a workspaceUrl (meaning async creation completed)
    // This prevents premature status updates when container starts but isn't ready
    if (project.status === 'creating' && !project.workspaceUrl) {
      // Keep as creating until async process completes
      // Docker might show "running" but workspace isn't ready yet
    } else {
      // For non-creating projects, update status from Docker
      project.status = dockerStatus.status;
    }

    return {
      ...project,
      diskUsage: this.showDiskUsage ? (dockerStatus.diskUsage || { bytes: 0, readable: 'Unknown' }) : null,
      containerInfo: dockerStatus.containerInfo
    };
  }

  async startProject(projectId, providedPassword = null) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check password if workspace is protected
    if (project.passwordProtected) {
      if (!providedPassword) {
        throw new Error('Invalid password for protected workspace');
      }
      const passwordMatch = await bcrypt.compare(providedPassword, project.passwordHash);
      if (!passwordMatch) {
        throw new Error('Invalid password for protected workspace');
      }
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

  async stopProject(projectId, providedPassword = null) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check password if workspace is protected
    if (project.passwordProtected) {
      if (!providedPassword) {
        throw new Error('Invalid password for protected workspace');
      }
      const passwordMatch = await bcrypt.compare(providedPassword, project.passwordHash);
      if (!passwordMatch) {
        throw new Error('Invalid password for protected workspace');
      }
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

  async deleteProject(projectId, providedPassword = null) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check password if workspace is protected
    if (project.passwordProtected) {
      if (!providedPassword) {
        throw new Error('Invalid password for protected workspace');
      }
      const passwordMatch = await bcrypt.compare(providedPassword, project.passwordHash);
      if (!passwordMatch) {
        throw new Error('Invalid password for protected workspace');
      }
    }

    try {
      await dockerService.stopWorkspace(projectId);
      this.projects.delete(projectId);
      
      // Save to disk
      await this.saveProjectsToDisk();
      
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

    // Get all container sizes in a single batch operation for better performance (only if enabled)
    const containerSizes = this.showDiskUsage ? await dockerService.getAllWorkspaceContainerSizes() : new Map();

    // Update status for all projects in parallel
    const projectsWithStatus = await Promise.all(
      userProjects.map(async (p) => {
        try {
          const dockerStatus = await dockerService.getProjectStatus(p.projectId);

          // Special handling for creating projects:
          // Only update to running if we have a workspaceUrl (meaning async creation completed)
          if (p.status === 'creating' && !p.workspaceUrl) {
            // Keep as creating until async process completes
            // Docker might show "running" but workspace isn't ready yet
          } else {
            // For non-creating projects, update status from Docker
            p.status = dockerStatus.status;
          }

          // Get disk usage from batch results, fallback to individual call if not found
          let diskUsage = null;
          if (this.showDiskUsage) {
            diskUsage = containerSizes.get(p.projectId);
            if (!diskUsage) {
              diskUsage = dockerStatus.diskUsage || { bytes: 0, readable: 'Unknown' };
            }
          }

          return {
            projectId: p.projectId,
            projectName: p.projectName,
            projectType: p.projectType,
            memoryLimit: p.memoryLimit || '2g',
            cpuCores: p.cpuCores || '2',
            passwordProtected: p.passwordProtected || false,
            group: p.group || 'Uncategorized',
            status: p.status,
            workspaceUrl: p.workspaceUrl,
            gitRepository: p.gitRepository || null,
            gitUrl: p.gitUrl || null,
            diskUsage: diskUsage,
            createdAt: p.createdAt,
            lastAccessed: p.lastAccessed
          };
        } catch (error) {
          console.error(`Error getting status for project ${p.projectId}:`, error);
          return {
            projectId: p.projectId,
            projectName: p.projectName,
            projectType: p.projectType,
            memoryLimit: p.memoryLimit || '2g',
            cpuCores: p.cpuCores || '2',
            passwordProtected: p.passwordProtected || false,
            group: p.group || 'Uncategorized',
            status: 'error',
            workspaceUrl: p.workspaceUrl,
            gitRepository: p.gitRepository || null,
            gitUrl: p.gitUrl || null,
            diskUsage: this.showDiskUsage ? { bytes: 0, readable: 'Unknown' } : null,
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
      
      let removedCount = 0;
      // Remove project metadata for cleaned up workspaces
      for (const [projectId, project] of this.projects) {
        const dockerStatus = await dockerService.getProjectStatus(projectId);
        if (dockerStatus.status === 'not_found') {
          this.projects.delete(projectId);
          removedCount++;
        }
      }
      
      // Save to disk if we removed any projects
      if (removedCount > 0) {
        console.log(`Cleaned up ${removedCount} orphaned projects`);
        await this.saveProjectsToDisk();
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

  // Persistence methods
  async saveProjectsToDisk() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.persistenceFile);
      await fs.mkdir(dir, { recursive: true });

      // Convert Map to plain object for JSON serialization
      const projectsData = {};
      for (const [key, value] of this.projects) {
        // Save all data including password hash (if present)
        projectsData[key] = {
          ...value
        };
      }

      await fs.writeFile(this.persistenceFile, JSON.stringify(projectsData, null, 2));
      console.log(`Saved ${this.projects.size} projects to disk`);
    } catch (error) {
      console.error('Error saving projects to disk:', error);
    }
  }

  async loadProjectsFromDisk() {
    try {
      const data = await fs.readFile(this.persistenceFile, 'utf8');
      const projectsData = JSON.parse(data);
      
      console.log(`Loading projects from disk...`);
      
      // Load projects and verify they still exist in Docker
      for (const [projectId, projectData] of Object.entries(projectsData)) {
        try {
          // Check if container still exists
          const dockerStatus = await dockerService.getProjectStatus(projectId);
          
          if (dockerStatus.status !== 'not_found') {
            // Restore project data with password hash intact
            const project = {
              ...projectData,
              // Add memoryLimit for existing projects that don't have it (migration)
              memoryLimit: projectData.memoryLimit || '2g',
              // Update status from Docker
              status: dockerStatus.status,
              lastAccessed: new Date(projectData.lastAccessed || projectData.createdAt)
            };
            
            this.projects.set(projectId, project);
            console.log(`Restored project: ${project.projectName} (${projectId}) - Status: ${project.status}`);
          } else {
            console.log(`Skipping project ${projectId} - container not found`);
          }
        } catch (error) {
          console.error(`Error restoring project ${projectId}:`, error);
        }
      }
      
      console.log(`Loaded ${this.projects.size} projects from disk`);
      
      // Save updated data (removes orphaned projects)
      await this.saveProjectsToDisk();
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No existing projects file found - starting fresh');
      } else {
        console.error('Error loading projects from disk:', error);
      }
    }
  }

  // Get project notes
  async getProjectNotes(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    
    return project.notes || '';
  }

  // Update project notes
  async updateProjectNotes(projectId, notes) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Update project with notes
    project.notes = notes;
    project.lastAccessed = new Date();

    // Save to disk
    await this.saveProjectsToDisk();

    return true;
  }

  // Get all groups with project counts
  async getGroups(userId = 'default') {
    const userProjects = Array.from(this.projects.values())
      .filter(p => p.userId === userId);

    const groups = new Map();
    userProjects.forEach(project => {
      const groupName = project.group || 'Uncategorized';
      if (!groups.has(groupName)) {
        groups.set(groupName, { name: groupName, count: 0, projects: [] });
      }
      const group = groups.get(groupName);
      group.count++;
      group.projects.push(project.projectId);
    });

    return Array.from(groups.values()).sort((a, b) => {
      // Sort: Uncategorized last, then alphabetically
      if (a.name === 'Uncategorized') return 1;
      if (b.name === 'Uncategorized') return -1;
      return a.name.localeCompare(b.name);
    });
  }

  // Update project group
  async updateProjectGroup(projectId, newGroup) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Validate group name
    let groupName = (newGroup || '').trim();
    if (!groupName) {
      groupName = 'Uncategorized';
    } else if (groupName.length > 50) {
      throw new Error('Group name must be 50 characters or less');
    } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(groupName)) {
      throw new Error('Group name can only contain letters, numbers, spaces, hyphens, and underscores');
    }

    project.group = groupName;
    project.lastAccessed = new Date();

    // Save to disk
    await this.saveProjectsToDisk();

    return { success: true, group: groupName };
  }
}

module.exports = new WorkspaceService();