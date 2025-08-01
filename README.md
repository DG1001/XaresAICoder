# XaresAICoder

A professional browser-based AI-powered development environment that integrates VS Code (code-server) with multiple AI coding assistants for enhanced productivity.

## Overview

XaresAICoder provides isolated development workspaces running VS Code in the browser, with five integrated AI coding tools for comprehensive development assistance. Each workspace runs in a separate Docker container with resource limits, automatic cleanup, and seamless subdomain-based port forwarding.

## Features

### 🎯 **Core Platform**
- **Professional VS Code Interface** with light theme inspired design
- **Optional Password Protection** for workspace security
- **Subdomain-based Port Forwarding** (e.g., `projectid-5000.localhost`)
- **Isolated Docker Workspaces** with automatic resource management
- **Real-time Container Management** with start/stop controls
- **Dynamic Status Monitoring** showing actual container states

### 🤖 **AI Development Tools**
Pre-configured workspace with recommended AI coding assistants:
- **Continue** - VS Code extension for AI-powered code completion and chat
- **Cline (Claude Dev)** - AI coding assistant with file editing capabilities
- **OpenCode SST** - Multi-model AI assistant for project analysis
- **Aider** - AI pair programming with direct file editing and git integration
- **Gemini CLI** - Google's AI for code generation and debugging
- **Claude Code** - Anthropic's agentic tool for deep codebase understanding

### 🔧 **Development Tools**
- **Integrated Git Server** - Optional self-hosted Forgejo Git server with GitHub Actions compatibility
- **GitHub CLI (gh)** - Complete GitHub integration for repository management
- **Git** - Version control with automatic repository initialization
- **SSH support** - Secure authentication for GitHub and other services

### 🚀 **Development Features**
- **Multiple Project Templates**: Python Flask, Node.js React, Java Spring Boot
- **Automatic Project Initialization** with Git repository setup and complete project scaffolding
- **VS Code Port Forwarding** with automatic browser opening for all frameworks
- **Professional Web Interface** with tabbed navigation and real-time status updates
- **Resource Management** with configurable timeouts and limits

## Quick Start

### Prerequisites

- **Docker** (with Docker Compose v1 or v2)
- **4GB+ RAM** available for containers  
- **Modern web browser** (Chrome/Chromium recommended, Firefox may have minor workspace creation issues on some Linux environments)

### 🚀 One-Command Installation

```bash
# Clone and deploy in one go
git clone <repository-url>
cd XaresAICoder
./deploy.sh
```

**That's it!** The deploy script automatically:
- ✅ Detects Docker Compose version (v1 or v2)
- ✅ Sets up persistent Docker network  
- ✅ Builds custom VS Code image with AI tools
- ✅ Configures environment settings
- ✅ Deploys and health-checks the application

### Manual Installation (Advanced)

<details>
<summary>Click to expand manual setup steps</summary>

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd XaresAICoder
   ```

2. **Set up the Docker network**:
   ```bash
   ./setup-network.sh
   ```

3. **Build and configure**:
   ```bash
   # Build the code-server image
   cd code-server && docker build -t xares-aicoder-codeserver:latest . && cd ..
   
   # Create environment file
   cp .env.example .env
   # Edit .env with your preferences
   
   # Deploy the application  
   docker compose up --build -d
   # OR for legacy Docker Compose v1:
   # docker-compose up --build -d
   ```

</details>

### 🌐 Access Your Platform

After deployment completes, open your browser to:
- **Default**: http://localhost
- **Custom domain**: Your configured domain from the deploy script

### ⚙️ Deployment Options

The deploy script supports various options for different scenarios:

```bash
# Full deployment (recommended for first-time setup)
./deploy.sh

# Deploy with integrated Git server (Forgejo)
./deploy.sh --git-server

# Skip image rebuild (faster for updates)  
./deploy.sh --skip-build

# Skip environment setup (use existing .env)
./deploy.sh --skip-env

# Skip network setup (use existing network)
./deploy.sh --skip-network

# Only build the VS Code image
./deploy.sh --build-only

# See all options
./deploy.sh --help
```

### 🔧 Management Commands

After deployment, use these commands to manage your platform:

```bash
# View logs
docker compose logs        # or docker-compose logs

# Stop services  
docker compose down        # or docker-compose down

# Restart services
docker compose restart     # or docker-compose restart

# Update deployment
git pull && ./deploy.sh --skip-network
```

### First Project

1. Enter a project name
2. Select your preferred project type:
   - **Empty Project**: Clean slate with just README and git initialization
   - **Python Flask**: Full-stack web applications with Flask framework
   - **Node.js React**: Modern web applications with React 18 and Vite
   - **Java Spring Boot**: Enterprise applications with Spring Boot 3.1 and Java 17
3. **Optional**: Check "Password Protect Workspace" for secure access
4. Click "Create Workspace"
5. Wait for the workspace to be created (Java projects may take longer)
6. VS Code will open in a new tab

### GitHub Integration

Connect your workspace to GitHub in seconds:

```bash
# In VS Code Terminal
gh auth login
gh repo create my-project --public
git push -u origin main
```

See [GITHUB_WORKFLOWS.md](GITHUB_WORKFLOWS.md) for detailed GitHub integration guide.

## Architecture

### Services

- **nginx**: Reverse proxy with subdomain routing for applications and Git server
- **server**: Node.js API for project management and container orchestration  
- **code-server containers**: Dynamic VS Code instances with integrated AI tools
- **forgejo** (optional): Self-hosted Git server with GitHub Actions compatibility

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
docker compose up --build
# OR for Docker Compose v1:
# docker-compose up --build

# View logs
docker compose logs -f server
# OR: docker-compose logs -f server

# Stop services
docker compose down
# OR: docker-compose down
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

## 🔧 Troubleshooting

### Common Issues

#### "Network overlaps with other one" during setup
```bash
# Fix: Network subnet conflict
# Edit setup-network.sh and change the subnet
# From: NETWORK_SUBNET="172.19.0.0/16" 
# To:   NETWORK_SUBNET="172.21.0.0/16"  # or another free subnet
```

#### "502 Bad Gateway" when accessing workspace
```bash
# Check if containers are on the same network
docker network inspect xares-aicoder-network

# Restart services to fix network issues
docker compose down && docker compose up -d
```

#### "Cannot restart workspace after coder restart"
```bash
# This should be fixed automatically with the new persistent network
# If issues persist, check network documentation:
cat docs/NETWORK_TROUBLESHOOTING.md
```

#### Docker Compose not found
```bash
# Install Docker Compose v2 (recommended)
# Already included with Docker Desktop

# Or install Docker Compose v1 (legacy)
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### Getting Help

1. **Check logs**: `docker compose logs` or `docker-compose logs`
2. **Network issues**: See `docs/NETWORK_TROUBLESHOOTING.md`
3. **Health check**: Visit `http://localhost/api/health`
4. **Reset everything**: 
   ```bash
   docker compose down
   docker system prune -f
   ./deploy.sh
   ```

## AI Development Tools

XaresAICoder provides a clean VS Code workspace where you can install and use your preferred AI coding assistants. We recommend several popular tools that work well together.

### 🤖 **Recommended AI Extensions**

**Continue** - AI Code Completion & Chat
- Install from VS Code marketplace: `continue.continue`
- Supports multiple AI providers (OpenAI, Anthropic, local models)
- Inline code completion and sidebar chat interface
- Excellent for rapid development and code explanation

**Cline (Claude Dev)** - AI File Editor
- Install from VS Code marketplace: `saoudrizwan.claude-dev`
- Direct file editing with Claude AI
- Multi-file operations and terminal integration
- Great for complex refactoring and feature development

### 🤖 **Command Line AI Tools**

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

### Empty Project

**Clean Development Starting Point**
- Comprehensive README.md with getting started guide
- Multi-language .gitignore with common patterns
- VS Code workspace settings optimized for development
- Port forwarding configuration for common frameworks (3000, 5000, 8000, 8080, 4200)
- VS Code extension recommendations for enhanced productivity
- Git repository initialization with initial commit
- **Perfect for**: Starting from scratch, learning new technologies, custom project structures

### Python Flask

**Complete Flask Development Environment**
- Virtual environment setup with `venv`
- Flask 2.3+ and python-dotenv pre-installed
- Professional welcome application with routing examples
- Requirements.txt with common dependencies
- VS Code Python debugging configuration
- Git repository initialization with initial commit
- **Port**: 5000 (automatically forwarded)

### Node.js React

**Modern React Development Stack**
- Node.js 18+ with npm package management
- React 18 with TypeScript support
- Vite build tool for fast development and HMR
- Professional component structure with routing
- Tailwind CSS for styling
- ESLint and Prettier for code quality
- Git repository initialization with initial commit
- **Port**: 3000 (Vite dev server, automatically forwarded)

### Java Spring Boot

**Enterprise Java Development Environment**
- OpenJDK 17 (LTS) with Maven build system
- Spring Boot 3.1+ with Spring Web starter
- Professional project structure with controller, service, and model layers
- Maven wrapper for consistent builds
- Application properties configuration
- Spring Boot DevTools for hot reloading
- Git repository initialization with initial commit
- **Port**: 8080 (Spring Boot default, automatically forwarded)

### Template Features

**All templates include:**
- 🔧 **Professional project structure** with best practices
- 🎯 **VS Code workspace configuration** optimized for each technology
- 📦 **Package management** setup (pip, npm, maven)
- 🔄 **Git initialization** with meaningful first commit
- 🚀 **Development server** with auto-reload capabilities
- 📝 **Welcome application** demonstrating key concepts
- 🛠️ **Debugging configuration** for VS Code
- 📋 **README files** with getting started instructions

### Adding New Templates

1. Update `code-server/setup-scripts/workspace-init.sh` with new setup function
2. Add project type validation in `server/src/services/workspace.js`
3. Add initialization logic in `server/src/services/docker.js`
4. Update frontend dropdown in `frontend/index.html`
5. Add project type handling in `frontend/app.js`

## Port Forwarding & Application Access

XaresAICoder uses **subdomain-based routing** for seamless application access, eliminating the need for complex path-based URLs.

### How It Works

When you start an application (e.g., Flask on port 5000) in your workspace:

1. **VS Code detects the port** and shows a notification popup
2. **Click "Open in Browser"** to access your app
3. **URL format**: `http://projectid-5000.localhost/`

### Supported Ports

- **Port 5000**: Flask/Python applications  
- **Port 3000**: Node.js/React applications (Vite dev server)
- **Port 8000**: Django applications
- **Port 8080**: Java Spring Boot applications
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
    },
    "3000": {
      "label": "React Development Server",
      "onAutoForward": "openBrowserOnce"
    },
    "8080": {
      "label": "Spring Boot Application",
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

- **AI-Ready Workspace**: Pre-configured VS Code with recommended AI tool installation guides
- **Professional UI**: VS Code-inspired light theme design
- **Subdomain Port Forwarding**: Clean URLs for application access
- **Optional Password Protection**: Secure workspace access when needed
- **Python Flask Templates**: Ready-to-use project scaffolding
- **Container Management**: Real-time status monitoring and control
- **Resource Management**: Automatic cleanup and resource limits

### 🚧 **Current Limitations**

- **User Management**: No multi-user authentication (designed for local use)
- **Storage**: Local storage only (no cloud persistence)
- **Deployment**: Development-focused (production deployment in roadmap)

### 🔗 **Integrated Git Server (Optional)**

XaresAICoder includes an optional self-hosted Git server powered by **Forgejo** for complete on-premise development workflows, eliminating dependencies on external Git providers.

#### **Quick Start with Git Server**

```bash
# Deploy with integrated Git server
./deploy.sh --git-server

# Access your Git server
# Web Interface: http://localhost/git/
# Login: developer / admin123!
```

#### **Why Forgejo?**

| Feature | Forgejo | Benefits |
|---------|---------|----------|
| **GitHub Actions Compatibility** | ✅ Full compatibility | Use existing CI/CD workflows |
| **Self-Hosted** | ✅ Complete ownership | No external dependencies |
| **Community-Driven** | ✅ Nonprofit governance | Faster feature development |
| **Enterprise Features** | ✅ Advanced capabilities | Issue tracking, PR workflows |
| **API Compatible** | ✅ GitHub-compatible API | Easy integration with tools |

#### **Workspace Git Integration**

**Create repositories directly from your workspace:**

```bash
# 🆕 Create New Repository
curl -u developer:admin123! -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"my-project","description":"My new project","private":false}' \
  http://forgejo:3000/api/v1/user/repos

# 🔗 Clone Repository  
git clone http://developer:admin123!@forgejo:3000/developer/my-project.git

# 📂 Add Remote to Existing Project
git remote add origin http://developer:admin123!@forgejo:3000/developer/my-project.git
git push -u origin main
```

**Complete command-line workflow - no web interface needed for basic operations!**

#### **Features**

- **🏢 Complete On-Premise Solution**: No external dependencies on GitHub/GitLab
- **🔄 GitHub Actions Compatible**: Run existing CI/CD workflows with Forgejo Actions  
- **🔐 Integrated Authentication**: Pre-configured admin user (`developer` / `admin123!`)
- **📊 Repository Management**: Issue tracking, pull requests, and code review
- **👥 Team Collaboration**: Multi-user support with role-based permissions
- **🚀 API-First**: Full REST API for automation and integration
- **🌐 Web Interface**: Professional Git management interface at `/git/`

#### **Configuration**

Git server settings are configured in `.env`:

```bash
# Git Server Configuration
ENABLE_GIT_SERVER=true
GIT_ADMIN_USER=developer
GIT_ADMIN_PASSWORD=admin123!
GIT_ADMIN_EMAIL=gitadmin@xaresaicoder.local
GIT_SITE_NAME=XaresAICoder Git Server
```

#### **Architecture**

```yaml
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:9
    profiles: ["git-server"]  # Optional deployment
    environment:
      - FORGEJO__security__INSTALL_LOCK=true
      - FORGEJO__actions__ENABLED=true
    volumes:
      - forgejo_data:/data
    networks:
      - xares-aicoder-network
```

#### **Git Server Management**

```bash
# Enable Git server (in .env)
ENABLE_GIT_SERVER=true

# Deploy with Git server
./deploy.sh --git-server

# Access web interface
open http://localhost/git/

# Check Git server status
curl http://localhost/api/config
```

### 🚀 **Future Enhancements**

- **Additional Languages**: Go, Rust, Python Django, PHP Laravel project templates
- **User Authentication**: Multi-user support with authentication system
- **Integrated Git Server**: Forgejo integration for complete on-premise solution
- **Deployment Pipeline**: One-click deployment to cloud platforms
- **Database Persistence**: User projects and settings persistence
- **Team Collaboration**: Shared workspaces and real-time collaboration
- **Custom Domains**: Production deployment with custom domain support
- **Template Customization**: User-defined project templates and configurations

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