# XaresAICoder

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/DG1001/XaresAICoder)

A professional browser-based AI-powered development environment that integrates VS Code (code-server) with multiple AI coding assistants for enhanced productivity.

## Overview

https://github.com/user-attachments/assets/127a1253-5df2-4a5e-937d-a25840439ccd

XaresAICoder provides isolated development workspaces running VS Code in the browser, with integrated AI coding tools for comprehensive development assistance. Each workspace runs in a separate Docker container with resource limits, automatic cleanup, and seamless subdomain-based port forwarding.

## ✨ Key Features

### 🎯 **Professional Development Environment**
- **VS Code in Browser** with light theme inspired design
- **Isolated Docker Workspaces** with automatic resource management
- **Configurable Memory Allocation** - Choose 1GB, 2GB, or 4GB RAM per workspace
- **Subdomain Port Forwarding** (e.g., `projectid-5000.localhost`)
- **Real-time Container Management** with start/stop controls
- **Optional Password Protection** for workspace security

### 🤖 **AI Development Tools**
Pre-configured workspace with recommended AI coding assistants:
- **Continue** - VS Code extension for AI-powered code completion and chat
- **Cline (Claude Dev)** - AI coding assistant with file editing capabilities
- **OpenCode SST** - Multi-model AI assistant for project analysis
- **Aider** - AI pair programming with direct file editing and git integration
- **Gemini CLI** - Google's AI for code generation and debugging
- **Claude Code** - Anthropic's agentic tool for deep codebase understanding

### 🔧 **Development Ready**
- **Multiple Project Templates**: Python Flask, Node.js React, Java Spring Boot, Empty Project
- **Integrated Git Server** (optional) - Self-hosted Forgejo with GitHub Actions compatibility
- **Automatic Git Repository Creation** - One-click Git repo setup with workspace configuration
- **GitHub Integration** - Pre-installed GitHub CLI for seamless workflow

## 🚀 Quick Start

### Prerequisites

- **Docker** (with Docker Compose v1 or v2)
- **4GB+ RAM** available for containers  
- **Modern web browser** (Chrome/Chromium recommended)

### One-Command Installation

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

### Access Your Platform

After deployment completes, open your browser to:
- **Default**: http://localhost
- **Custom domain**: Your configured domain from the deploy script

### Create Your First Project

1. Enter a project name
2. Select your preferred project type:
   - **Empty Project**: Clean slate with just README and git initialization
   - **Python Flask**: Full-stack web applications with Flask framework
   - **Node.js React**: Modern web applications with React 18 and Vite
   - **Java Spring Boot**: Enterprise applications with Spring Boot 3.1
3. Choose memory allocation (1GB, 2GB default, or 4GB RAM)
4. **Optional**: Check "Password Protect Workspace" for secure access
5. **Optional**: Check "Create Git Repository" to automatically set up Git
6. Click "Create Workspace"
7. VS Code opens in a new tab - start coding with AI assistance!

### AI Tools Setup

Once in your workspace, run this command to see setup instructions for all AI tools:
```bash
setup_ai_tools
```

## 📚 Documentation

For detailed information, see our comprehensive documentation:

- **[Installation Guide](docs/INSTALLATION.md)** - Complete installation options and configuration
- **[Architecture Overview](docs/ARCHITECTURE.md)** - Technical architecture and components  
- **[Project Templates](docs/PROJECT_TEMPLATES.md)** - Detailed template information and customization
- **[AI Development Tools](docs/AI_TOOLS.md)** - Complete guide to integrated AI assistants
- **[API Reference](docs/API.md)** - API endpoints and usage examples
- **[Security Features](docs/SECURITY.md)** - Security features and best practices
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Development Guide](docs/DEVELOPMENT.md)** - Contributing and development setup

## 🔧 Deployment Options

```bash
# Full deployment (recommended for first-time setup)
./deploy.sh

# Deploy with integrated Git server (Forgejo)
./deploy.sh --git-server

# Skip image rebuild (faster for updates)  
./deploy.sh --skip-build

# See all options
./deploy.sh --help
```

## 🐳 Management Commands

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

## 🌐 Port Forwarding & Application Access

XaresAICoder uses **subdomain-based routing** for seamless application access:

- **Flask/Python**: `http://projectid-5000.localhost/`
- **React/Node.js**: `http://projectid-3000.localhost/`  
- **Spring Boot**: `http://projectid-8080.localhost/`

VS Code automatically detects ports and provides one-click browser access.

## 🔐 Security

- **Optional Password Protection**: Secure individual workspaces with passwords
- **Container Isolation**: Each workspace runs in isolated Docker containers
- **Resource Limits**: CPU and memory limits prevent resource exhaustion
- **Network Isolation**: Workspaces can't access each other

## 🗂️ Integrated Git Server (Optional)

Deploy with self-hosted Git server for complete on-premise development:

```bash
# Deploy with Git server
./deploy.sh --git-server

# Access Git web interface
# http://localhost/git/
# Login: developer / admin123!
```

Features:
- **GitHub Actions Compatible** - Run existing CI/CD workflows
- **Automatic Repository Creation** - One-click Git integration during workspace creation
- **Complete On-Premise Solution** - No external dependencies

## 🚧 Current Status

### ✅ **Production Ready**
- Professional VS Code interface with AI tools
- Multiple project templates with best practices
- Container management with real-time monitoring
- Optional password protection and Git integration

### 🔮 **Future Enhancements**
- Multi-user authentication system
- Additional language templates (Go, Rust, PHP)
- Cloud deployment pipeline
- Team collaboration features

## 🤝 Contributing

We welcome contributions! See our [Development Guide](docs/DEVELOPMENT.md) for details on:
- Setting up development environment
- Code contribution guidelines  
- Architecture overview for developers

## 📄 License

This project is licensed under the **MIT License**.

- ✅ **Completely free** for personal, educational, and commercial use
- ✅ No restrictions on modification or distribution
- ✅ Open source and permissive licensing

See the [LICENSE](LICENSE) file for full details.

## 🆘 Support

- **Quick Help**: Check [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
- **User Guide**: See [complete documentation](docs/)
- **Issues**: Report bugs via GitHub issues
- **API Health**: http://localhost/api/health (when running)

---

**🚀 Ready to enhance your development workflow with AI? Run `./deploy.sh` and start coding!**