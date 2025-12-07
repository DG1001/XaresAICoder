const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');

class DockerService {
  constructor() {
    this.docker = new Docker();
    // External persistent network name (no Docker Compose prefix)
    this.network = process.env.DOCKER_NETWORK || 'xares-aicoder-network';
    this.activeContainers = new Map();
    // Domain and port configuration
    this.baseDomain = process.env.BASE_DOMAIN || 'localhost';
    this.basePort = process.env.BASE_PORT || '80';
    this.protocol = process.env.PROTOCOL || 'http';
    // Docker image configuration
    this.codeServerImage = process.env.CODESERVER_IMAGE || 'xares-aicoder-codeserver:latest';
    // Disk usage display configuration
    this.showDiskUsage = process.env.SHOW_DISK_USAGE === 'true';
    // Security and isolation configuration
    this.securityConfig = {
      pidsLimit: parseInt(process.env.CONTAINER_PIDS_LIMIT) || 512,
      maxFileDescriptors: parseInt(process.env.CONTAINER_MAX_FDS) || 4096,
      maxFileDescriptorsHard: parseInt(process.env.CONTAINER_MAX_FDS_HARD) || 8192,
      maxProcessesPerUser: parseInt(process.env.CONTAINER_MAX_PROCS) || 512,
      maxProcessesPerUserHard: parseInt(process.env.CONTAINER_MAX_PROCS_HARD) || 1024
    };
  }

  async createWorkspaceContainer(projectId, projectType, authOptions = {}) {
    try {
      const containerName = `workspace-${projectId}`;
      const port = await this.findAvailablePort(8080);

      // Build the code-server image if it doesn't exist
      await this.ensureCodeServerImage();

      // Setup authentication and Git configuration
      const { memoryLimit = '2g', cpuCores = '2', passwordProtected = false, password = null, gitRepository = null, gitUrl = null, gitUsername = null, gitToken = null } = authOptions;
      let authFlag = 'none'; // Default to no auth
      const envVars = [
        `PROJECT_TYPE=${projectType}`,
        `PROJECT_ID=${projectId}`,
        `VSCODE_PROXY_URI=${this.protocol}://${projectId}-{{port}}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        `PROXY_DOMAIN=${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}`
      ];

      if (passwordProtected && password) {
        authFlag = 'password';
        envVars.push(`PASSWORD=${password}`);
      }

      // Add Git server URL to all containers when Git server is enabled
      // This allows setup_local_remote script to work in any workspace
      const gitServerEnabled = process.env.ENABLE_GIT_SERVER === 'true';
      if (gitServerEnabled) {
        const protocol = process.env.PROTOCOL || 'http';
        const baseDomain = process.env.BASE_DOMAIN || 'localhost';
        const basePort = process.env.BASE_PORT || '80';
        const gitAdminUser = process.env.GIT_ADMIN_USER || 'developer';
        const gitAdminPassword = process.env.GIT_ADMIN_PASSWORD || 'admin123!';

        // Build Git server URL (accessible from inside Docker network)
        envVars.push(`GIT_SERVER_ENABLED=true`);
        envVars.push(`GIT_SERVER_URL=http://forgejo:3000`);
        envVars.push(`GIT_ADMIN_USER=${gitAdminUser}`);
        envVars.push(`GIT_ADMIN_PASSWORD=${gitAdminPassword}`);

        // Build external Git server URL for display
        let externalGitUrl;
        if ((protocol === 'http' && basePort === '80') || (protocol === 'https' && basePort === '443')) {
          externalGitUrl = `${protocol}://${baseDomain}/git`;
        } else {
          externalGitUrl = `${protocol}://${baseDomain}:${basePort}/git`;
        }
        envVars.push(`GIT_SERVER_EXTERNAL_URL=${externalGitUrl}`);
      }

      // Add Git repository configuration to environment if available
      if (gitRepository) {
        envVars.push(`GIT_REPO_NAME=${gitRepository.name}`);
        envVars.push(`GIT_REMOTE_URL=${gitRepository.internalCloneUrl}`);
        envVars.push(`GIT_WEB_URL=${gitRepository.webUrl}`);
      }

      // Add Git clone configuration if available
      if (gitUrl) {
        envVars.push(`GIT_CLONE_URL=${gitUrl}`);
        if (gitUsername) {
          envVars.push(`GIT_USERNAME=${gitUsername}`);
        }
        if (gitToken) {
          envVars.push(`GIT_ACCESS_TOKEN=${gitToken}`);
        }
      }

      // Convert memory limit to bytes and CPU cores to shares
      const memoryBytes = this.parseMemoryLimit(memoryLimit);
      const cpuShares = this.parseCpuCores(cpuCores);

      // Add GPU environment variables only if GPU is enabled
      const enableGpu = process.env.ENABLE_GPU === 'true';
      if (enableGpu) {
        envVars.push('NVIDIA_VISIBLE_DEVICES=all');
        envVars.push('NVIDIA_DRIVER_CAPABILITIES=compute,utility');
      }

      const container = await this.docker.createContainer({
        Image: this.codeServerImage,
        name: containerName,
        Env: envVars,
        ExposedPorts: {
          '8082/tcp': {}, // code-server
          '3000/tcp': {}, // Node.js apps
          '5000/tcp': {}, // Flask/Python apps
          '8000/tcp': {}, // Django/other Python apps
          '8080/tcp': {}, // Spring Boot apps
          '4200/tcp': {}, // Angular
          '3001/tcp': {}, // React dev server alt
          '9000/tcp': {}  // Various apps
        },
        HostConfig: {
          Memory: memoryBytes,
          CpuShares: cpuShares,
          NetworkMode: this.network,
          PidMode: '', // Isolated PID namespace (default, but explicit for security)
          IpcMode: 'private', // Isolated IPC namespace (prevents container communication via shared memory)
          PidsLimit: this.securityConfig.pidsLimit, // Limit max processes (prevents fork bombs)
          SecurityOpt: [
            'no-new-privileges:true', // Prevents privilege escalation
            'seccomp=unconfined' // Allow system calls needed for development tools (debuggers, etc.)
          ],
          // Drop all capabilities, then add back only what's needed for development
          CapDrop: ['ALL'],
          CapAdd: [
            'CHOWN',           // Change file ownership
            'DAC_OVERRIDE',    // Bypass file permission checks (needed for some dev tools)
            'FOWNER',          // Bypass permission checks on file operations
            'SETGID',          // Set GID (needed for some installers)
            'SETUID',          // Set UID (needed for some installers)
            'NET_BIND_SERVICE' // Bind to ports < 1024 (useful for web servers)
          ],
          // Resource limits to prevent abuse
          Ulimits: [
            { Name: 'nofile', Soft: this.securityConfig.maxFileDescriptors, Hard: this.securityConfig.maxFileDescriptorsHard },
            { Name: 'nproc', Soft: this.securityConfig.maxProcessesPerUser, Hard: this.securityConfig.maxProcessesPerUserHard }
          ],
          RestartPolicy: {
            Name: 'unless-stopped'
          },
          // Only request GPU access if GPU is enabled
          ...(enableGpu && {
            DeviceRequests: [{
              Driver: '',
              Count: -1, // Request all available GPUs
              Capabilities: [['gpu']]
            }]
          })
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [this.network]: {
              Aliases: [containerName]
            }
          }
        },
        WorkingDir: '/workspace',
        Cmd: ['code-server', '--bind-addr', '0.0.0.0:8082', '--auth', authFlag, '--proxy-domain', `${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}`, '/workspace']
      });

      await container.start();
      console.log(`Container ${containerName} started`);

      // Wait for code-server to be ready first
      await this.waitForWorkspaceReady(containerName);
      console.log(`Workspace ${containerName} is ready, now initializing project`);

      // Initialize git repository and project structure after container is ready
      await this.initializeProject(container, projectType);
      console.log(`Initialization completed for ${containerName}`);

      this.activeContainers.set(projectId, {
        container,
        name: containerName,
        port,
        createdAt: new Date(),
        projectType
      });

      return {
        projectId,
        containerName,
        workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        status: 'running'
      };

    } catch (error) {
      console.error('Error creating workspace container:', error);
      throw new Error(`Failed to create workspace: ${error.message}`);
    }
  }

  async initializeProject(container, projectType) {
    console.log(`Starting project initialization for type: ${projectType}`);
    try {
      // Create a marker file to verify the function is running
      const markerExec = await container.exec({
        Cmd: ['bash', '-c', 'echo "Initialization started" > /workspace/INIT_MARKER.txt'],
        AttachStdout: true,
        AttachStderr: true
      });
      await markerExec.start();
      
      const commands = [
        'git init',
        'git config user.name "XaresAICoder User"',
        'git config user.email "user@xaresaicoder.local"'
      ];

      // Add Git remote configuration if repository was created (only when NOT cloning)
      // For git-clone with createGitRepo, we'll set up remotes after cloning
      commands.push('if [ -n "$GIT_REPO_NAME" ] && [ -n "$GIT_REMOTE_URL" ] && [ -z "$GIT_CLONE_URL" ]; then echo "Configuring Git remote for repository: $GIT_REPO_NAME"; git remote add origin "$GIT_REMOTE_URL"; git branch -M main; fi');

      if (projectType === 'empty' || projectType === 'python-flask' || projectType === 'node-react' || projectType === 'java-spring') {
        console.log(`Adding empty project setup commands (legacy type: ${projectType})`);
        commands.push('setup_empty_project');
        // Note: Legacy template types (python-flask, node-react, java-spring) now default to empty project
      } else if (projectType === 'git-clone') {
        console.log('Adding Git repository cloning commands');
        // Create a single comprehensive command for Git cloning to avoid bash syntax issues
        const gitCloneScript = `
if [ -n "$GIT_CLONE_URL" ]; then
  echo "Cloning Git repository: $GIT_CLONE_URL"

  # Clean workspace completely (git clone needs empty directory)
  find /workspace -mindepth 1 -delete 2>/dev/null || true

  # For public repositories: simple clone without authentication
  # For private repositories: embed credentials in URL only if provided
  if [ -n "$GIT_ACCESS_TOKEN" ] && [ -n "$GIT_USERNAME" ]; then
    # Private repository with username and token
    PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|://.*||')
    URL_WITHOUT_PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|^[^:]*://||')
    CLONE_URL="\${PROTOCOL}://\${GIT_USERNAME}:\${GIT_ACCESS_TOKEN}@\${URL_WITHOUT_PROTOCOL}"
    echo "Cloning private repository with authentication for $GIT_USERNAME"
  elif [ -n "$GIT_ACCESS_TOKEN" ]; then
    # Private repository with token only
    PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|://.*||')
    URL_WITHOUT_PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|^[^:]*://||')
    CLONE_URL="\${PROTOCOL}://\${GIT_ACCESS_TOKEN}@\${URL_WITHOUT_PROTOCOL}"
    echo "Cloning private repository with token authentication"
  else
    # Public repository - use URL as-is
    CLONE_URL="$GIT_CLONE_URL"
    echo "Cloning public repository (no authentication required)"
  fi

  # Clone directly into workspace directory
  if git clone "\$CLONE_URL" /workspace; then
    cd /workspace
    echo "✅ Repository cloned successfully to /workspace"

    # Configure Git user for this repository
    git config user.name "XaresAICoder User"
    git config user.email "user@xaresaicoder.local"

    # Set up dual remotes if local Forgejo repository was also created
    if [ -n "$GIT_REPO_NAME" ] && [ -n "$GIT_REMOTE_URL" ]; then
      echo "🔀 Setting up dual remotes (local Forgejo + external repo)"

      # Rename cloned 'origin' to 'github' for external repo
      if git remote rename origin github 2>/dev/null; then
        echo "✅ External repo configured as 'github' remote"
      fi

      # Add local Forgejo as 'origin' (main remote)
      if git remote add origin "$GIT_REMOTE_URL" 2>/dev/null; then
        echo "✅ Local Forgejo configured as 'origin' remote"

        # Push all branches to local Forgejo
        if git push -u origin --all 2>/dev/null; then
          echo "✅ Pushed branches to local Forgejo"
        fi

        # Push tags if any exist
        if [ -n "$(git tag)" ]; then
          git push origin --tags 2>/dev/null && echo "✅ Pushed tags to local Forgejo"
        fi

        echo "📋 Git remotes configured:"
        git remote -v
      else
        echo "⚠️  Failed to add local Forgejo remote"
      fi
    else
      # Only set up persistent credentials for private repositories (single remote mode)
      if [ -n "$GIT_ACCESS_TOKEN" ]; then
        git remote set-url origin "\$CLONE_URL"
        echo "✅ Remote URL configured with credentials for future git operations"
      fi
    fi

    echo "Repository contents:"
    git status --short || true
  else
    echo "❌ Failed to clone repository: $GIT_CLONE_URL"
    echo "The workspace will start with an empty project instead."
  fi
fi`.trim();
        commands.push(gitCloneScript);
      }

      // Note: No automatic push - template files are not committed
      // Users can commit and push their initial files when ready

      // Run commands as root but set proper ownership afterward
      for (const cmd of commands) {
        console.log(`Executing: ${cmd}`);
        const fullCmd = `source /home/coder/.bashrc && cd /workspace && ${cmd}`;
        
        const exec = await container.exec({
          Cmd: ['bash', '-c', fullCmd],
          AttachStdout: true,
          AttachStderr: true,
          Env: ['HOME=/home/coder', 'USER=coder'] // Git env vars are already in container env
        });
        
        const stream = await exec.start();
        const output = await this.streamToString(stream);
        console.log(`Command output: ${output.trim()}`);
      }
      
      // Fix ownership of created files
      const chownExec = await container.exec({
        Cmd: ['chown', '-R', 'coder:coder', '/workspace'],
        AttachStdout: true,
        AttachStderr: true
      });
      await chownExec.start();
      console.log('Project initialization completed successfully');
    } catch (error) {
      console.error('Error initializing project:', error);
      // Don't throw here, as the container is already created
    }
  }

  async waitForWorkspaceReady(containerName, maxWaitTime = 15000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    console.log(`Waiting for workspace ${containerName} to be ready...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const container = this.docker.getContainer(containerName);
        
        // Simple approach: just check if we can execute curl successfully
        const exec = await container.exec({
          Cmd: ['/usr/bin/curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8082/', '--max-time', '3'],
          AttachStdout: true,
          AttachStderr: false
        });
        
        const stream = await exec.start({ hijack: true, stdin: false });
        const result = await this.streamToString(stream);
        
        console.log(`Health check result: "${result.trim()}"`);
        
        // Any valid HTTP response code means the server is responding
        const httpCode = result.trim();
        if (httpCode && (httpCode.includes('302') || httpCode.includes('200') || httpCode.match(/[2-5]\d{2}/))) {
          console.log(`Workspace ${containerName} is ready! (HTTP ${httpCode})`);
          return true;
        }
      } catch (error) {
        console.log(`Health check attempt failed: ${error.message}`);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.warn(`Workspace ${containerName} not ready after ${maxWaitTime}ms, proceeding anyway`);
    return false;
  }

  async streamToString(stream) {
    return new Promise((resolve, reject) => {
      let data = '';
      stream.on('data', chunk => {
        data += chunk.toString();
      });
      stream.on('end', () => {
        resolve(data);
      });
      stream.on('error', reject);
    });
  }

  async ensureCodeServerImage() {
    try {
      await this.docker.getImage(this.codeServerImage).inspect();
    } catch (error) {
      // Image doesn't exist, need to build it
      console.log(`Building code-server image: ${this.codeServerImage}...`);
      // In a real implementation, you would build from the Dockerfile
      // For now, we'll use the official code-server image as fallback
      throw new Error(`Code-server image not found: ${this.codeServerImage}. Please build the image first with: docker build -t ${this.codeServerImage} ./code-server`);
    }
  }

  async getContainerDiskUsage(projectId) {
    const containerName = `workspace-${projectId}`;

    try {
      const container = this.docker.getContainer(containerName);

      // Use Docker's native container inspect with size information
      // This is much more reliable than executing du commands inside containers
      const containerInfo = await container.inspect({ size: true });

      if (containerInfo.SizeRw !== undefined) {
        // SizeRw = size of the writable layer (user data)
        // SizeRootFs = total size including read-only layers (base image + user data)
        // For workspace usage, SizeRw is most relevant as it represents user-created data
        const userDataSize = containerInfo.SizeRw || 0;
        const totalSize = containerInfo.SizeRootFs || 0;

        return {
          bytes: userDataSize,
          totalBytes: totalSize,
          readable: this.formatBytes(userDataSize),
          totalReadable: this.formatBytes(totalSize)
        };
      }

      // Fallback if size information is not available
      return {
        bytes: 0,
        totalBytes: 0,
        readable: 'Unknown',
        totalReadable: 'Unknown'
      };

    } catch (error) {
      console.error(`Error getting disk usage for container ${containerName}:`, error.message);
      return {
        bytes: 0,
        totalBytes: 0,
        readable: 'Unknown',
        totalReadable: 'Unknown'
      };
    }
  }

  async getAllWorkspaceContainerSizes() {
    try {
      // Get all containers with size information in a single API call
      // Much more efficient than calling inspect on each container individually
      const containers = await this.docker.listContainers({
        all: true,
        size: true,
        filters: {
          name: ['workspace-']  // Only get workspace containers
        }
      });

      const sizeMap = new Map();

      containers.forEach(container => {
        // Extract project ID from container name (format: workspace-{projectId})
        const containerName = container.Names[0]?.replace(/^\//, ''); // Remove leading slash
        const projectIdMatch = containerName?.match(/^workspace-(.+)$/);

        if (projectIdMatch) {
          const projectId = projectIdMatch[1];
          const userDataSize = container.SizeRw || 0;
          const totalSize = container.SizeRootFs || 0;

          sizeMap.set(projectId, {
            bytes: userDataSize,
            totalBytes: totalSize,
            readable: this.formatBytes(userDataSize),
            totalReadable: this.formatBytes(totalSize)
          });
        }
      });

      return sizeMap;
    } catch (error) {
      console.error('Error getting batch container sizes:', error.message);
      return new Map();
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';

    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    // For sizes >= 1GB, show 1 decimal place
    // For sizes < 1GB, show appropriate precision
    if (i >= 3) {
      return size.toFixed(1) + ' ' + sizes[i];
    } else if (i >= 2) {
      return size.toFixed(size < 10 ? 1 : 0) + ' ' + sizes[i];
    } else {
      return Math.round(size) + ' ' + sizes[i];
    }
  }

  async getAllProjectStatuses() {
    try {
      // Get all containers and filter manually (Docker filter syntax can be tricky)
      const containers = await this.docker.listContainers({
        all: true
      });

      const statusMap = new Map();

      containers.forEach(container => {
        const containerName = container.Names[0]?.replace(/^\//, '');

        // Only process workspace containers
        if (!containerName?.startsWith('workspace-')) {
          return;
        }

        const projectIdMatch = containerName.match(/^workspace-(.+)$/);

        if (projectIdMatch) {
          const projectId = projectIdMatch[1];
          const isRunning = container.State === 'running';
          const status = isRunning ? 'running' : 'stopped';

          statusMap.set(projectId, {
            projectId,
            status,
            workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
            createdAt: new Date(container.Created * 1000),
            projectType: 'unknown', // Will be preserved from stored data
            containerInfo: {
              running: isRunning,
              state: container.State,
              status: container.Status
            }
          });
        }
      });

      console.log(`Found ${statusMap.size} workspace containers`);
      return statusMap;
    } catch (error) {
      console.error('Error getting batch container statuses:', error);
      return new Map();
    }
  }

  async getProjectStatus(projectId) {
    const containerName = `workspace-${projectId}`;

    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      const isRunning = containerInfo.State.Running;
      const status = isRunning ? 'running' : 'stopped';

      // Update our in-memory cache if container exists
      if (!this.activeContainers.has(projectId)) {
        this.activeContainers.set(projectId, {
          container: container,
          createdAt: new Date(containerInfo.Created),
          projectType: this.extractProjectTypeFromEnv(containerInfo.Config.Env)
        });
      }

      const workspace = this.activeContainers.get(projectId);

      // Get disk usage for the container only if enabled
      const diskUsage = this.showDiskUsage ? await this.getContainerDiskUsage(projectId) : null;

      return {
        projectId,
        status,
        workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        createdAt: workspace.createdAt,
        projectType: workspace.projectType,
        diskUsage: diskUsage,
        containerInfo: {
          running: isRunning,
          startedAt: containerInfo.State.StartedAt,
          finishedAt: containerInfo.State.FinishedAt,
          exitCode: containerInfo.State.ExitCode
        }
      };
    } catch (error) {
      // Container doesn't exist
      if (error.statusCode === 404) {
        return { status: 'not_found' };
      }
      console.error(`Error inspecting container for project ${projectId}:`, error);
      return { status: 'error', error: error.message };
    }
  }

  // Helper method to extract project type from container environment variables
  extractProjectTypeFromEnv(envArray) {
    const projectTypeVar = envArray.find(env => env.startsWith('PROJECT_TYPE='));
    return projectTypeVar ? projectTypeVar.split('=')[1] : 'unknown';
  }

  async startWorkspace(projectId) {
    const containerName = `workspace-${projectId}`;
    
    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      
      if (containerInfo.State.Running) {
        return { success: true, message: 'Workspace is already running' };
      }

      // Check if container is orphaned (not connected to network)
      const isOrphaned = await this.isContainerOrphaned(container);
      if (isOrphaned) {
        console.log(`Container ${containerName} is orphaned, attempting network recovery...`);
        const recoveryResult = await this.recoverOrphanedContainer(container, containerName);
        if (!recoveryResult.success) {
          throw new Error(`Network recovery failed: ${recoveryResult.error}`);
        }
        console.log(`Network recovery successful for ${containerName}`);
      }

      await container.start();
      
      // Update our in-memory cache
      this.activeContainers.set(projectId, {
        container: container,
        name: containerName,
        createdAt: new Date(containerInfo.Created),
        projectType: this.extractProjectTypeFromEnv(containerInfo.Config.Env)
      });
      
      // Wait for workspace to be ready after starting
      await this.waitForWorkspaceReady(containerName);
      
      return { 
        success: true, 
        message: 'Workspace started successfully',
        status: 'running'
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error('Workspace container not found');
      }
      console.error(`Error starting workspace ${projectId}:`, error);
      throw new Error(`Failed to start workspace: ${error.message}`);
    }
  }

  async stopWorkspaceContainer(projectId) {
    const containerName = `workspace-${projectId}`;
    
    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      
      if (!containerInfo.State.Running) {
        return { success: true, message: 'Workspace is already stopped' };
      }

      await container.stop({ t: 10 }); // 10 second timeout
      
      // Update our in-memory cache
      this.activeContainers.set(projectId, {
        container: container,
        name: containerName,
        createdAt: new Date(containerInfo.Created),
        projectType: this.extractProjectTypeFromEnv(containerInfo.Config.Env)
      });
      
      return { 
        success: true, 
        message: 'Workspace stopped successfully',
        status: 'stopped'
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error('Workspace container not found');
      }
      console.error(`Error stopping workspace ${projectId}:`, error);
      throw new Error(`Failed to stop workspace: ${error.message}`);
    }
  }

  async stopWorkspace(projectId) {
    const containerName = `workspace-${projectId}`;
    
    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      
      if (containerInfo.State.Running) {
        await container.stop();
      }
      
      await container.remove();
      this.activeContainers.delete(projectId);
      return { success: true };
    } catch (error) {
      if (error.statusCode === 404) {
        // Container already doesn't exist, consider it success
        this.activeContainers.delete(projectId);
        return { success: true };
      }
      throw new Error(`Failed to stop workspace: ${error.message}`);
    }
  }

  async findAvailablePort(startPort) {
    // In a real implementation, you would check for available ports
    // For now, return a port based on project count
    return startPort + this.activeContainers.size;
  }

  async cleanupInactiveWorkspaces() {
    // Automatic cleanup functionality removed
    // This method is kept for backward compatibility with manual cleanup endpoint
    console.log('Manual cleanup triggered - removing orphaned project metadata');
    
    // Only clean up project metadata for containers that no longer exist
    // This is safe and helps keep the project list accurate
  }

  // Network validation and recovery methods

  async ensureNetworkExists() {
    try {
      const network = this.docker.getNetwork(this.network);
      await network.inspect();
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        console.error(`Network '${this.network}' does not exist!`);
        console.error('Please run: ./setup-network.sh to create the required network');
        return false;
      }
      throw error;
    }
  }

  async isContainerOrphaned(container) {
    try {
      const containerInfo = await container.inspect();
      const networks = containerInfo.NetworkSettings.Networks;
      
      // Check if container is connected to our required network
      if (!networks || !networks[this.network]) {
        return true; // Orphaned - not connected to required network
      }
      
      // Check if the network actually exists
      const networkExists = await this.ensureNetworkExists();
      if (!networkExists) {
        return true; // Network doesn't exist, container is orphaned
      }
      
      return false; // Container is properly connected
    } catch (error) {
      console.error('Error checking container orphan status:', error);
      return true; // Assume orphaned on error to be safe
    }
  }

  async recoverOrphanedContainer(container, containerName) {
    try {
      console.log(`Attempting to recover orphaned container: ${containerName}`);
      
      // Ensure the network exists
      const networkExists = await this.ensureNetworkExists();
      if (!networkExists) {
        return { 
          success: false, 
          error: `Required network '${this.network}' does not exist. Run ./setup-network.sh first.` 
        };
      }
      
      // Get the network object
      const network = this.docker.getNetwork(this.network);
      
      // Connect container to network with alias
      await network.connect({
        Container: containerName,
        EndpointConfig: {
          Aliases: [containerName]
        }
      });
      
      console.log(`Successfully connected ${containerName} to network ${this.network}`);
      return { success: true, message: 'Container recovered successfully' };
      
    } catch (error) {
      console.error(`Failed to recover container ${containerName}:`, error);
      
      // If connection failed, check if it's because it's already connected
      if (error.message && error.message.includes('already exists')) {
        console.log(`Container ${containerName} is already connected to network`);
        return { success: true, message: 'Container was already connected' };
      }
      
      return { 
        success: false, 
        error: `Network recovery failed: ${error.message}` 
      };
    }
  }

  async validateNetworkHealth() {
    try {
      const networkExists = await this.ensureNetworkExists();
      if (!networkExists) {
        return {
          healthy: false,
          error: `Network '${this.network}' does not exist`,
          recommendation: 'Run ./setup-network.sh to create the required network'
        };
      }
      
      // Get network details
      const network = this.docker.getNetwork(this.network);
      const networkInfo = await network.inspect();
      
      return {
        healthy: true,
        networkId: networkInfo.Id,
        subnet: networkInfo.IPAM.Config?.[0]?.Subnet || 'Unknown',
        connectedContainers: Object.keys(networkInfo.Containers || {}).length,
        details: networkInfo
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        recommendation: 'Check Docker daemon and network configuration'
      };
    }
  }

  parseMemoryLimit(memoryLimit) {
    // Convert memory limit string (e.g., '1g', '2g', '4g', '8g', '16g') to bytes
    const memoryMap = {
      '1g': 1 * 1024 * 1024 * 1024,   // 1GB
      '2g': 2 * 1024 * 1024 * 1024,   // 2GB
      '4g': 4 * 1024 * 1024 * 1024,   // 4GB
      '8g': 8 * 1024 * 1024 * 1024,   // 8GB
      '16g': 16 * 1024 * 1024 * 1024  // 16GB
    };
    
    const memory = memoryMap[memoryLimit];
    if (!memory) {
      console.warn(`Invalid memory limit '${memoryLimit}', defaulting to 2GB`);
      return memoryMap['2g'];
    }
    
    return memory;
  }

  parseCpuCores(cpuCores) {
    // Convert CPU cores string to CPU shares
    // Docker CPU shares: 1024 shares = 1 CPU core
    const coreMap = {
      '1': 1024,  // 1 core
      '2': 2048,  // 2 cores
      '4': 4096,  // 4 cores
      '8': 8192   // 8 cores
    };
    
    const shares = coreMap[cpuCores];
    if (!shares) {
      console.warn(`Invalid CPU cores '${cpuCores}', defaulting to 2 cores`);
      return coreMap['2'];
    }
    
    return shares;
  }
}

module.exports = new DockerService();