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

#### 3. Production with External SSL Proxy

**Architecture:**
```
Internet → External nginx (SSL:443) → XaresAICoder nginx (HTTP:8080) → Server (HTTP:3000)
          [SSL Termination]           [Subdomain Routing]              [API Backend]
```

**Use Case:** Production deployment with external nginx handling SSL/TLS termination

**XaresAICoder Configuration:**
```bash
BASE_DOMAIN=coder.example.com
BASE_PORT=443           # SSL termination port (for URL generation)
PROTOCOL=https          # External protocol
HOST_PORT=8080          # Internal container port (customize if needed)
```

**External nginx Configuration:**

Add this to your main nginx server configuration:

```nginx
# WebSocket connection upgrade mapping (if not already present)
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# XaresAICoder proxy server
server {
    listen 443 ssl http2;
    server_name coder.example.com *.coder.example.com;

    # SSL certificate configuration
    ssl_certificate /path/to/your/wildcard.crt;
    ssl_certificate_key /path/to/your/wildcard.key;

    # Proxy to XaresAICoder internal nginx
    location / {
        proxy_pass http://127.0.0.1:8080;  # Match HOST_PORT in .env
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port 443;

        # WebSocket support (CRITICAL for VS Code functionality)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # Buffer settings for large file uploads
        client_max_body_size 512M;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name coder.example.com *.coder.example.com;
    return 301 https://$server_name$request_uri;
}
```

**SSL Certificate Requirements:**
- **Wildcard certificate** for `*.coder.example.com`
- Must cover main domain and all subdomains:
  - `coder.example.com` (main application)
  - `{workspace-id}.coder.example.com` (workspace access)
  - `{workspace-id}-{port}.coder.example.com` (application ports)

**Verification:**
```bash
# Test nginx configuration
sudo nginx -t
sudo systemctl reload nginx

# Verify SSL certificate
openssl s_client -connect coder.example.com:443 -servername coder.example.com

# Test main application
curl -I https://coder.example.com

# Test workspace subdomain DNS
nslookup test-workspace.coder.example.com
```

Access: `https://coder.example.com` → workspaces at `https://workspaceid.coder.example.com`

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
- **SSL Termination**: For production, see section "Production with External SSL Proxy" above

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

### SSL Proxy Issues

**WebSocket Connection Failures:**

If VS Code workspaces show connection errors or frequent disconnects:

1. **Verify WebSocket headers** in external nginx configuration
2. **Check browser console** for WebSocket errors (F12 → Console)
3. **Test WebSocket upgrade:**
   ```bash
   curl -I -H "Upgrade: websocket" -H "Connection: upgrade" https://workspace-id.coder.example.com
   # Should return 101 Switching Protocols
   ```
4. **Common fix:** Ensure these nginx settings are present:
   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   proxy_read_timeout 86400;
   ```

**SSL Certificate Problems:**

If subdomains don't load or show certificate warnings:

1. **Verify wildcard coverage:**
   ```bash
   openssl s_client -connect workspace-id.coder.example.com:443 \
     -servername workspace-id.coder.example.com | grep subject
   # Should show *.coder.example.com in certificate
   ```
2. **Check certificate chain:**
   ```bash
   openssl s_client -connect coder.example.com:443 -showcerts
   ```
3. **Ensure certificate includes:**
   - Main domain: `coder.example.com`
   - Wildcard: `*.coder.example.com`

**Port Conflicts with External Proxy:**

If XaresAICoder fails to start:

1. **Check port availability:**
   ```bash
   sudo netstat -tlpn | grep :8080
   # Or: sudo lsof -i :8080
   ```
2. **Change HOST_PORT in .env:**
   ```bash
   HOST_PORT=8081  # or another free port
   ```
3. **Update external nginx proxy_pass:**
   ```nginx
   proxy_pass http://127.0.0.1:8081;  # Match new HOST_PORT
   ```
4. **Restart both services:**
   ```bash
   docker compose down && docker compose up -d
   sudo systemctl reload nginx
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
- **Production SSL**: See "Production with External SSL Proxy" section above for external SSL setup
- **Network Issues**: See `NETWORK_TROUBLESHOOTING.md` for detailed network guidance
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