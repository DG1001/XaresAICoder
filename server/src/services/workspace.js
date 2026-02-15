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

    // Resource limits configuration
    this.limits = {
      maxConcurrentWorkspaces: parseInt(process.env.MAX_CONCURRENT_WORKSPACES) || 3,
      cpuPerWorkspace: parseFloat(process.env.CPU_PER_WORKSPACE) || 1.0,
      memoryPerWorkspaceMB: parseInt(process.env.MEMORY_PER_WORKSPACE_MB) || 4096,
      enableResourceLimits: process.env.ENABLE_RESOURCE_LIMITS !== 'false' // default true
    };

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

      // Check concurrent workspace limit (new workspaces start running immediately)
      if (this.limits.enableResourceLimits) {
        const runningCount = await this.getRunningWorkspaceCount();
        if (runningCount >= this.limits.maxConcurrentWorkspaces) {
          throw new Error(
            `Cannot create workspace: Maximum concurrent workspaces (${this.limits.maxConcurrentWorkspaces}) reached. ` +
            `Please stop a running workspace first.`
          );
        }
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
        proxyMode: options.proxyMode || 'none', // Per-workspace proxy mode: 'none', 'security', or 'logging'
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
      
      // Get project's proxyMode setting
      let project = this.projects.get(projectId);
      const proxyMode = project ? project.proxyMode : 'none';

      // Create Docker container with auth options and Git config
      const workspace = await dockerService.createWorkspaceContainer(projectId, projectType, {
        memoryLimit: options.memoryLimit || '2g',
        cpuCores: options.cpuCores || '2',
        passwordProtected: options.passwordProtected || false,
        password: options.password || null,
        gitRepository: gitRepository,
        gitUrl: options.gitUrl || null,
        gitUsername: options.gitUsername || null,
        gitToken: options.gitToken || null,
        proxyMode: proxyMode
      });

      // Update project with workspace URL, Git info, and running status
      project = this.projects.get(projectId);
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

  async cloneProject(projectId, count, options = {}, userId = 'default') {
    // Look up source project
    const source = this.projects.get(projectId);
    if (!source) {
      throw new Error('Source project not found');
    }
    if (source.status === 'creating') {
      throw new Error('Cannot clone a workspace that is still being created');
    }

    // Validate count
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new Error('Clone count must be an integer between 1 and 50');
    }

    // Check workspace limit (all-or-nothing)
    const userProjects = Array.from(this.projects.values())
      .filter(p => p.userId === userId);
    const remaining = this.maxWorkspacesPerUser - userProjects.length;
    if (count > remaining) {
      throw new Error(
        `Cannot create ${count} clones: only ${remaining} workspace slot${remaining === 1 ? '' : 's'} remaining (limit: ${this.maxWorkspacesPerUser})`
      );
    }

    // Hash password if provided
    let passwordHash = null;
    const hasPassword = options.password && options.password.length > 0;
    if (hasPassword) {
      passwordHash = await bcrypt.hash(options.password, 10);
    }

    const clones = [];
    for (let i = 1; i <= count; i++) {
      const cloneId = uuidv4();
      const clone = {
        projectId: cloneId,
        projectName: `${source.projectName} ${i}`,
        projectType: source.projectType,
        memoryLimit: source.memoryLimit || '2g',
        cpuCores: source.cpuCores || '2',
        userId,
        group: source.group || 'Uncategorized',
        passwordProtected: hasPassword,
        passwordHash: passwordHash,
        createGitRepo: source.createGitRepo || false,
        gitRepository: null,
        gitUrl: source.gitUrl || null,
        proxyMode: source.proxyMode || 'none',
        createdAt: new Date(),
        lastAccessed: new Date(),
        status: 'creating',
        workspaceUrl: null,
        clonedFrom: projectId
      };

      this.projects.set(cloneId, clone);
      clones.push(clone);
    }

    // Save all to disk at once
    await this.saveProjectsToDisk();

    // Kick off sequential container creation (fire-and-forget)
    this.createClonesSequentially(clones, options);

    // Return immediately
    return clones.map(c => ({
      projectId: c.projectId,
      projectName: c.projectName,
      status: c.status
    }));
  }

  async createClonesSequentially(clones, options) {
    const sourceProjectId = clones[0].clonedFrom;
    let snapshotImage;

    // Step 1: Commit the source container to a snapshot image
    try {
      snapshotImage = await dockerService.commitContainer(sourceProjectId);
      console.log(`Created snapshot image: ${snapshotImage} for cloning`);
    } catch (error) {
      console.error(`Failed to snapshot source container ${sourceProjectId}:`, error);
      // Mark all clones as error
      for (const clone of clones) {
        const project = this.projects.get(clone.projectId);
        if (project) {
          project.status = 'error';
          project.lastAccessed = new Date();
        }
      }
      await this.saveProjectsToDisk();
      return;
    }

    // Step 2: Create each clone from the snapshot
    const sourceProject = this.projects.get(sourceProjectId);
    const sourceGitRepo = sourceProject && sourceProject.gitRepository ? sourceProject.gitRepository : null;

    try {
      for (const clone of clones) {
        try {
          console.log(`Creating clone container: ${clone.projectName} (${clone.projectId})`);
          const workspace = await dockerService.createCloneContainer(clone.projectId, snapshotImage, {
            memoryLimit: clone.memoryLimit,
            cpuCores: clone.cpuCores,
            passwordProtected: clone.passwordProtected,
            password: options.password || null,
            proxyMode: clone.proxyMode
          });

          // Update project status
          const project = this.projects.get(clone.projectId);
          if (project) {
            project.status = 'running';
            project.workspaceUrl = workspace.workspaceUrl;
            project.lastAccessed = new Date();
          }

          // Set up a dedicated branch for this clone (if source has a Forgejo repo)
          if (sourceGitRepo && gitService.isGitServerAvailable()) {
            try {
              const sanitizedName = gitService.validateRepositoryName(clone.projectName);
              const branchName = `clone/${sanitizedName}`;
              console.log(`Setting up branch '${branchName}' for clone ${clone.projectName}`);

              const branchOk = await dockerService.setupCloneBranch(clone.projectId, branchName);

              if (branchOk && project) {
                // Copy source gitRepository metadata to clone, adding branch info
                project.gitRepository = {
                  ...sourceGitRepo,
                  branch: branchName,
                  webUrl: sourceGitRepo.webUrl + '/src/branch/' + encodeURIComponent(branchName)
                };
                console.log(`Branch '${branchName}' created for clone ${clone.projectName}`);
              } else if (project) {
                // Branch setup failed — clone still works, just shares main
                console.warn(`Branch setup failed for clone ${clone.projectName}, sharing main branch`);
                project.gitRepository = { ...sourceGitRepo };
              }
            } catch (gitError) {
              console.warn(`Branch setup failed for clone ${clone.projectName}, continuing without own branch:`, gitError.message);
              if (project) {
                project.gitRepository = { ...sourceGitRepo };
              }
            }
          }

          await this.saveProjectsToDisk();
          console.log(`Clone created: ${clone.projectName} → ${workspace.workspaceUrl}`);
        } catch (error) {
          console.error(`Failed to create clone ${clone.projectId}:`, error);
          const project = this.projects.get(clone.projectId);
          if (project) {
            project.status = 'error';
            project.lastAccessed = new Date();
          }
          await this.saveProjectsToDisk();
        }
      }
    } finally {
      // Step 3: Clean up the snapshot image
      await dockerService.removeSnapshotImage(snapshotImage);
      console.log(`Cleaned up snapshot image: ${snapshotImage}`);
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

    // Check concurrent workspace limit before starting
    if (this.limits.enableResourceLimits) {
      const runningCount = await this.getRunningWorkspaceCount();
      if (runningCount >= this.limits.maxConcurrentWorkspaces) {
        throw new Error(
          `Cannot start workspace: Maximum concurrent workspaces (${this.limits.maxConcurrentWorkspaces}) reached. ` +
          `Please stop another workspace first.`
        );
      }
    }

    try {
      const result = await dockerService.startWorkspace(projectId, project.proxyMode || 'none');
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

    // Get all container statuses in a single batch operation (much faster!)
    const containerStatuses = await dockerService.getAllProjectStatuses();

    // Update status for all projects using batch results
    const projectsWithStatus = userProjects.map((p) => {
      try {
        const dockerStatus = containerStatuses.get(p.projectId);

        // Special handling for creating projects:
        // Only update to running if we have a workspaceUrl (meaning async creation completed)
        if (p.status === 'creating' && !p.workspaceUrl) {
          // Keep as creating until async process completes
          // Docker might show "running" but workspace isn't ready yet
        } else if (dockerStatus) {
          // For non-creating projects, update status from Docker
          p.status = dockerStatus.status;
        } else {
          // Container not found in Docker
          p.status = 'not_found';
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
          diskUsage: null, // Will be loaded asynchronously
          createdAt: p.createdAt,
          lastAccessed: p.lastAccessed,
          notes: p.notes || '',
          proxyMode: p.proxyMode || 'none'
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
          diskUsage: null,
          createdAt: p.createdAt,
          lastAccessed: p.lastAccessed,
          notes: p.notes || '',
          proxyMode: p.proxyMode || 'none'
        };
      }
    });

    return projectsWithStatus;
  }

  // Get disk usage for a specific project
  async getProjectDiskUsage(projectId) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    if (!this.showDiskUsage) {
      return null;
    }

    try {
      const dockerStatus = await dockerService.getProjectStatus(projectId);
      return dockerStatus.diskUsage || { bytes: 0, readable: 'Unknown' };
    } catch (error) {
      console.error(`Error getting disk usage for project ${projectId}:`, error);
      return { bytes: 0, readable: 'Unknown' };
    }
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

  // Get count of currently running workspaces
  async getRunningWorkspaceCount() {
    const projects = Array.from(this.projects.values());
    return projects.filter(p => p.status === 'running').length;
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
              // Migrate useProxy (boolean) to proxyMode (string) for backward compat
              proxyMode: projectData.proxyMode || (projectData.useProxy === true ? 'logging' : 'none'),
              // Update status from Docker
              status: dockerStatus.status,
              lastAccessed: new Date(projectData.lastAccessed || projectData.createdAt)
            };
            // Remove old useProxy field if it exists
            delete project.useProxy;
            
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

  // Update project name
  async updateProjectName(projectId, newName) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const name = (newName || '').trim();
    if (!name) {
      throw new Error('Project name is required');
    }
    if (name.length > 100) {
      throw new Error('Project name must be 100 characters or less');
    }

    project.projectName = name;
    project.lastAccessed = new Date();

    await this.saveProjectsToDisk();

    return { success: true, projectName: name };
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

  // Update workspace password (set, change, or remove)
  async updatePassword(projectId, { currentPassword, newPassword, removePassword }) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // If workspace is currently protected, verify current password
    if (project.passwordProtected) {
      if (!currentPassword) {
        throw new Error('Current password is required for protected workspaces');
      }
      const passwordMatch = await bcrypt.compare(currentPassword, project.passwordHash);
      if (!passwordMatch) {
        throw new Error('Invalid current password');
      }
    }

    if (removePassword) {
      // Remove password protection
      project.passwordProtected = false;
      project.passwordHash = null;

      // Update running container
      await dockerService.updateWorkspacePassword(projectId, null);
    } else if (newPassword) {
      // Validate new password
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }
      if (newPassword.length > 50) {
        throw new Error('Password must be less than 50 characters');
      }

      // Set/update password
      project.passwordProtected = true;
      project.passwordHash = await bcrypt.hash(newPassword, 10);

      // Update running container
      await dockerService.updateWorkspacePassword(projectId, newPassword);
    } else {
      throw new Error('Either newPassword or removePassword must be provided');
    }

    project.lastAccessed = new Date();
    await this.saveProjectsToDisk();

    return { success: true, passwordProtected: project.passwordProtected };
  }
}

module.exports = new WorkspaceService();