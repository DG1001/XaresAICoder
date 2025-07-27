const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');

class DockerService {
  constructor() {
    this.docker = new Docker();
    this.network = process.env.DOCKER_NETWORK || 'xares-aicoder-network';
    this.codeServerPassword = process.env.CODE_SERVER_PASSWORD || 'default_password';
    this.activeContainers = new Map();
  }

  async createWorkspaceContainer(projectId, projectType) {
    try {
      const containerName = `workspace-${projectId}`;
      const port = await this.findAvailablePort(8080);

      // Build the code-server image if it doesn't exist
      await this.ensureCodeServerImage();

      const container = await this.docker.createContainer({
        Image: 'xares-aicoder-codeserver:latest',
        name: containerName,
        Env: [
          `PASSWORD=${this.codeServerPassword}`,
          `PROJECT_TYPE=${projectType}`,
          `PROJECT_ID=${projectId}`
        ],
        ExposedPorts: {
          '8080/tcp': {}
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
        Cmd: ['code-server', '--bind-addr', '0.0.0.0:8080', '--auth', 'password', '/workspace']
      });

      await container.start();

      // Initialize git repository and project structure
      await this.initializeProject(container, projectType);

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
        workspaceUrl: `/workspace/${projectId}/`,
        status: 'running'
      };

    } catch (error) {
      console.error('Error creating workspace container:', error);
      throw new Error(`Failed to create workspace: ${error.message}`);
    }
  }

  async initializeProject(container, projectType) {
    try {
      const commands = [
        'git init',
        'git config user.name "XaresAICoder User"',
        'git config user.email "user@xaresaicoder.local"'
      ];

      if (projectType === 'python-flask') {
        commands.push('setup_flask_project');
      }

      for (const cmd of commands) {
        await container.exec({
          Cmd: ['bash', '-c', cmd],
          AttachStdout: true,
          AttachStderr: true
        });
      }
    } catch (error) {
      console.error('Error initializing project:', error);
      // Don't throw here, as the container is already created
    }
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
    const workspace = this.activeContainers.get(projectId);
    if (!workspace) {
      return { status: 'not_found' };
    }

    try {
      const containerInfo = await workspace.container.inspect();
      return {
        projectId,
        status: containerInfo.State.Running ? 'running' : 'stopped',
        workspaceUrl: `/workspace/${projectId}/`,
        createdAt: workspace.createdAt,
        projectType: workspace.projectType
      };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  async stopWorkspace(projectId) {
    const workspace = this.activeContainers.get(projectId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    try {
      await workspace.container.stop();
      await workspace.container.remove();
      this.activeContainers.delete(projectId);
      return { success: true };
    } catch (error) {
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