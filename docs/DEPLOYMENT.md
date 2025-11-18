# XaresAICoder Deployment Guide

## Overview

XaresAICoder supports flexible deployment configurations for different environments with **Docker Compose v1/v2 compatibility** and automatic network management:

- **Localhost Development**: `http://localhost` → workspaces at `http://workspaceid.localhost`
- **Custom Domain/Port**: `http://dev.mycompany.internal:8000` → workspaces at `http://workspaceid.dev.mycompany.internal:8000`
- **Production SSL**: `https://coder.example.com` → workspaces at `https://workspaceid.coder.example.com`

## 🚀 Quick Start

The **simplest deployment** uses the automated script:

```bash
git clone <repository-url>
cd XaresAICoder
./deploy.sh
```

**That's it!** The script handles:
- ✅ Docker Compose version detection (v1 or v2)
- ✅ Persistent Docker network setup
- ✅ Custom code-server image building  
- ✅ Environment configuration
- ✅ Service deployment and health checks

## Configuration

### Environment Variables

The deploy script helps configure these, or set manually in your `.env` file:

```bash
# Domain and port configuration  
BASE_DOMAIN=localhost          # or dev.mycompany.internal, your-domain.com, etc.
BASE_PORT=80                   # Internal nginx port (80 for HTTP, 443 for HTTPS)
PROTOCOL=http                  # or https for SSL deployments
HOST_PORT=80                   # Host port Docker exposes (configurable for production)

# Network configuration (managed automatically)
DOCKER_NETWORK=xares-aicoder-network
```

**Key Changes in v2:**
- **HOST_PORT**: Separates Docker host port from internal routing port
- **Persistent Network**: `xares-aicoder-network` survives container restarts
- **Auto-Recovery**: Workspace containers automatically reconnect after coder restarts

### Deployment Examples

#### 1. Localhost Development (Default)
```bash
BASE_DOMAIN=localhost
BASE_PORT=80
PROTOCOL=http
HOST_PORT=80
```

Access: `http://localhost` → workspaces at `http://workspaceid.localhost`

#### 2. Internal Development Server
```bash
BASE_DOMAIN=dev.mycompany.internal
BASE_PORT=8000
PROTOCOL=http
HOST_PORT=8000
```

Access: `http://dev.mycompany.internal:8000` → workspaces at `http://workspaceid.dev.mycompany.internal:8000`

#### 3. Production with External SSL Proxy (sensem.de example)
```bash
BASE_DOMAIN=coder.sensem.de
BASE_PORT=443           # SSL termination port
PROTOCOL=https
HOST_PORT=8080          # Internal container port (avoids conflicts)
```

Access: `https://coder.sensem.de` → workspaces at `https://workspaceid.coder.sensem.de`
(External nginx handles SSL and proxies to `localhost:8080`)

#### 4. Production Domain with Custom Port
```bash
BASE_DOMAIN=aicoder.example.com
BASE_PORT=8080
PROTOCOL=https
HOST_PORT=8080
```

Access: `https://aicoder.example.com:8080` → workspaces at `https://workspaceid.aicoder.example.com:8080`

## Deployment Steps

### Automated Deployment (Recommended)

Use the enhanced deployment script for any environment:

```bash
# Full deployment with interactive setup
./deploy.sh

# Quick deployment with existing config  
./deploy.sh --skip-env --skip-network

# Skip image rebuild (faster updates)
./deploy.sh --skip-build

# Only build the code-server image
./deploy.sh --build-only

# See all options
./deploy.sh --help
```

**The script automatically:**
1. ✅ **Detects Docker Compose** version (v1 or v2) and uses appropriate commands
2. ✅ **Sets up persistent network** (`xares-aicoder-network`) that survives restarts
3. ✅ **Builds custom VS Code image** with integrated AI tools
4. ✅ **Configures environment** with interactive prompts
5. ✅ **Deploys services** with health checks
6. ✅ **Provides management commands** for ongoing operations

### Manual Deployment

**Important**: Manual deployment requires network setup first!

#### Prerequisites
```bash
# 1. Setup persistent network (REQUIRED)
./setup-network.sh

# 2. Build code-server image
cd code-server
docker build -t xares-aicoder-codeserver:latest .
cd ..
```

#### For Any Environment

1. **Configure environment:**
   ```bash
   # Use existing template or create custom
   cp .env.example .env
   # Edit .env to set your domain, ports, etc.
   ```

2. **Deploy services:**
   ```bash
   # Docker Compose v2 (preferred)
   docker compose up --build -d
   
   # OR Docker Compose v1 (legacy)  
   docker-compose up --build -d
   ```

3. **Verify deployment:**
   ```bash
   # Replace with your configured domain:port
   curl http://localhost/api/health
   curl http://dev.mycompany.internal:8000/api/health
   ```

#### Important Network Considerations

- **Persistent Network**: `xares-aicoder-network` must exist before starting
- **Port Conflicts**: Use `HOST_PORT` to avoid conflicts on production servers
- **SSL Termination**: For production, use external SSL proxy (see `docs/DEPLOYMENT_SENSEM.md`)

## DNS Configuration

For custom domains, ensure:

1. **Main domain resolves**: `dev.mycompany.internal` → your server IP
2. **Wildcard subdomains**: `*.dev.mycompany.internal` → your server IP (for workspace access)

Example DNS records:
```
dev.mycompany.internal.          A     192.168.1.100
*.dev.mycompany.internal.        A     192.168.1.100
```

## Port Considerations

- **Port 80**: Default HTTP port, no port number needed in URLs
- **Custom ports**: Must be specified in URLs (`http://domain:8000`)
- **Firewall**: Ensure the configured port is open on your server

## Switching Configurations

To switch between environments:

1. **Stop services:**
   ```bash
   docker compose down
   # OR: docker-compose down
   ```

2. **Update environment:**
   ```bash
   # For localhost
   cp .env.example .env
   
   # For internal dev server  
   cp .env.production .env  # then edit domain/ports
   
   # Or use deploy script
   ./deploy.sh --skip-build --skip-network
   ```

3. **Restart services:**
   ```bash
   docker compose up --build -d
   # OR: docker-compose up --build -d
   ```

## 🔧 Troubleshooting

### Network Issues (New in v2)

1. **"Network overlaps with other one" during setup:**
   ```bash
   # Edit setup-network.sh to use different subnet
   # Change: NETWORK_SUBNET="172.19.0.0/16"
   # To:     NETWORK_SUBNET="172.21.0.0/16"
   ./setup-network.sh
   ```

2. **"Cannot restart workspace after coder restart":**
   ```bash
   # This is automatically fixed with persistent network
   # If issues persist:
   docker network inspect xares-aicoder-network
   ./deploy.sh --skip-build --skip-env  # Will recreate network if needed
   ```

3. **502 Bad Gateway when accessing workspace:**
   ```bash
   # Check container network connectivity
   docker network inspect xares-aicoder-network
   docker compose restart
   ```

### Common Issues

1. **Workspace URLs not accessible:**
   - Check DNS wildcard configuration (`*.domain.com`)
   - Verify nginx is listening on correct port
   - Ensure BASE_DOMAIN matches actual domain

2. **Port conflicts on production:**
   - Change `HOST_PORT` in .env (not BASE_PORT)
   - Example: `HOST_PORT=8080` while keeping `BASE_PORT=443`
   - Restart services after change

3. **Docker Compose version issues:**
   ```bash
   # Check available versions
   docker compose version   # v2
   docker-compose version   # v1
   
   # Deploy script auto-detects, but manual deployment:
   # Use: docker compose (preferred)
   # Or:  docker-compose (legacy)
   ```

### Health Checks

```bash
# API health (replace with your domain:port)
curl http://localhost/api/health
curl http://dev.mycompany.internal:8000/api/health
curl https://coder.sensem.de/api/health

# List projects
curl http://localhost/api/projects/

# Create test workspace
curl -X POST -H "Content-Type: application/json" \
  -d '{"projectName":"test","projectType":"python-flask"}' \
  http://localhost/api/projects/create

# Network health check
docker network inspect xares-aicoder-network
docker network ls | grep xares-aicoder

# Container status
docker compose ps
# OR: docker-compose ps
```

## 📚 Additional Resources

- **Quick Setup**: See `README.md` for streamlined installation
- **Production SSL**: See `docs/DEPLOYMENT_SENSEM.md` for external SSL proxy setup
- **Network Issues**: See `docs/NETWORK_TROUBLESHOOTING.md` for detailed network guidance
- **Credential Management**: See `CREDENTIAL_MANAGEMENT.md` for Git and AI tool integration

## 🚀 Management Commands

After deployment, use these commands:

```bash
# View logs
docker compose logs        # or docker-compose logs
docker compose logs server # specific service

# Restart services
docker compose restart     # or docker-compose restart

# Update deployment  
git pull
./deploy.sh --skip-network  # preserves existing network

# Complete reset
docker compose down
docker system prune -f
./deploy.sh
```