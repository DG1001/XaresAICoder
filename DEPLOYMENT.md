# XaresAICoder Deployment Guide

## Overview

XaresAICoder now supports flexible deployment configurations for different environments:

- **Localhost Development**: `http://localhost` → workspaces at `http://workspaceid.localhost`
- **Custom Domain/Port**: `http://dev.mycompany.internal:8000` → workspaces at `http://workspaceid.dev.mycompany.internal:8000`

## Configuration

### Environment Variables

Set these variables in your `.env` file or environment:

```bash
# Domain and port configuration
BASE_DOMAIN=localhost          # or dev.mycompany.internal, your-domain.com, etc.
BASE_PORT=80                   # or 8000, 3000, etc.
PROTOCOL=http                  # or https (for future SSL support)
```

### Deployment Examples

#### 1. Localhost Development (Default)
```bash
BASE_DOMAIN=localhost
BASE_PORT=80
PROTOCOL=http
```

Access: `http://localhost` → workspaces at `http://workspaceid.localhost`

#### 2. Internal Development Server
```bash
BASE_DOMAIN=dev.mycompany.internal
BASE_PORT=8000
PROTOCOL=http
```

Access: `http://dev.mycompany.internal:8000` → workspaces at `http://workspaceid.dev.mycompany.internal:8000`

#### 3. Production Domain with Custom Port
```bash
BASE_DOMAIN=aicoder.example.com
BASE_PORT=8080
PROTOCOL=https
```

Access: `https://aicoder.example.com:8080` → workspaces at `https://workspaceid.aicoder.example.com:8080`

## Deployment Steps

### Automated Deployment (Recommended)

Use the included deployment script for easy setup:

```bash
# Full deployment with interactive setup
./deploy.sh

# Quick deployment for localhost
./deploy.sh --skip-env

# Only build the code-server image
./deploy.sh --build-only
```

The script will:
1. ✅ Check prerequisites (Docker, Docker Compose)
2. 🔨 Build the custom code-server image with AI tools
3. ⚙️ Help you configure the environment
4. 🚀 Deploy and health-check the application

### Manual Deployment

#### For Internal Development Server

1. **Build code-server image:**
   ```bash
   cd code-server
   docker build -t xares-aicoder-codeserver:latest .
   cd ..
   ```

2. **Copy environment configuration:**
   ```bash
   cp .env.dev.example .env
   # Edit .env to set your actual domain
   ```

3. **Build and start services:**
   ```bash
   docker-compose up --build -d
   ```

4. **Verify deployment:**
   ```bash
   curl http://dev.mycompany.internal:8000/api/health
   ```

#### For localhost development

1. **Build code-server image:**
   ```bash
   cd code-server
   docker build -t xares-aicoder-codeserver:latest .
   cd ..
   ```

2. **Use default environment:**
   ```bash
   # .env already configured for localhost
   ```

3. **Build and start services:**
   ```bash
   docker-compose up --build -d
   ```

4. **Verify deployment:**
   ```bash
   curl http://localhost/api/health
   ```

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
   docker-compose down
   ```

2. **Update environment:**
   ```bash
   # For localhost
   cp .env.localhost .env
   
   # For internal dev server
   cp .env.dev.example .env
   ```

3. **Restart services:**
   ```bash
   docker-compose up --build -d
   ```

## Troubleshooting

### Common Issues

1. **Workspace URLs not accessible:**
   - Check DNS wildcard configuration
   - Verify nginx is listening on correct port
   - Ensure BASE_DOMAIN matches actual domain

2. **Port conflicts:**
   - Change BASE_PORT in .env
   - Update docker-compose port mapping
   - Restart services

3. **Container networking:**
   - Verify Docker network exists
   - Check container names match nginx upstream

### Health Checks

```bash
# API health
curl http://dev.mycompany.internal:8000/api/health

# List projects
curl http://dev.mycompany.internal:8000/api/projects/

# Create test workspace
curl -X POST -H "Content-Type: application/json" \
  -d '{"projectName":"test","projectType":"python-flask"}' \
  http://dev.mycompany.internal:8000/api/projects/create
```