const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');

class DockerService {
  constructor() {
    this.docker = new Docker();
    // Docker Compose prefixes network names with project name
    this.network = process.env.DOCKER_NETWORK || 'xaresaicoder_xares-aicoder-network';
    this.activeContainers = new Map();
  }

  async createWorkspaceContainer(projectId, projectType, authOptions = {}) {
    try {
      const containerName = `workspace-${projectId}`;
      const port = await this.findAvailablePort(8080);

      // Build the code-server image if it doesn't exist
      await this.ensureCodeServerImage();

      // Setup authentication
      const { passwordProtected = false, password = null } = authOptions;
      let authFlag = 'none'; // Default to no auth
      const envVars = [
        `PROJECT_TYPE=${projectType}`,
        `PROJECT_ID=${projectId}`,
        `VSCODE_PROXY_URI=http://${projectId}-{{port}}.localhost/`,
        `PROXY_DOMAIN=${projectId}.localhost`
      ];

      if (passwordProtected && password) {
        authFlag = 'password';
        envVars.push(`PASSWORD=${password}`);
      }

      const container = await this.docker.createContainer({
        Image: 'xares-aicoder-codeserver:latest',
        name: containerName,
        Env: envVars,
        ExposedPorts: {
          '8080/tcp': {}, // code-server
          '3000/tcp': {}, // Node.js apps
          '5000/tcp': {}, // Flask/Python apps
          '8000/tcp': {}, // Django/other Python apps
          '4200/tcp': {}, // Angular
          '3001/tcp': {}, // React dev server alt
          '9000/tcp': {}  // Various apps
        },
        HostConfig: {
          Memory: 4 * 1024 * 1024 * 1024, // 4GB
          CpuShares: 2048, // 2 CPU cores equivalent
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
        Cmd: ['code-server', '--bind-addr', '0.0.0.0:8080', '--auth', authFlag, '--proxy-domain', `${projectId}.localhost`, '/workspace']
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
        workspaceUrl: `http://${projectId}.localhost/`,
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

      if (projectType === 'python-flask') {
        console.log('Adding Flask project setup commands');
        commands.push('setup_flask_project');
        commands.push('git add .');
        commands.push('git commit -m "Initial Flask project setup"');
      }

      // Run commands as root but set proper ownership afterward
      for (const cmd of commands) {
        console.log(`Executing: ${cmd}`);
        const fullCmd = `source /home/coder/.bashrc && cd /workspace && ${cmd}`;
        
        const exec = await container.exec({
          Cmd: ['bash', '-c', fullCmd],
          AttachStdout: true,
          AttachStderr: true,
          Env: ['HOME=/home/coder', 'USER=coder']
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
          Cmd: ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8080/', '--max-time', '3'],
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
      await this.docker.getImage('xares-aicoder-codeserver:latest').inspect();
    } catch (error) {
      // Image doesn't exist, need to build it
      console.log('Building code-server image...');
      // In a real implementation, you would build from the Dockerfile
      // For now, we'll use the official code-server image as fallback
      throw new Error('Code-server image not found. Please build the image first with: docker build -t xares-aicoder-codeserver:latest ./code-server');
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
        workspaceUrl: `http://${projectId}.localhost/`,
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
    const timeoutMinutes = parseInt(process.env.WORKSPACE_TIMEOUT_MINUTES) || 120;
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const now = new Date();

    for (const [projectId, workspace] of this.activeContainers) {
      if (now - workspace.createdAt > timeoutMs) {
        console.log(`Cleaning up inactive workspace: ${projectId}`);
        try {
          await this.stopWorkspace(projectId);
        } catch (error) {
          console.error(`Error cleaning up workspace ${projectId}:`, error);
        }
      }
    }
  }
}

module.exports = new DockerService();