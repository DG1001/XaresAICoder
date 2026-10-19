# Installation Guide

Complete installation and configuration guide for XaresAICoder.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Installation](#quick-installation)
- [Manual Installation](#manual-installation)
- [Configuration Options](#configuration-options)
- [Environment Templates](#environment-templates)
- [Docker Compose Versions](#docker-compose-versions)
- [Network Setup](#network-setup)
- [Deployment Options](#deployment-options)
- [Verification](#verification)
- [Updates](#updates)

**📚 For detailed port and domain configuration, see [Port Configuration Guide](PORT_CONFIGURATION.md)**

## Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, or Windows (with WSL2)
- **Memory**: 4GB+ RAM available for containers
- **Storage**: 10GB+ free disk space
- **Network**: Internet connection for initial setup

### Required Software

- **Docker** (version 20.10+ recommended)
- **Docker Compose** (v1.27+ or v2.0+)
- **Git** (for cloning the repository)
- **curl** (for health checks)

### Browser Requirements

- **Chrome/Chromium** (recommended) - Full compatibility
- **Firefox** - Compatible (minor workspace creation issues on some Linux environments)
- **Safari** - Basic compatibility
- **Edge** - Compatible

## Quick Installation

### One-Command Setup

```bash
# Clone and deploy in one go
git clone <repository-url>
cd XaresAICoder
./deploy.sh
```

This command automatically:
- ✅ Detects Docker Compose version (v1 or v2)
- ✅ Sets up persistent Docker network with conflict detection
- ✅ Builds custom VS Code image with AI tools
- ✅ Configures environment settings interactively
- ✅ Deploys all services and performs health checks

### Quick Start Options

```bash
# Full deployment (recommended for first-time setup)
./deploy.sh

# Deploy with integrated Git server
./deploy.sh --git-server

# Skip image rebuild (faster for updates)
./deploy.sh --skip-build

# Skip the interactive environment setup (use existing .env; feature flags still apply)
./deploy.sh --skip-env

# Skip network setup (use existing network)
./deploy.sh --skip-network

# Only build the VS Code image
./deploy.sh --build-only

# See all options
./deploy.sh --help
```

## Manual Installation

<details>
<summary>Advanced users: Manual step-by-step installation</summary>

### Step 1: Clone Repository

```bash
git clone <repository-url>
cd XaresAICoder
```

### Step 2: Set Up Docker Network

```bash
./setup-network.sh
```

This creates a persistent Docker network that survives container restarts.

### Step 3: Build Code-Server Image

```bash
cd code-server
docker build -t xares-aicoder-codeserver:latest .
cd ..
```

**Note**: This step takes 5-10 minutes as it installs VS Code extensions and AI tools.

### Step 4: Environment Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit configuration (optional)
nano .env
```

### Step 5: Deploy Services

```bash
# For Docker Compose v2
docker compose up --build -d

# For Docker Compose v1
docker-compose up --build -d
```

### Step 6: Verification

```bash
# Check service status
docker compose ps

# Health check
curl http://localhost/api/health
```

</details>

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_DOMAIN` | localhost | Base domain for accessing the platform |
| `BASE_PORT` | 80 | Port for nginx to listen on |
| `PROTOCOL` | http | Protocol (http/https) |
| `MAX_WORKSPACES_PER_USER` | 5 | Maximum workspaces per user |
| `ENABLE_GIT_SERVER` | false | Enable integrated Forgejo Git server |
| `MAX_CONCURRENT_WORKSPACES` | 3 | Maximum concurrent running workspaces |
| `CPU_PER_WORKSPACE` | 1.0 | CPU cores allocated per workspace |
| `MEMORY_PER_WORKSPACE_MB` | 4096 | RAM in MB per workspace |
| `ENABLE_RESOURCE_LIMITS` | true | Enable resource limit enforcement |

### Git Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GIT_ADMIN_USER` | developer | Git server account used by the platform |
| `GIT_ADMIN_PASSWORD` | admin123! | Password of the admin account (server-side only); `./deploy.sh` replaces the default once with a random password, `--rotate-git-password` sets a new one |
| `GIT_ADMIN_BOOTSTRAP_PASSWORD` | *(falls back to `GIT_ADMIN_PASSWORD`)* | Password used to create the account; kept in sync by `deploy.sh` |
| `GIT_ADMIN_EMAIL` | gitadmin@xaresaicoder.local | Admin email |
| `GIT_SITE_NAME` | XaresAICoder Git Server | Git server site name |

The admin account never reaches a workspace. The API server uses it to give every
workspace its **own** Forgejo user and an access token limited to that user
(`FORGEJO_USER`/`FORGEJO_TOKEN` in the workspace); repositories are private and belong
to the workspace user. The account must therefore be a **Forgejo administrator**.
`GIT_ADMIN_PASSWORD` may also be an access token of that account with the scopes
`write:admin`, `write:user` and `write:repository` (sent via Basic Auth) — then put the
real password into `GIT_ADMIN_BOOTSTRAP_PASSWORD`. Details and the upgrade of existing
workspaces: [SECURITY.md → Git Server](SECURITY.md#git-server-one-forgejo-account-per-workspace).

Keeping the two variables separate matters because `deploy.sh` and `setup-forgejo.sh`
create the Forgejo account with `--password`. If the token were used there, it would
simply *become* the account password — and web login would be possible again. Existing
installations are unaffected: account creation is skipped when the user already exists.

After changing the credential, run `docker compose up -d server` so the platform picks it
up, and rewrite the remotes of existing workspaces — they carry the old credential in
`.git/config`:

```bash
docker exec <workspace> sh -c 'cd /workspace && git remote set-url origin \
  "http://<user>:<token>@forgejo:3000/<owner>/<repo>.git"'
```

### Docker Network Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `NETWORK_NAME` | xares-aicoder-network | Docker network name |
| `NETWORK_SUBNET` | 172.19.0.0/16 | Network subnet (auto-adjusted for conflicts) |

## Environment Templates

### Localhost Development (Default)

```bash
BASE_DOMAIN=localhost
BASE_PORT=80
PROTOCOL=http
ENABLE_GIT_SERVER=false
```

**Access**: http://localhost

### Internal Development Server

```bash
BASE_DOMAIN=ci.infra
BASE_PORT=8000
PROTOCOL=http
ENABLE_GIT_SERVER=true
```

**Access**: http://ci.infra:8000

### Production HTTPS

```bash
BASE_DOMAIN=coder.example.com
BASE_PORT=443
PROTOCOL=https
ENABLE_GIT_SERVER=true
```

**Access**: https://coder.example.com

**Note**: Production HTTPS requires additional reverse proxy configuration with SSL certificates.

## Docker Compose Versions

### Automatic Detection

The deploy script automatically detects your Docker Compose version:

```bash
# Docker Compose v2 (recommended)
docker compose version

# Docker Compose v1 (legacy)
docker-compose --version
```

### Version Compatibility

| Version | Command | Status |
|---------|---------|--------|
| Docker Compose v2 | `docker compose` | ✅ Recommended |
| Docker Compose v1 | `docker-compose` | ✅ Supported |

### Manual Installation

#### Docker Compose v2 (Recommended)

```bash
# Included with Docker Desktop
# Or install Docker Engine with Compose plugin
sudo apt-get update
sudo apt-get install docker-compose-plugin
```

#### Docker Compose v1 (Legacy)

```bash
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## Network Setup

### Automatic Network Configuration

The deployment script automatically:
- Creates persistent Docker network
- Detects subnet conflicts
- Adjusts configuration if needed
- Ensures network survives container restarts

### Network Troubleshooting

#### "Network overlaps with other one" Error

```bash
# Check existing networks
docker network ls
docker network inspect bridge

# Edit network configuration
nano setup-network.sh
# Change: NETWORK_SUBNET="172.19.0.0/16"
# To:     NETWORK_SUBNET="172.21.0.0/16"

# Recreate network
./setup-network.sh
```

#### Manual Network Setup

```bash
# Create network manually
docker network create \
  --driver bridge \
  --subnet=172.19.0.0/16 \
  xares-aicoder-network

# Verify network
docker network inspect xares-aicoder-network
```

## Deployment Options

### Standard Deployment

```bash
./deploy.sh
```

**Includes**: API server, nginx proxy, frontend

### Git Server Deployment

```bash
./deploy.sh --git-server
```

**Includes**: All standard services + Forgejo Git server

### Development Deployment

```bash
./deploy.sh --skip-build --skip-network
```

**Use case**: Quick updates without rebuilding images

### Production Deployment

```bash
# Build images
./deploy.sh --build-only

# Deploy with existing configuration
./deploy.sh --skip-env --skip-network
```

## Verification

### Health Checks

```bash
# API health check
curl http://localhost/api/health

# Expected response:
# {"status":"ok","timestamp":"2024-01-01T12:00:00.000Z"}
```

### Service Status

```bash
# Check all services
docker compose ps

# Expected services:
# - xaresaicoder-nginx (running)
# - xaresaicoder-server (running)
# - xaresaicoder-forgejo (running, if enabled)
```

### Access Verification

1. **Main Platform**: http://localhost
2. **API Health**: http://localhost/api/health
3. **Git Server** (if enabled): http://localhost/git/

### Container Resources

```bash
# Check resource usage
docker stats

# Expected per workspace:
# - CPU: ~0.5-2.0 cores
# - Memory: ~500MB-2GB
# - Network: Normal web traffic
```

## Updates

### Standard Update

```bash
# Pull latest changes
git pull

# Update deployment (keeps existing config)
./deploy.sh --skip-network
```

### Force Rebuild

```bash
# Complete rebuild
git pull
./deploy.sh
```

### Update Code-Server Image Only

```bash
# Rebuild VS Code image with latest tools
./deploy.sh --build-only

# Deploy with new image
docker compose up -d
```

### Environment Updates

```bash
# Update environment configuration
nano .env

# Apply changes
docker compose down
docker compose up -d
```

## Advanced Configuration

### Custom Domain Setup

1. **DNS Configuration**: Point your domain to the server
2. **Environment Setup**:
   ```bash
   BASE_DOMAIN=your-domain.com
   BASE_PORT=80  # or 443 for HTTPS
   PROTOCOL=http  # or https
   ```
3. **SSL Certificates** (for HTTPS):
   - Use external reverse proxy (nginx, Traefik)
   - Configure Let's Encrypt certificates
   - Update `PROTOCOL=https`

### Resource Limits

XaresAICoder supports configurable resource limits to prevent system overload. Configure via `.env` file:

```bash
# Maximum concurrent workspaces
MAX_CONCURRENT_WORKSPACES=3

# CPU cores per workspace
CPU_PER_WORKSPACE=1.0

# Memory in MB per workspace
MEMORY_PER_WORKSPACE_MB=4096

# Enable resource limit enforcement
ENABLE_RESOURCE_LIMITS=true
```

**Configuration Examples**:

**Personal Development** (default):
```bash
MAX_CONCURRENT_WORKSPACES=3
CPU_PER_WORKSPACE=1.0
MEMORY_PER_WORKSPACE_MB=4096
```

**Powerful Workstation**:
```bash
MAX_CONCURRENT_WORKSPACES=10
CPU_PER_WORKSPACE=2.0
MEMORY_PER_WORKSPACE_MB=8192
```

**Shared Server** (conservative):
```bash
MAX_CONCURRENT_WORKSPACES=5
CPU_PER_WORKSPACE=0.5
MEMORY_PER_WORKSPACE_MB=2048
```

**Check Current Limits**:
> The API needs the admin login. Log in once with curl and reuse the cookie:
> `curl -c cookies.txt -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD from .env>"}' http://localhost/api/auth/login`
> (see [API.md → Authentication](API.md#authentication)).

```bash
curl -b cookies.txt http://localhost/api/limits
```

See [README - Resource Limits](../README.md#resource-limits) for detailed information.

### Storage Configuration

```bash
# Custom workspace data location
mkdir -p /path/to/workspace/data
export WORKSPACE_DATA_PATH=/path/to/workspace/data

# Update docker-compose.yml volumes accordingly
```

## Troubleshooting Installation

### Common Issues

#### Docker Permission Denied

```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Or run with sudo
sudo ./deploy.sh
```

#### Port Already in Use

```bash
# Check what's using port 80
sudo netstat -tulpn | grep :80

# Change port in .env
BASE_PORT=8080

# Redeploy
./deploy.sh --skip-build --skip-network
```

#### Image Build Failures

```bash
# Clean Docker cache
docker system prune -a

# Rebuild from scratch
./deploy.sh --build-only
```

#### Network Conflicts

```bash
# List all networks
docker network ls

# Remove conflicting networks
docker network rm conflicting-network

# Recreate XaresAICoder network
./setup-network.sh
```

### Getting Help

1. **Check Logs**: `docker compose logs`
2. **Health Status**: Visit http://localhost/api/health
3. **System Resources**: Run `docker system df`
4. **Complete Reset**:
   ```bash
   docker compose down -v
   docker system prune -f
   ./deploy.sh
   ```

---

[← Back to README](../README.md) | [Next: Architecture →](ARCHITECTURE.md)