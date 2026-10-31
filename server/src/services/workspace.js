const { v4: uuidv4 } = require('uuid');
const path = require('path');
const bcrypt = require('bcryptjs');
const dockerService = require('./docker');
const gitService = require('./git');
const { writeJsonAtomic, readJson } = require('./persistence');

// Remove userinfo (user:token@) from a URL so it can be stored and returned safely.
function stripUrlCredentials(url) {
  if (!url || typeof url !== 'string') return url || null;
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url.replace(/^(\w+:\/\/)[^@/]*@/, '$1');
  }
}

// Only these Git repository fields are persisted and exposed. In particular,
// internalCloneUrl (which embeds the workspace's Forgejo token) is dropped –
// it is only needed transiently while the container is created.
function sanitizeGitRepository(repo) {
  if (!repo) return null;
  const { name, owner, fullName, cloneUrl, webUrl, description, branch } = repo;
  return {
    name,
    ...(owner && { owner }),
    fullName,
    cloneUrl: stripUrlCredentials(cloneUrl),
    webUrl,
    description,
    private: !!repo.private,
    ...(branch && { branch })
  };
}

// Public representation of a project. Never includes passwordHash, alias
// password hashes or Git credentials.
function serializeProject(p) {
  return {
    projectId: p.projectId,
    projectName: p.projectName,
    projectType: p.projectType,
    memoryLimit: p.memoryLimit || '2g',
    cpuCores: p.cpuCores || '2',
    shmSize: p.shmSize || '64m',
    passwordProtected: p.passwordProtected || false,
    group: p.group || 'Uncategorized',
    status: p.status,
    workspaceUrl: p.workspaceUrl,
    gitRepository: sanitizeGitRepository(p.gitRepository),
    gitUrl: stripUrlCredentials(p.gitUrl),
    createdAt: p.createdAt,
    lastAccessed: p.lastAccessed,
    notes: p.notes || '',
    proxyMode: p.proxyMode || 'none',
    // null for workspaces created before this setting existed
    sudoEnabled: typeof p.sudoEnabled === 'boolean' ? p.sudoEnabled : null,
    ...(p.clonedFrom && { clonedFrom: p.clonedFrom }),
    // Last failed action (e.g. a stop Docker could not finish), shown in the
    // dashboard until the next start or stop
    ...(p.lastError && { lastError: p.lastError }),
    aliases: (Array.isArray(p.aliases) ? p.aliases : []).map(a => ({
      subdomain: a.subdomain,
      port: a.port,
      authProtected: !!a.authProtected
    }))
  };
}

class WorkspaceService {
  constructor() {
    this.projects = new Map();
    // Stops in progress: projectId -> promise (see stopProject)
    this.pendingStops = new Map();
    // Rebuilds for new resources in progress: projectId -> promise (see updateResources)
    this.pendingRebuilds = new Map();
    // A stop Docker does not answer counts as failed after this time, so the
    // workspace does not stay 'stopping' until the server restarts
    this.stopGiveUpMs = 3 * 60 * 1000;
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

    // Fixed proxy IPs are chosen one at a time, so two workspaces created at
    // the same moment cannot pick the same address
    this.proxyIpLock = Promise.resolve();

    // Load existing projects on startup. Expose a promise so that
    // other components can await readiness before reading this.projects.
    this.whenReady = this.loadProjectsFromDisk();

    // Automatic cleanup removed - users manage workspace lifecycle manually
  }

  withProxyIpLock(fn) {
    const run = this.proxyIpLock.then(fn, fn);
    this.proxyIpLock = run.catch(() => {});
    return run;
  }

  // Gives a proxied project a fixed IP not used by any other project. Call
  // inside withProxyIpLock, and add the project to this.projects before
  // releasing the lock.
  async assignNewProxyIp(project) {
    const taken = new Set();
    for (const p of this.projects.values()) {
      if (p !== project && p.proxyIp) taken.add(p.proxyIp);
    }
    project.proxyIp = await dockerService.allocateProxyIp(project.proxyMode, taken);
    project.proxyIpSince = new Date();
    return project.proxyIp;
  }

  // Address under which squid/mitmproxy log this workspace. Stored for
  // workspaces with a fixed IP, so their logs stay readable while stopped.
  async getProxyIp(projectId) {
    const project = this.projects.get(projectId);
    if (!project || (project.proxyMode || 'none') === 'none') return null;
    return project.proxyIp || await dockerService.getWorkspaceIPAddress(projectId);
  }

  // Since when the workspace has owned its proxy IP (older squid lines
  // belong to a deleted workspace that had the same address)
  getProxyIpSince(projectId) {
    const project = this.projects.get(projectId);
    return project ? (project.proxyIpSince || project.createdAt || null) : null;
  }

  // On server start: gives proxied workspaces created before fixed IPs one
  // (a running workspace keeps its current address, so its captures stay
  // with it), then moves every workspace to the network of its proxy mode.
  async migrateWorkspaceNetworks() {
    const fresh = [];
    await this.withProxyIpLock(async () => {
      for (const project of this.projects.values()) {
        const mode = project.proxyMode || 'none';
        if (mode === 'none') continue;
        try {
          if (project.proxyIp) {
            const { subnet } = await dockerService.getProxyNetworkInfo(mode);
            // Subnet changed in .env: the stored address is no longer valid
            if (dockerService.ipInSubnet(project.proxyIp, subnet)) continue;
          }
          const current = await dockerService.getCurrentProxyIp(project.projectId, mode);
          const claimed = [...this.projects.values()].some(p => p !== project && p.proxyIp === current);
          if (current && !claimed) {
            project.proxyIp = current;
          } else {
            await this.assignNewProxyIp(project);
            fresh.push(project.proxyIp);
          }
          console.log(`Fixed proxy IP for ${project.projectName} (${project.projectId}): ${project.proxyIp}`);
        } catch (error) {
          console.warn(`Could not assign a proxy IP to ${project.projectId}: ${error.message}`);
        }
      }
    });
    await this.saveProjectsToDisk();
    // A new address may have belonged to a deleted workspace
    for (const ip of fresh) {
      await dockerService.resetProxyLogsForIp(ip).catch(e =>
        console.warn(`Could not reset proxy logs for ${ip}: ${e.message}`));
    }
    await dockerService.migrateWorkspaceNetworks(this.projects.values());
  }

  // Workspaces created before per-workspace Forgejo users work with the
  // admin account (environment and remote URLs). On server start each gets
  // its own user; once its container runs (now or after the next start) its
  // repositories move to that user and the remotes switch to its token.
  async migrateForgejoUsers() {
    if (!gitService.isGitServerAvailable()) return;
    if (!(await gitService.waitUntilReady())) {
      console.warn('Forgejo not reachable with the admin account; Forgejo migration postponed to the next start');
      return;
    }
    for (const project of this.projects.values()) {
      if (project.forgejoUser) continue;
      try {
        project.forgejoUser = await gitService.ensureWorkspaceUser(project.projectId, project.projectName);
        project.forgejoMigrationPending = true;
      } catch (error) {
        console.warn(`Forgejo user for ${project.projectId} failed: ${error.message}`);
      }
    }
    await this.saveProjectsToDisk();
    for (const project of this.projects.values()) {
      if (!project.forgejoMigrationPending) continue;
      const { status } = await dockerService.getProjectStatus(project.projectId).catch(() => ({}));
      if (status !== 'running') continue;
      await this.completeForgejoMigration(project).catch(e =>
        console.warn(`Forgejo migration of ${project.projectId} failed: ${e.message}`));
    }
  }

  // Needs the running container. Per Forgejo remote of /workspace that
  // belongs to the admin account:
  // - a repository of this workspace (not shared with other projects) is
  //   transferred to the workspace user and the remote gets its token;
  // - a shared one (a clone pointing at its source) is replaced, for
  //   origin, by an own private repository with the current state.
  async completeForgejoMigration(project) {
    const user = project.forgejoUser;
    const token = await gitService.issueToken(user);
    const admin = gitService.adminUser;
    const remotes = await dockerService.listForgejoRemotes(project.projectId);

    const usedElsewhere = repo => [...this.projects.values()].some(p =>
      p !== project && p.clonedFrom !== project.projectId &&
      p.gitRepository && p.gitRepository.name === repo && (p.gitRepository.owner || admin) === admin);

    for (const remote of remotes) {
      let target = null;
      if (remote.owner === user) {
        target = gitService.repoInfo(user, remote.repo);
      } else if (remote.owner === admin) {
        const shared = project.clonedFrom || (project.gitRepository && project.gitRepository.branch) || usedElsewhere(remote.repo);
        if (!shared) {
          target = await gitService.repoExists(admin, remote.repo)
            ? await gitService.transferRepo(admin, remote.repo, user)
            : (await gitService.repoExists(user, remote.repo) ? gitService.repoInfo(user, remote.repo) : null);
        } else if (remote.name === 'origin') {
          const repo = await gitService.createRepoForUser(user, remote.repo, `Own copy of ${admin}/${remote.repo} (${project.projectName})`);
          await dockerService.pushToOwnRepo(project.projectId, gitService.remoteUrl(user, token, repo.owner, repo.name));
          project.gitRepository = { ...repo, private: true };
          console.log(`Forgejo migration: ${project.projectName} got its own repository ${repo.fullName}`);
          continue;
        }
      }
      if (!target) continue;
      await dockerService.setGitRemote(project.projectId, remote.name, gitService.remoteUrl(user, token, target.owner, target.name));
      if (remote.name === 'origin' || (project.gitRepository && project.gitRepository.name === target.name)) {
        project.gitRepository = target;
      }
      console.log(`Forgejo migration: ${project.projectName} remote ${remote.name} -> ${target.fullName}`);
    }
    if (project.gitRepository) project.gitRepository = sanitizeGitRepository(project.gitRepository);
    project.forgejoMigrationPending = false;
    await this.saveProjectsToDisk();
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
        shmSize: options.shmSize || '64m',
        userId,
        group: projectGroup,
        passwordProtected: options.passwordProtected || false,
        passwordHash: passwordHash, // Store hashed password
        createGitRepo: options.createGitRepo || false,
        gitRepository: null, // Will be set if Git repo is created
        gitUrl: stripUrlCredentials(options.gitUrl), // Git URL for cloned repositories (without credentials)
        proxyMode: options.proxyMode || 'none', // Per-workspace proxy mode: 'none', 'security', or 'logging'
        sudoEnabled: typeof options.sudoEnabled === 'boolean' ? options.sudoEnabled : process.env.WORKSPACE_SUDO_ENABLED === 'true',
        aliases: [],
        createdAt: new Date(),
        lastAccessed: new Date(),
        status: 'creating',
        workspaceUrl: null // Will be set when container is ready
      };

      await this.withProxyIpLock(async () => {
        if (project.proxyMode !== 'none') await this.assignNewProxyIp(project);
        this.projects.set(projectId, project);
      });

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
        cpuCores: project.cpuCores,
        shmSize: project.shmSize,
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
      let forgejo = null;
      let clone = { gitUrl: options.gitUrl || null, gitUsername: options.gitUsername || null, gitToken: options.gitToken || null };

      // Forgejo: every workspace gets its own user and token; the repository
      // (if requested) is private and belongs to that user. A repository of
      // this platform's Forgejo given as clone URL (e.g. to continue the work
      // of a deleted workspace) is shared with the new user instead.
      const entry = this.projects.get(projectId);
      if (entry && gitService.isGitServerAvailable()) {
        try {
          const user = await gitService.ensureWorkspaceUser(projectId, entry.projectName);
          const token = await gitService.issueToken(user);
          forgejo = { user, token };
          entry.forgejoUser = user;

          const local = projectType === 'git-clone' ? gitService.parseLocalRepoUrl(options.gitUrl) : null;
          if (local) {
            await gitService.addCollaborator(local.owner, local.repo, user);
            clone = { gitUrl: `http://forgejo:3000/${local.owner}/${local.repo}.git`, gitUsername: user, gitToken: token };
            entry.gitRepository = sanitizeGitRepository(gitService.repoInfo(local.owner, local.repo));
            console.log(`Workspace ${projectId} continues on Forgejo repository ${local.owner}/${local.repo}`);
          } else if (options.createGitRepo) {
            const repo = await gitService.createRepoForUser(user, entry.projectName,
              `Repository for ${entry.projectName} (${projectType})`);
            gitRepository = { ...repo, internalCloneUrl: gitService.remoteUrl(user, token, repo.owner, repo.name) };
            console.log(`Git repository created: ${repo.fullName}`);
          }
        } catch (gitError) {
          console.error(`Forgejo setup failed for project ${projectId}:`, gitError.message);
          // Continue with workspace creation even if Forgejo setup fails
        }
      }

      // Get project's proxyMode setting
      let project = this.projects.get(projectId);
      const proxyMode = project ? project.proxyMode : 'none';

      // Create Docker container with auth options and Git config
      const workspace = await dockerService.createWorkspaceContainer(projectId, projectType, {
        memoryLimit: options.memoryLimit || '2g',
        cpuCores: options.cpuCores || '2',
        shmSize: options.shmSize || '64m',
        passwordProtected: options.passwordProtected || false,
        password: options.password || null,
        gitRepository: gitRepository,
        gitUrl: clone.gitUrl,
        gitUsername: clone.gitUsername,
        gitToken: clone.gitToken,
        forgejo,
        proxyMode: proxyMode,
        proxyIp: project ? project.proxyIp : null,
        sudoEnabled: project ? project.sudoEnabled : undefined
      });

      // Update project with workspace URL, Git info, and running status
      project = this.projects.get(projectId);
      if (project) {
        project.status = 'running';
        project.workspaceUrl = workspace.workspaceUrl;
        if (gitRepository) project.gitRepository = sanitizeGitRepository(gitRepository);
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
    this.assertNotRebuilding(projectId);

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

    // Collect all existing project names to avoid duplicates
    const usedNames = new Set(
      Array.from(this.projects.values()).map(p => p.projectName)
    );

    let cloneNum = 0;
    const clones = [];
    // All or nothing: no half-registered clones if addresses run out
    await this.withProxyIpLock(async () => {
      try {
        for (let i = 0; i < count; i++) {
          // Find next free number
          do { cloneNum++; } while (usedNames.has(`${source.projectName} ${cloneNum}`));
          const projectName = `${source.projectName} ${cloneNum}`;
          usedNames.add(projectName); // Reserve for next iteration

          const cloneId = uuidv4();
          const clone = {
            projectId: cloneId,
            projectName,
            projectType: source.projectType,
            memoryLimit: source.memoryLimit || '2g',
            cpuCores: source.cpuCores || '2',
            shmSize: source.shmSize || '64m',
            userId,
            group: source.group || 'Uncategorized',
            passwordProtected: hasPassword,
            passwordHash: passwordHash,
            createGitRepo: source.createGitRepo || false,
            gitRepository: null,
            gitUrl: source.gitUrl || null,
            proxyMode: source.proxyMode || 'none',
            sudoEnabled: typeof options.sudoEnabled === 'boolean' ? options.sudoEnabled : process.env.WORKSPACE_SUDO_ENABLED === 'true',
            aliases: [],
            createdAt: new Date(),
            lastAccessed: new Date(),
            status: 'creating',
            workspaceUrl: null,
            clonedFrom: projectId
          };

          if (clone.proxyMode !== 'none') await this.assignNewProxyIp(clone);
          this.projects.set(cloneId, clone);
          clones.push(clone);
        }
      } catch (error) {
        for (const c of clones) this.projects.delete(c.projectId);
        throw error;
      }
    });

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

    // Step 1: Commit the source container to a snapshot image and remove the
    // source's credentials from it. Without a sanitized snapshot no clone is
    // created – handing the teacher's tokens to every participant is worse
    // than a failed clone.
    try {
      const rawImage = await dockerService.commitContainer(sourceProjectId);
      console.log(`Created snapshot image: ${rawImage} for cloning`);
      snapshotImage = await dockerService.sanitizeSnapshot(rawImage, { keepAiLogins: !!options.keepAiLogins });
    } catch (error) {
      console.error(`Failed to create a sanitized snapshot of ${sourceProjectId}:`, error);
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
          // Own Forgejo user and token (in the clone's environment)
          let forgejo = null;
          if (gitService.isGitServerAvailable()) {
            try {
              const user = await gitService.ensureWorkspaceUser(clone.projectId, clone.projectName);
              forgejo = { user, token: await gitService.issueToken(user) };
              const p = this.projects.get(clone.projectId);
              if (p) p.forgejoUser = user;
            } catch (gitError) {
              console.warn(`Forgejo user for clone ${clone.projectName} failed: ${gitError.message}`);
            }
          }

          console.log(`Creating clone container: ${clone.projectName} (${clone.projectId})`);
          const workspace = await dockerService.createCloneContainer(clone.projectId, snapshotImage, {
            memoryLimit: clone.memoryLimit,
            cpuCores: clone.cpuCores,
            shmSize: clone.shmSize,
            passwordProtected: clone.passwordProtected,
            password: options.password || null,
            proxyMode: clone.proxyMode,
            proxyIp: clone.proxyIp,
            forgejo,
            sudoEnabled: clone.sudoEnabled
          });

          // Update project status
          const project = this.projects.get(clone.projectId);
          if (project) {
            project.status = 'running';
            project.workspaceUrl = workspace.workspaceUrl;
            project.lastAccessed = new Date();
          }

          // Own private repository with the source's state and history, if
          // the source works with this Forgejo (instead of a branch in the
          // shared repository, which every clone could overwrite)
          if (forgejo && project) {
            try {
              const remotes = await dockerService.listForgejoRemotes(clone.projectId);
              const origin = remotes.find(r => r.name === 'origin') || remotes[0];
              const repoName = (sourceGitRepo && sourceGitRepo.name) || (origin && origin.repo);
              if (repoName) {
                const repo = await gitService.createRepoForUser(forgejo.user, repoName,
                  `Clone of ${(sourceGitRepo && sourceGitRepo.fullName) || repoName} (${clone.projectName})`);
                const pushed = await dockerService.pushToOwnRepo(clone.projectId,
                  gitService.remoteUrl(forgejo.user, forgejo.token, repo.owner, repo.name));
                project.gitRepository = sanitizeGitRepository(repo);
                console.log(`Clone ${clone.projectName}: own repository ${repo.fullName}` + (pushed ? '' : ' (push failed, see log)'));
              }
            } catch (gitError) {
              console.warn(`Own repository for clone ${clone.projectName} failed: ${gitError.message}`);
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
      project.status = this.statusWithPendingAction(projectId, dockerStatus.status);
    }

    return {
      ...serializeProject(project),
      diskUsage: this.showDiskUsage ? (dockerStatus.diskUsage || { bytes: 0, readable: 'Unknown' }) : null,
      containerInfo: dockerStatus.containerInfo
    };
  }

  // Throws 'Project not found' or 'Invalid password for protected workspace'.
  // Resolves silently for unprotected workspaces.
  async verifyWorkspacePassword(projectId, providedPassword) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    if (!project.passwordProtected) return;

    if (!providedPassword || typeof providedPassword !== 'string' || !project.passwordHash) {
      throw new Error('Invalid password for protected workspace');
    }
    const passwordMatch = await bcrypt.compare(providedPassword, project.passwordHash);
    if (!passwordMatch) {
      throw new Error('Invalid password for protected workspace');
    }
  }

  async startProject(projectId, providedPassword = null) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    await this.verifyWorkspacePassword(projectId, providedPassword);
    this.assertNotRebuilding(projectId);

    if (this.pendingStops.has(projectId)) {
      throw new Error('Workspace is still stopping');
    }
    delete project.lastError;

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
      const result = await dockerService.startWorkspace(projectId, project.proxyMode || 'none', project.proxyIp);
      project.status = result.status || 'running';
      project.lastAccessed = new Date();
      if (project.forgejoMigrationPending) {
        await this.completeForgejoMigration(project).catch(e =>
          console.warn(`Forgejo migration of ${projectId} failed: ${e.message}`));
      }

      return {
        success: true,
        message: result.message,
        project: serializeProject(project)
      };
    } catch (error) {
      console.error('Error starting project:', error);
      throw error;
    }
  }

  // Choices for memory, CPU cores and /dev/shm. Upper bounds are
  // MEMORY_PER_WORKSPACE_MB and CPU_PER_WORKSPACE, capped at the Docker host
  // (its CPU count, its memory rounded up to whole GB); the steps are powers
  // of two plus the maximum itself (e.g. 1, 2, 4, 8, 12 cores).
  async getResourceOptions() {
    const host = await dockerService.getHostCapabilities();
    let maxMemoryGB = Math.max(1, Math.floor(this.limits.memoryPerWorkspaceMB / 1024));
    if (host.memTotal) maxMemoryGB = Math.min(maxMemoryGB, Math.ceil(host.memTotal / 2 ** 30));
    let maxCpuCores = Math.max(1, Math.floor(this.limits.cpuPerWorkspace));
    if (host.ncpu) maxCpuCores = Math.min(maxCpuCores, host.ncpu);
    const steps = max => {
      const values = [];
      for (let n = 1; n < max; n *= 2) values.push(n);
      return [...values, max];
    };
    const memory = steps(maxMemoryGB).map(n => `${n}g`);
    const cpu = steps(maxCpuCores).map(String);
    const preferred = (list, value) => (list.includes(value) ? value : list[list.length - 1]);
    return {
      maxMemoryGB,
      maxCpuCores,
      memory,
      cpu,
      // Shared memory counts toward the memory limit; never above it
      shm: ['64m', ...memory],
      defaults: { memoryLimit: preferred(memory, '2g'), cpuCores: preferred(cpu, '2'), shmSize: '64m' }
    };
  }

  // Memory, CPU cores and /dev/shm for a new workspace (current = null) or a
  // change (current = the workspace's values). Missing values keep the
  // current ones or get the defaults. A value is checked against the choices
  // only when it changes, so an edit may keep a value from before a lower
  // limit. Throws with a message for the client.
  async resolveResources(requested = {}, current = null) {
    const options = await this.getResourceOptions();
    const base = current || options.defaults;
    const result = {};
    const fields = [
      ['memoryLimit', options.memory, 'Memory limit'],
      ['cpuCores', options.cpu, 'CPU cores'],
      ['shmSize', options.shm, 'Shared memory']
    ];
    for (const [key, choices, label] of fields) {
      const given = requested[key];
      if (given === undefined || given === null || given === '') {
        result[key] = base[key];
        continue;
      }
      const value = String(given).toLowerCase();
      if (value !== base[key] && !choices.includes(value)) {
        throw new Error(`${label} must be one of: ${choices.join(', ')}`);
      }
      result[key] = value;
    }
    const { sizeToBytes } = dockerService;
    if (sizeToBytes(result.shmSize) > sizeToBytes(result.memoryLimit)) {
      throw new Error(`Shared memory (${result.shmSize}) cannot be larger than the memory limit (${result.memoryLimit}): it counts toward it`);
    }
    return result;
  }

  // While a stop runs, Docker still reports the container as running; the
  // dashboard shows 'stopping' instead (for every client, also after a reload).
  // During a rebuild the container is stopped, renamed and replaced: 'rebuilding'.
  statusWithPendingAction(projectId, dockerStatus) {
    if (this.pendingRebuilds.has(projectId)) return 'rebuilding';
    return this.pendingStops.has(projectId) && dockerStatus === 'running' ? 'stopping' : dockerStatus;
  }

  assertNotRebuilding(projectId) {
    if (this.pendingRebuilds.has(projectId)) throw new Error('Workspace is being rebuilt');
  }

  // Memory and CPU apply right away (docker update); another /dev/shm size
  // needs a new container, built from a snapshot of the workspace in the
  // background (status 'rebuilding', a failure stays as lastError). { wait }
  // answers only after the rebuild (scripts).
  async updateResources(projectId, requested, { wait = false } = {}) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');
    if (project.status === 'creating' || this.pendingStops.has(projectId) || this.pendingRebuilds.has(projectId)) {
      throw new Error('Workspace is busy (being created, stopped or rebuilt)');
    }

    const current = {
      memoryLimit: project.memoryLimit || '2g',
      cpuCores: project.cpuCores || '2',
      shmSize: project.shmSize || '64m'
    };
    let next;
    try {
      next = await this.resolveResources(requested, current);
    } catch (error) {
      error.invalidResources = true;
      throw error;
    }
    if (Object.keys(current).every(key => next[key] === current[key])) {
      return { success: true, message: 'Nothing changed', project: serializeProject(project) };
    }

    if (next.shmSize === current.shmSize) {
      await dockerService.updateContainerResources(projectId, next);
      Object.assign(project, next);
      await this.saveProjectsToDisk();
      return { success: true, message: 'Resources updated', project: serializeProject(project) };
    }

    delete project.lastError;
    project.status = 'rebuilding';
    const rebuild = this.runRebuild(project, next).finally(() => this.pendingRebuilds.delete(projectId));
    this.pendingRebuilds.set(projectId, rebuild);
    if (!wait) {
      return { success: true, accepted: true, message: 'Rebuilding workspace', project: serializeProject(project) };
    }
    const result = await rebuild;
    if (!result.success) throw new Error(result.message);
    return { success: true, message: 'Workspace rebuilt', project: serializeProject(project) };
  }

  // Never rejects: the outcome ends up on the project (resources, status, lastError)
  async runRebuild(project, resources) {
    const { projectId } = project;
    try {
      const { status } = await dockerService.rebuildWorkspaceContainer(projectId, resources);
      Object.assign(project, resources);
      project.status = status;
      await this.saveProjectsToDisk();
      return { success: true };
    } catch (error) {
      console.error(`Error rebuilding project ${projectId}:`, error);
      project.lastError = { action: 'rebuild', message: error.message, at: new Date().toISOString() };
      project.status = await dockerService.getProjectStatus(projectId)
        .then(s => s.status)
        .catch(() => 'error');
      return { success: false, message: error.message };
    }
  }

  // Stopping can take long when Docker is busy (several workspaces at once,
  // slow disks), longer than a browser or proxy keeps the request open. The
  // request therefore only starts the stop: the workspace shows 'stopping'
  // until Docker is done, and a failure stays on the workspace as lastError.
  // { wait: true } answers only after the container has stopped (scripts).
  async stopProject(projectId, providedPassword = null, { wait = false } = {}) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    await this.verifyWorkspacePassword(projectId, providedPassword);
    this.assertNotRebuilding(projectId);

    let stop = this.pendingStops.get(projectId);
    if (!stop) {
      delete project.lastError;
      project.status = 'stopping';
      stop = this.runStop(project).finally(() => this.pendingStops.delete(projectId));
      this.pendingStops.set(projectId, stop);
    }

    if (!wait) {
      return {
        success: true,
        accepted: true,
        message: 'Stopping workspace',
        project: serializeProject(project)
      };
    }

    const result = await stop;
    if (!result.success) {
      throw new Error(result.message);
    }
    return {
      success: true,
      message: result.message,
      project: serializeProject(project)
    };
  }

  // Never rejects: the outcome ends up on the project (status, lastError).
  // Gives up after stopGiveUpMs, as Docker may never answer.
  async runStop(project) {
    const { projectId } = project;
    const giveUp = new Error(`Docker did not finish the stop within ${Math.round(this.stopGiveUpMs / 1000)} s (it may still complete)`);
    let timer;
    try {
      const result = await Promise.race([
        dockerService.stopWorkspaceContainer(projectId),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(giveUp), this.stopGiveUpMs); })
      ]);
      project.status = result.status || 'stopped';
      return { success: true, message: result.message };
    } catch (error) {
      console.error(`Error stopping project ${projectId}:`, error);
      project.lastError = { action: 'stop', message: error.message, at: new Date().toISOString() };
      // After giving up, Docker may not answer an inspect either; list and
      // detail take the status from Docker again anyway
      project.status = error === giveUp ? 'error' : await dockerService.getProjectStatus(projectId)
        .then(s => s.status)
        .catch(() => 'error');
      return { success: false, message: error.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async deleteProject(projectId, providedPassword = null) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    await this.verifyWorkspacePassword(projectId, providedPassword);
    this.assertNotRebuilding(projectId);

    try {
      await dockerService.stopWorkspace(projectId);
      this.projects.delete(projectId);
      await dockerService.removeRebuildImages(projectId);

      // Save to disk
      await this.saveProjectsToDisk();

      // The Forgejo user and its repositories stay (a new workspace can
      // continue from the repository); only the workspace's token is revoked
      if (project.forgejoUser && gitService.isGitServerAvailable()) {
        await gitService.revokeTokens(project.forgejoUser).catch(e =>
          console.warn(`Revoking Forgejo token of ${project.forgejoUser} failed: ${e.message}`));
      }

      // Clean up any subdomain aliases tied to this workspace.
      // Lazy-require to avoid circular dependency.
      try {
        const aliasesService = require('./aliasesService');
        await aliasesService.cleanupForProject(projectId);
      } catch (aliasErr) {
        console.error(`Alias cleanup failed for ${projectId}:`, aliasErr);
      }

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
    return userProjects.map((p) => {
      const dockerStatus = containerStatuses.get(p.projectId);

      // Special handling for creating projects:
      // Only update to running if we have a workspaceUrl (meaning async creation completed)
      if (p.status === 'creating' && !p.workspaceUrl) {
        // Keep as creating until async process completes
        // Docker might show "running" but workspace isn't ready yet
      } else if (dockerStatus || this.pendingRebuilds.has(p.projectId)) {
        // For non-creating projects, update status from Docker
        p.status = this.statusWithPendingAction(p.projectId, dockerStatus && dockerStatus.status);
      } else {
        // Container not found in Docker
        p.status = 'not_found';
      }

      return {
        ...serializeProject(p),
        diskUsage: null // Will be loaded asynchronously
      };
    });
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
  // In-memory state stays the source of truth; a failed write is logged and
  // the next successful save persists the current state. Writes are atomic,
  // so a failure never truncates the existing file.
  async saveProjectsToDisk() {
    try {
      // Save all data including password hash (if present)
      await writeJsonAtomic(this.persistenceFile, Object.fromEntries(this.projects));
      console.log(`Saved ${this.projects.size} projects to disk`);
    } catch (error) {
      console.error('Error saving projects to disk:', error);
    }
  }

  async loadProjectsFromDisk() {
    try {
      const projectsData = await readJson(this.persistenceFile);
      if (!projectsData) {
        console.log('No usable projects file found - starting fresh');
        return;
      }

      console.log(`Loading projects from disk...`);
      await dockerService.recoverInterruptedRebuilds().catch(error =>
        console.error('Checking for interrupted rebuilds failed:', error.message));
      
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
              // Workspaces from before the setting have Docker's default
              shmSize: projectData.shmSize || '64m',
              // Migrate useProxy (boolean) to proxyMode (string) for backward compat
              proxyMode: projectData.proxyMode || (projectData.useProxy === true ? 'logging' : 'none'),
              // Initialize aliases array for older projects without the field
              aliases: Array.isArray(projectData.aliases) ? projectData.aliases : [],
              // Older entries persisted internalCloneUrl (with admin credentials)
              // and possibly credential-bearing Git URLs – drop them on load.
              gitRepository: sanitizeGitRepository(projectData.gitRepository),
              gitUrl: stripUrlCredentials(projectData.gitUrl),
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
      console.error('Error loading projects from disk:', error);
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

  // Moves every project of a group to another (validated) group name
  async renameGroup(oldName, newName) {
    const groupName = String(newName || '').trim();
    if (!groupName) {
      throw new Error('New group name is required');
    } else if (groupName.length > 50) {
      throw new Error('Group name must be 50 characters or less');
    } else if (!/^[a-zA-Z0-9\s\-_]+$/.test(groupName)) {
      throw new Error('Group name can only contain letters, numbers, spaces, hyphens, and underscores');
    }
    let moved = 0;
    for (const project of this.projects.values()) {
      if ((project.group || 'Uncategorized') === oldName) {
        project.group = groupName;
        moved++;
      }
    }
    if (moved > 0) await this.saveProjectsToDisk();
    return groupName;
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

    // Update the container first: if that fails, the stored hash must keep
    // matching what code-server actually uses.
    if (removePassword) {
      await dockerService.updateWorkspacePassword(projectId, null);
      project.passwordProtected = false;
      project.passwordHash = null;
    } else if (newPassword) {
      // Validate new password
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }
      if (newPassword.length > 50) {
        throw new Error('Password must be less than 50 characters');
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await dockerService.updateWorkspacePassword(projectId, newPassword);
      project.passwordProtected = true;
      project.passwordHash = newHash;
    } else {
      throw new Error('Either newPassword or removePassword must be provided');
    }

    project.lastAccessed = new Date();
    await this.saveProjectsToDisk();

    return { success: true, passwordProtected: project.passwordProtected };
  }
}

module.exports = new WorkspaceService();