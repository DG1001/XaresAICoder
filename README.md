# XaresAICoder

A professional browser-based AI-powered development environment that integrates VS Code (code-server) with multiple AI coding assistants for enhanced productivity.

## Overview

XaresAICoder provides isolated development workspaces running VS Code in the browser, with four integrated AI coding tools for comprehensive development assistance. Each workspace runs in a separate Docker container with resource limits, automatic cleanup, and seamless subdomain-based port forwarding.

## Features

### 🎯 **Core Platform**
- **Professional VS Code Interface** with light theme inspired design
- **Optional Password Protection** for workspace security
- **Subdomain-based Port Forwarding** (e.g., `projectid-5000.localhost`)
- **Isolated Docker Workspaces** with automatic resource management
- **Real-time Container Management** with start/stop controls
- **Dynamic Status Monitoring** showing actual container states

### 🤖 **AI Coding Tools (4 Integrated)**
- **OpenCode SST** - Multi-model AI assistant for project analysis
- **Aider** - AI pair programming with direct file editing and git integration
- **Gemini CLI** - Google's AI for code generation and debugging
- **Claude Code** - Anthropic's agentic tool for deep codebase understanding

### 🚀 **Development Features**
- **Python Flask** project templates with virtual environments
- **Automatic Project Initialization** with Git repository setup
- **VS Code Port Forwarding** with automatic browser opening
- **Professional Web Interface** with tabbed navigation
- **Resource Management** with configurable timeouts and limits

## Quick Start

### Prerequisites

- Docker and Docker Compose
- 4GB+ RAM available for containers
- Modern web browser

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd XaresAICoder
   ```

2. **Create environment file**:
   ```bash
   cp .env.example .env
   # Edit .env with your preferences
   ```

3. **Build and start services**:
   ```bash
   docker-compose up --build
   ```

4. **Access the platform**:
   Open http://localhost in your browser

### First Project

1. Enter a project name
2. Select "Python Flask" as the project type
3. **Optional**: Check "Password Protect Workspace" for secure access
4. Click "Create Workspace"
5. Wait for the workspace to be created
6. VS Code will open in a new tab

## Architecture

### Services

- **nginx**: Reverse proxy with subdomain routing for applications
- **server**: Node.js API for project management and container orchestration  
- **code-server containers**: Dynamic VS Code instances with integrated AI tools

### Components

```
├── docker-compose.yml      # Service orchestration
├── nginx.conf             # Reverse proxy configuration
├── server/                # Node.js API backend
│   ├── src/
│   │   ├── index.js      # Main server
│   │   ├── routes/       # API endpoints
│   │   └── services/     # Docker & workspace management
├── code-server/          # Custom VS Code container
│   ├── Dockerfile
│   ├── setup-scripts/    # OpenCode SST installation
│   └── config/          # VS Code configuration
├── frontend/            # Landing page
└── docs/               # User documentation
```

## Development

### Building Code-Server Image

Before starting the platform, build the custom code-server image:

```bash
cd code-server
docker build -t xares-aicoder-codeserver:latest .
cd ..
```

### Running in Development

```bash
# Start all services
docker-compose up --build

# View logs
docker-compose logs -f server

# Stop services
docker-compose down
```

### API Endpoints

#### Project Management
- `POST /api/projects/create` - Create new project with optional password protection
  ```json
  {
    "projectName": "my-project",
    "projectType": "python-flask",
    "passwordProtected": true,  // optional
    "password": "secure-password"  // required if passwordProtected is true
  }
  ```
- `GET /api/projects/:id` - Get project details with real-time status
- `DELETE /api/projects/:id` - Delete project and cleanup containers
  ```json
  {
    "password": "workspace-password"  // required if workspace is password protected
  }
  ```
- `GET /api/projects/` - List all projects with current container status

#### Container Control
- `POST /api/projects/:id/start` - Start stopped workspace container
- `POST /api/projects/:id/stop` - Stop running workspace container
  ```json
  {
    "password": "workspace-password"  // required if workspace is password protected
  }
  ```

#### System
- `GET /api/health` - API server health check
- `GET /api/workspace/stats` - Get workspace statistics

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | 3000 | API server port |
| `WORKSPACE_TIMEOUT_MINUTES` | 120 | Workspace auto-stop timeout |
| `MAX_WORKSPACES_PER_USER` | 5 | Maximum workspaces per user |

### Resource Limits

Each workspace container:
- **CPU**: 2 cores
- **Memory**: 4GB
- **Disk**: 10GB
- **Network**: Isolated bridge network

## AI Development Tools

XaresAICoder includes four powerful AI coding assistants, all pre-installed and ready to use. Choose the tool that best fits your workflow or use them together for maximum productivity.

### 🤖 **OpenCode SST** - Multi-model AI Assistant
**Best for**: Project analysis, multi-model support, collaborative development

```bash
# Quick setup
setup_opencode

# Get started  
opencode auth login
opencode          # Start interactive session
# Then type: /init  # Initialize project analysis
```

**Key Commands:**
- `/init` - Analyze your project
- `/share` - Share session for collaboration  
- `/help` - Show available commands

### 🤖 **Aider** - AI Pair Programming
**Best for**: Interactive coding, file editing, git integration

```bash
# Setup (requires API key)
export OPENAI_API_KEY=your_key_here  # or ANTHROPIC_API_KEY, GEMINI_API_KEY
setup_aider

# Get started
aider             # Start interactive pair programming
```

**Features:**
- Direct file editing with AI
- Automatic git commits
- Supports multiple AI models (OpenAI, Anthropic, Google, Local via Ollama)
- Works with your existing codebase

### 🤖 **Gemini CLI** - Google's AI Assistant  
**Best for**: Code generation, debugging, Google ecosystem integration

```bash
# Setup (requires API key from https://makersuite.google.com/app/apikey)
export GEMINI_API_KEY=your_key_here
setup_gemini

# Get started
gemini            # Start interactive session
```

**Features:**
- Natural language code generation
- Code explanation and debugging
- Project analysis and suggestions

### 🤖 **Claude Code** - Anthropic's Agentic Tool
**Best for**: Deep codebase understanding, multi-file editing, advanced workflows

```bash
# Setup (requires Claude Pro/Max or API billing)
setup_claude

# Get started
claude            # Start agentic coding session
```

**Features:**
- Understands entire codebase
- Multi-file editing capabilities
- Git workflow automation
- Advanced reasoning and planning

### Quick Setup for All Tools

Run this command in your workspace terminal to see setup instructions for all AI tools:
```bash
setup_ai_tools
```

## Project Templates

### Python Flask

Includes:
- Virtual environment setup
- Flask and python-dotenv installed
- Sample application (app.py)
- Requirements file
- Git repository initialization

### Adding New Templates

1. Update `setup-scripts/workspace-init.sh`
2. Add project type to API validation
3. Update frontend project type selector

## Port Forwarding & Application Access

XaresAICoder uses **subdomain-based routing** for seamless application access, eliminating the need for complex path-based URLs.

### How It Works

When you start an application (e.g., Flask on port 5000) in your workspace:

1. **VS Code detects the port** and shows a notification popup
2. **Click "Open in Browser"** to access your app
3. **URL format**: `http://projectid-5000.localhost/`

### Supported Ports

- **Port 5000**: Flask/Python applications  
- **Port 3000**: Node.js applications
- **Port 8000**: Django applications
- **Port 4200**: Angular applications
- **Additional ports**: Automatically forwarded as needed

### Key Benefits

✅ **Clean URLs**: `projectid-5000.localhost` instead of `/proxy/5000/`  
✅ **API Compatibility**: Relative URLs work correctly in your applications  
✅ **Automatic Detection**: VS Code automatically detects new ports  
✅ **Browser Integration**: One-click access from VS Code notifications  
✅ **Production Ready**: Scales to real domains with wildcard certificates  

### Configuration

Port forwarding is pre-configured with optimal settings:

```json
{
  "remote.autoForwardPorts": true,
  "remote.portsAttributes": {
    "5000": {
      "label": "Flask Application",
      "onAutoForward": "openBrowserOnce"
    }
  }
}
```

**Environment Variables (automatically set):**
- `VSCODE_PROXY_URI=http://projectid-{{port}}.localhost/`
- `PROXY_DOMAIN=projectid.localhost`

## Container Management

### Real-time Status Monitoring

XaresAICoder provides real-time container status checking:
- **Running**: Container is active and VS Code is accessible
- **Stopped**: Container is stopped, can be restarted
- **Error**: Container failed or was manually removed

### Workspace Lifecycle

```bash
# Create new workspace (includes health check)
POST /api/projects/create

# Start stopped workspace (waits for readiness)
POST /api/projects/:id/start

# Stop running workspace (graceful shutdown)
POST /api/projects/:id/stop

# Delete workspace (removes container)
DELETE /api/projects/:id
```

### Health Checks

- Workspace creation waits for code-server to respond (15-second timeout)
- Real-time status updates via Docker API inspection
- Automatic cleanup of inactive workspaces after timeout

## Monitoring

### Logs

```bash
# API server logs
docker-compose logs server

# All service logs
docker-compose logs

# Specific workspace logs
docker logs workspace-<project-id>
```

## Security

### Workspace Security

**Optional Password Protection**
- **Per-Workspace Control**: Enable password protection during workspace creation
- **Secure Password Generation**: Cryptographically strong 12-character passwords
- **Custom Passwords**: Use generated passwords or create your own (minimum 8 characters)
- **Operation Protection**: Password required for stop/delete operations on protected workspaces
- **Visual Indicators**: Lock icons identify protected workspaces in the project list
- **Backward Compatibility**: Existing workspaces remain passwordless by default

**Security Workflow**
1. **Creating Protected Workspaces**: Check "Password Protect Workspace" → Auto-generated secure password → Customize if desired
2. **Accessing Workspaces**: Protected workspaces require password authentication via VS Code's built-in auth
3. **Managing Workspaces**: Stop/delete operations require password verification for protected workspaces
4. **Password Display**: Success modal shows password for easy reference when workspace is created

### Container Security

- No root access in workspaces
- Resource limits enforced
- Network isolation
- Regular base image updates

### User Data

- API keys stored only in user workspaces
- Workspace passwords stored securely in memory (not persisted to disk)
- Workspace isolation prevents cross-contamination

## Troubleshooting

### Common Issues

**Containers won't start**
```bash
# Check Docker daemon
docker info

# Check available resources
docker system df
```

**Workspace creation fails**
```bash
# Check code-server image exists
docker images | grep xares-aicoder-codeserver

# Build if missing
cd code-server && docker build -t xares-aicoder-codeserver:latest .
```

**Workspace shows as running but gives 502 error**
```bash
# Check if container is actually running
docker ps | grep workspace-<project-id>

# If stopped, use the start button in the UI or:
curl -X POST http://localhost/api/projects/<project-id>/start
```

**Port forwarding not working**
```bash
# Check subdomain URL format
# Correct: http://projectid-5000.localhost/
# Incorrect: http://localhost/proxy/5000/

# Verify VS Code settings in workspace
docker exec workspace-<project-id> cat /home/coder/.local/share/code-server/User/settings.json

# Check environment variables
docker exec workspace-<project-id> env | grep PROXY
```

**Application URLs returning 404**
```bash
# Ensure your app binds to 0.0.0.0, not 127.0.0.1
# Flask example:
app.run(host='0.0.0.0', port=5000)

# Check nginx configuration
docker-compose logs nginx
```

**Container management issues**
```bash
# Check real-time status
curl http://localhost/api/projects/

# Manually stop problematic container
docker stop workspace-<project-id>

# Restart via API (will auto-detect stopped state)
curl -X POST http://localhost/api/projects/<project-id>/start
```

**Password protection issues**
```bash
# Can't access protected workspace - check authentication
# 1. Verify workspace is running
curl http://localhost/api/projects/<project-id>

# 2. Access workspace URL and enter password when prompted
# URL: http://projectid.localhost/

# 3. If password is forgotten, check project creation logs or recreate workspace
```

**Stop/Delete operations fail with "Invalid password"**
```bash
# 1. Ensure you're using the correct password (case-sensitive)
# 2. Check browser console for 401 errors
# 3. Verify project is password protected (look for lock icon in UI)

# For developers: Check API response
curl -X POST http://localhost/api/projects/<project-id>/stop \
  -H "Content-Type: application/json" \
  -d '{"password":"your-password"}'
```

**Network issues**
```bash
# Recreate network
docker-compose down
docker network prune
docker-compose up
```

### Cleanup

```bash
# Remove all containers and volumes
docker-compose down -v

# Clean up unused Docker resources
docker system prune -a
```

## Current Capabilities & Roadmap

### ✅ **Implemented Features**

- **Multiple AI Tools**: OpenCode SST, Aider, Gemini CLI, Claude Code
- **Professional UI**: VS Code-inspired light theme design
- **Subdomain Port Forwarding**: Clean URLs for application access
- **Passwordless Authentication**: Seamless local development experience
- **Python Flask Templates**: Ready-to-use project scaffolding
- **Container Management**: Real-time status monitoring and control
- **Resource Management**: Automatic cleanup and resource limits

### 🚧 **Current Limitations**

- **Project Templates**: Only Python Flask supported (Node.js in development)
- **User Management**: No multi-user authentication (designed for local use)
- **Storage**: Local storage only (no cloud persistence)
- **Deployment**: Development-focused (production deployment in roadmap)

### 🚀 **Future Enhancements**

- **Multi-language Support**: Node.js, Java, Go, Rust project templates
- **User Authentication**: Multi-user support with authentication system
- **Cloud Integration**: GitHub, GitLab integration for project management
- **Deployment Pipeline**: One-click deployment to cloud platforms
- **Database Persistence**: User projects and settings persistence
- **Team Collaboration**: Shared workspaces and real-time collaboration
- **Custom Domains**: Production deployment with custom domain support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Docker Compose
5. Submit a pull request

## License

This project uses a **Dual License** model - see the [LICENSE](LICENSE) file for details.

### Option 1: MIT License (Free for All Use)
- ✅ **Completely free** for personal, educational, and commercial use
- ✅ No restrictions on modification, distribution, or commercial use
- ✅ Compatible with all open source dependencies
- ✅ Standard MIT License terms apply

### Option 2: Commercial License (Paid)
For organizations that want additional benefits:
- ✅ Commercial support and warranty
- ✅ Priority bug fixes and feature requests
- ✅ Custom development assistance
- ✅ Legal protection and indemnification
- ✅ Service level agreements (SLA)

### Choose Your License
- **Individual/Open Source Projects**: Use **MIT License** (completely free)
- **Enterprise/Organizations**: Consider **Commercial License** for additional support

**Note**: The MIT License allows full commercial use without any fees or restrictions.

## Support

- **User Guide**: See `docs/user-guide.md`
- **API Documentation**: Available at `/api/health` when running
- **Issues**: Report bugs and feature requests via GitHub issues