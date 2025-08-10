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
  }

  async createWorkspaceContainer(projectId, projectType, authOptions = {}) {
    try {
      const containerName = `workspace-${projectId}`;
      const port = await this.findAvailablePort(8080);

      // Build the code-server image if it doesn't exist
      await this.ensureCodeServerImage();

      // Setup authentication and Git configuration
      const { memoryLimit = '2g', passwordProtected = false, password = null, gitRepository = null } = authOptions;
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

      // Add Git repository configuration to environment if available
      if (gitRepository) {
        envVars.push(`GIT_REPO_NAME=${gitRepository.name}`);
        envVars.push(`GIT_REMOTE_URL=${gitRepository.internalCloneUrl}`);
        envVars.push(`GIT_WEB_URL=${gitRepository.webUrl}`);
      }

      // Convert memory limit to bytes
      const memoryBytes = this.parseMemoryLimit(memoryLimit);

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
          CpuShares: 1024, // 1 CPU cores equivalent
          NetworkMode: this.network,
          RestartPolicy: {
            Name: 'unless-stopped'
          }
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

      // Add Git remote configuration if repository was created
      // We'll check for environment variables in the container
      commands.push('if [ -n "$GIT_REPO_NAME" ] && [ -n "$GIT_REMOTE_URL" ]; then');
      commands.push('  echo "Configuring Git remote for repository: $GIT_REPO_NAME"');
      commands.push('  git remote add origin "$GIT_REMOTE_URL"');
      commands.push('  git branch -M main');
      commands.push('fi');

      if (projectType === 'python-flask') {
        console.log('Adding Flask project setup commands');
        commands.push('setup_flask_project');
        commands.push('git add .');
        commands.push('git commit -m "Initial Flask project setup"');
      } else if (projectType === 'node-react') {
        console.log('Adding Node.js/React project setup commands');
        commands.push('setup_node_react_project');
        commands.push('git add .');
        commands.push('git commit -m "Initial Node.js React project setup"');
      } else if (projectType === 'java-spring') {
        console.log('Adding Java/Spring project setup commands');
        commands.push('setup_java_spring_project');
        commands.push('git add .');
        commands.push('git commit -m "Initial Java Spring Boot project setup"');
      } else if (projectType === 'empty') {
        console.log('Adding empty project setup commands');
        commands.push('setup_empty_project');
        commands.push('git add .');
        commands.push('git commit -m "Initial empty project setup"');
      }

      // Push to remote repository if configured
      commands.push('if [ -n "$GIT_REPO_NAME" ] && [ -n "$GIT_REMOTE_URL" ]; then');
      commands.push('  echo "Pushing to remote repository: $GIT_REPO_NAME"');
      commands.push('  git push -u origin main');
      commands.push('fi');

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
      
      return {
        projectId,
        status,
        workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        createdAt: workspace.createdAt,
        projectType: workspace.projectType,
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
    // Convert memory limit string (e.g., '1g', '2g', '4g') to bytes
    const memoryMap = {
      '1g': 1 * 1024 * 1024 * 1024, // 1GB
      '2g': 2 * 1024 * 1024 * 1024, // 2GB
      '4g': 4 * 1024 * 1024 * 1024  // 4GB
    };
    
    const memory = memoryMap[memoryLimit];
    if (!memory) {
      console.warn(`Invalid memory limit '${memoryLimit}', defaulting to 2GB`);
      return memoryMap['2g'];
    }
    
    return memory;
  }
}

module.exports = new DockerService();