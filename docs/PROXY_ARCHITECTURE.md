# XaresAICoder Proxy Architecture

This document describes the technical details of XaresAICoder's proxy architecture, specifically designed for AI coding agents working inside workspaces. Understanding this architecture is critical for properly configuring client/server applications to work with the platform's subdomain-based routing system.

## Table of Contents

- [Overview](#overview)
- [NGINX Proxy Configuration](#nginx-proxy-configuration)
- [URL Generation and Environment Variables](#url-generation-and-environment-variables)
- [Docker Networking](#docker-networking)
- [Critical: How Applications Must Bind](#critical-how-applications-must-bind)
- [Accessing Applications Through the Proxy](#accessing-applications-through-the-proxy)
- [Port Forwarding Configuration](#port-forwarding-configuration)
- [Frontend/Backend API Communication](#frontendbackend-api-communication)
- [Git Server Integration](#git-server-integration)
- [Troubleshooting Guide](#troubleshooting-guide)
- [Quick Reference for AI Agents](#quick-reference-for-ai-agents)

## Overview

XaresAICoder uses a **subdomain-based reverse proxy architecture** where:

- **Main domain** serves the frontend and API
- **Workspace subdomains** (`<projectId>.<domain>`) access VS Code interfaces
- **Application port subdomains** (`<projectId>-<port>.<domain>`) access applications running inside workspaces

All routing is handled by a central nginx reverse proxy that routes requests to the appropriate Docker containers based on the subdomain pattern.

## NGINX Proxy Configuration

**File**: `build/nginx.conf.template`

### Subdomain Routing Patterns

XaresAICoder uses three distinct server blocks in nginx:

#### 1. Main Server (Frontend + API)

**Pattern**: `${BASE_DOMAIN}` (e.g., `localhost`, `ci.infra:8000`, `coder.example.com`)

**Routes**:
- `/` → Frontend (static files from `/usr/share/nginx/html/frontend`)
- `/api/` → Backend API (proxied to `server:3000`)
- `/git/` → Forgejo Git server (proxied to `forgejo:3000`, if enabled)

#### 2. Workspace Application Ports (MUST come BEFORE general workspace pattern)

**Pattern**: `<projectId>-<port>.<domain>` (e.g., `abc123-5000.localhost`)

**Target**: `http://workspace-<projectId>:<port>`

**Purpose**: Access applications running inside workspace containers on specific ports

**Examples**:
- Flask app on port 5000: `http://abc123-5000.localhost/`
- Node.js app on port 3000: `http://abc123-3000.localhost/`
- Spring Boot on port 8080: `http://abc123-8080.ci.infra:8000/`

#### 3. Workspace Code-Server (VS Code Interface)

**Pattern**: `<projectId>.<domain>` (e.g., `abc123.localhost`)

**Target**: `http://workspace-<projectId>:8082`

**Purpose**: Access the VS Code interface for the workspace

### Proxy Headers

All proxied requests include these headers for proper forwarding:

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Forwarded-Port $server_port;
```

### WebSocket Support

All routes have full WebSocket support enabled via:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_read_timeout 86400;
proxy_send_timeout 86400;
```

This enables real-time features like hot reload for React/Vue development servers.

## URL Generation and Environment Variables

**Files**: `.env`, `server/src/services/docker.js`

### Configuration Variables

| Variable | Purpose | Example Values |
|----------|---------|----------------|
| `BASE_DOMAIN` | Base domain for all services | `localhost`, `ci.infra`, `coder.example.com` |
| `BASE_PORT` | Logical port for URL generation | `80`, `8000`, `443` |
| `PROTOCOL` | Protocol for workspace URLs | `http`, `https` |
| `HOST_PORT` | Physical Docker host port mapping | `80`, `8000`, `7200` |

### URL Generation Logic

**Code reference**: `server/src/services/docker.js:11-13`, `server/src/services/docker.js:34-35`

```javascript
// Configuration
this.baseDomain = process.env.BASE_DOMAIN || 'localhost';
this.basePort = process.env.BASE_PORT || '80';
this.protocol = process.env.PROTOCOL || 'http';

// Workspace URL construction
workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`

// Application port proxy URL (passed to containers via VSCODE_PROXY_URI)
VSCODE_PROXY_URI: `${this.protocol}://${projectId}-{{port}}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`
```

### Port Suffix Rules

- **No port suffix**: If `BASE_PORT=80` with `PROTOCOL=http` OR `BASE_PORT=443` with `PROTOCOL=https`
- **Include `:${BASE_PORT}`**: In all other cases

**Examples**:
- `BASE_DOMAIN=localhost`, `BASE_PORT=80` → `http://abc123.localhost/`
- `BASE_DOMAIN=ci.infra`, `BASE_PORT=8000` → `http://abc123.ci.infra:8000/`
- `BASE_DOMAIN=coder.example.com`, `BASE_PORT=443`, `PROTOCOL=https` → `https://abc123.coder.example.com/`

## Docker Networking

**Files**: `docker-compose.yml`, `server/src/services/docker.js`

### Network Configuration

- **Network Name**: `xares-aicoder-network` (external persistent network)
- **Network Type**: Bridge network (must be created before deployment)
- **DNS Resolver**: `127.0.0.11` (Docker's internal DNS)

All containers (nginx, server, workspace containers) are connected to the same Docker network:

```yaml
networks:
  xares-aicoder-network:
    external: true
```

### Container Naming and DNS Resolution

**Workspace container naming convention**:
- **Container name**: `workspace-<projectId>`
- **Network alias**: `workspace-<projectId>`
- **Hostname resolution**: `workspace-<projectId>` resolves to container IP within the Docker network

This allows nginx to proxy requests to containers by name, e.g., `http://workspace-abc123:5000`.

### Exposed Ports

**Code reference**: `server/src/services/docker.js:102-111`

Each workspace container exposes these ports:

```javascript
ExposedPorts: {
  '8082/tcp': {}, // code-server (VS Code)
  '3000/tcp': {}, // Node.js apps
  '5000/tcp': {}, // Flask/Python apps
  '8000/tcp': {}, // Django/other Python apps
  '8080/tcp': {}, // Spring Boot apps
  '4200/tcp': {}, // Angular
  '3001/tcp': {}, // React dev server alt
  '9000/tcp': {}  // Various apps
}
```

**Important**: These are Docker `EXPOSE` declarations, NOT host port mappings. Applications are accessed via nginx subdomain routing, not direct port mapping.

## Critical: How Applications Must Bind

### The 0.0.0.0 Rule

**CRITICAL FOR AI AGENTS**: Applications inside workspaces MUST bind to `0.0.0.0` (all interfaces), NOT `localhost` or `127.0.0.1`.

**Why**: Docker networking requires applications to bind to all interfaces to be accessible from the nginx proxy container. Binding to `localhost` makes the application only accessible within the container itself, breaking proxy access.

### Code Examples

#### Python (Flask)

```python
# ✅ CORRECT - Accessible through proxy
from flask import Flask
app = Flask(__name__)

@app.route('/')
def hello():
    return 'Hello from XaresAICoder!'

if __name__ == '__main__':
    # CRITICAL: host='0.0.0.0' makes it accessible through proxy
    app.run(host='0.0.0.0', port=5000, debug=True)
```

```python
# ❌ INCORRECT - Not accessible from proxy
if __name__ == '__main__':
    app.run(port=5000)  # Defaults to localhost/127.0.0.1
```

#### Python (FastAPI/Uvicorn)

```python
# ✅ CORRECT
import uvicorn
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello from XaresAICoder"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

```python
# ❌ INCORRECT
if __name__ == "__main__":
    uvicorn.run(app, port=8000)  # Defaults to localhost
```

#### Node.js (Express)

```javascript
// ✅ CORRECT - Accessible through proxy
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello from XaresAICoder!');
});

// CRITICAL: Second parameter '0.0.0.0' makes it accessible through proxy
app.listen(3000, '0.0.0.0', () => {
  console.log('Server running on port 3000');
});
```

```javascript
// ❌ INCORRECT - May not be accessible from proxy
app.listen(3000);  // Might default to localhost on some systems
```

#### Node.js (HTTP Server)

```javascript
// ✅ CORRECT
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello from XaresAICoder!');
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Server running on port 3000');
});
```

#### Java (Spring Boot)

```properties
# application.properties
# ✅ CORRECT - Accessible through proxy
server.address=0.0.0.0
server.port=8080
```

```properties
# ❌ INCORRECT - Not accessible from proxy
server.address=localhost
server.port=8080
```

#### React Development Server

```json
// package.json
{
  "scripts": {
    "start": "HOST=0.0.0.0 PORT=3000 react-scripts start"
  }
}
```

Or via `.env` file in React project:

```bash
# .env
HOST=0.0.0.0
PORT=3000
```

#### Vue Development Server

```javascript
// vue.config.js
module.exports = {
  devServer: {
    host: '0.0.0.0',
    port: 8080
  }
}
```

### Verification

To verify your application is bound correctly:

```bash
# Inside workspace container
netstat -tuln | grep <port>

# Should show: 0.0.0.0:<port>
# NOT: 127.0.0.1:<port>
```

## Accessing Applications Through the Proxy

### URL Pattern

Once an application is running on `0.0.0.0:<port>` inside a workspace:

**Format**: `http://<projectId>-<port>.<baseDomain>:<basePort (if not 80/443)>/`

### Examples by Deployment Type

#### Localhost Deployment
**Configuration**: `BASE_DOMAIN=localhost`, `BASE_PORT=80`, `PROTOCOL=http`

- Flask (port 5000): `http://abc123-5000.localhost/`
- Node.js (port 3000): `http://abc123-3000.localhost/`
- Spring Boot (port 8080): `http://abc123-8080.localhost/`
- React dev (port 3000): `http://abc123-3000.localhost/`

#### CI Server Deployment
**Configuration**: `BASE_DOMAIN=ci.infra`, `BASE_PORT=8000`, `PROTOCOL=http`

- Flask (port 5000): `http://abc123-5000.ci.infra:8000/`
- Node.js (port 3000): `http://abc123-3000.ci.infra:8000/`
- Spring Boot (port 8080): `http://abc123-8080.ci.infra:8000/`

#### Production Deployment
**Configuration**: `BASE_DOMAIN=coder.example.com`, `BASE_PORT=443`, `PROTOCOL=https`

- Flask (port 5000): `https://abc123-5000.coder.example.com/`
- Node.js (port 3000): `https://abc123-3000.coder.example.com/`

### Finding Your Project ID

Inside a workspace container:

```bash
# Project ID is available in environment variable
echo $PROJECT_ID

# Or extract from hostname
hostname  # Returns workspace-<projectId>
```

### Constructing URLs Programmatically

Environment variables available in workspace containers:

```bash
PROJECT_ID=abc123
VSCODE_PROXY_URI=http://abc123-{{port}}.localhost/
PROXY_DOMAIN=abc123.localhost
```

**Example usage in code**:

```python
import os

project_id = os.environ.get('PROJECT_ID')
port = 5000

# Construct application URL
app_url = f"http://{project_id}-{port}.localhost/"
print(f"Application accessible at: {app_url}")
```

## Port Forwarding Configuration

**File**: `code-server/setup-scripts/workspace-init.sh:7-36`

VS Code is pre-configured with automatic port forwarding:

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
    "8000": {
      "label": "Django Application",
      "onAutoForward": "openBrowserOnce"
    },
    "8080": {
      "label": "Spring Boot Application",
      "onAutoForward": "openBrowserOnce"
    },
    "4200": {
      "label": "Angular Development Server",
      "onAutoForward": "openBrowserOnce"
    },
    "3001": {
      "label": "Node.js Application",
      "onAutoForward": "openBrowserOnce"
    },
    "9000": {
      "label": "Application Server",
      "onAutoForward": "openBrowserOnce"
    }
  }
}
```

**Behavior**: When you start a server on one of these ports, VS Code will:
1. Automatically detect the server
2. Show a notification
3. Open a browser tab with the correct subdomain URL (`http://<projectId>-<port>.<domain>/`)

## Frontend/Backend API Communication

**File**: `frontend/app.js`

### API Base Detection

The XaresAICoder frontend uses relative paths for API calls:

```javascript
detectApiBase() {
    // For same-origin requests, use relative paths
    // This works for both localhost and ci.infra:8000 deployments
    return '/api';
}
```

**Key Point**: Frontend uses relative path `/api`, which nginx proxies to the backend server container (`server:3000`).

### API Endpoints

All API endpoints are prefixed with `/api`:

```javascript
// Configuration
GET /api/config     // Get BASE_DOMAIN, BASE_PORT, PROTOCOL
GET /api/limits     // Get resource limits

// Project Management
POST /api/projects/create
GET /api/projects/
GET /api/projects/${projectId}
DELETE /api/projects/${projectId}
POST /api/projects/${projectId}/start
POST /api/projects/${projectId}/stop

// Metadata
GET /api/projects/${projectId}/disk-usage
GET /api/projects/${projectId}/notes
PUT /api/projects/${projectId}/notes
PUT /api/projects/${projectId}/group
GET /api/projects/groups
```

### For Workspaces Making API Calls

If you're building an application inside a workspace that needs to call the XaresAICoder API:

```javascript
// ✅ CORRECT - Use the base domain with /api path
const API_BASE = `http://${process.env.BASE_DOMAIN || 'localhost'}/api`;

fetch(`${API_BASE}/projects/${projectId}`)
  .then(response => response.json())
  .then(data => console.log(data));
```

```javascript
// ❌ INCORRECT - Don't use localhost:3000 directly
const API_BASE = 'http://localhost:3000/api';  // Won't work from browser
```

## Git Server Integration

**Files**: `server/src/services/docker.js:54-66`, `code-server/setup-scripts/workspace-init.sh:265-456`

When `ENABLE_GIT_SERVER=true` in `.env`, XaresAICoder includes an integrated Forgejo Git server.

### Environment Variables in Containers

```javascript
GIT_SERVER_ENABLED=true
GIT_SERVER_URL=http://forgejo:3000  // Internal Docker URL
GIT_SERVER_EXTERNAL_URL=http://localhost/git  // External browser URL
GIT_ADMIN_USER=gitadmin
GIT_ADMIN_PASSWORD=<configured_password>
```

### Git Operations

Git server is accessible at `/git` path on the main domain:

- **Web UI**: `http://localhost/git` (or `http://ci.infra:8000/git`)
- **Clone URLs**: `http://localhost/git/username/repo.git`

### Authentication with HTTP Basic Auth Proxy

When Forgejo is behind HTTP Basic Auth (common in production), you need **dual authentication** (proxy auth + git credentials).

**Solution: Use `.netrc` file**:

```bash
# Inside workspace container
cat > ~/.netrc << 'EOF'
machine your-domain.com
login git_username
password git_token_or_password
EOF

chmod 600 ~/.netrc

# Git operations now work seamlessly
git clone https://your-domain.com/git/user/repo.git
git push origin main
```

**Alternative: Embed credentials in URL**:

```bash
git clone https://git_token@your-domain.com/git/user/repo.git
```

## Troubleshooting Guide

### "Connection Refused" Errors

**Symptom**: Application running but not accessible through proxy subdomain

**Causes**:
1. Application bound to `localhost` instead of `0.0.0.0`
2. Application not started
3. Wrong port number

**Solution**:

```bash
# 1. Check if application is running and on correct port
ps aux | grep <app_name>

# 2. Verify listening address
netstat -tuln | grep <port>
# Should show: 0.0.0.0:<port>
# NOT: 127.0.0.1:<port>

# 3. Test local connection inside container
curl http://localhost:<port>

# 4. Check application logs
# Look for bind address in startup logs
```

**Fix**: Restart application with `host='0.0.0.0'` binding.

### "502 Bad Gateway" Errors

**Symptom**: Nginx returns 502 when accessing subdomain

**Causes**:
1. Application crashed or exited
2. Application not yet started
3. Application bound to wrong interface
4. Container networking issue

**Debugging**:

```bash
# 1. Verify application is running
ps aux | grep <app_name>

# 2. Check application logs
tail -f <log_file>

# 3. Test from another container (nginx perspective)
docker exec <nginx-container> curl http://workspace-<projectId>:<port>

# 4. Verify container is on correct network
docker inspect workspace-<projectId> | grep -A 10 Networks
```

### Application Starts but Shows Wrong Content

**Symptom**: Accessing `http://abc123-5000.localhost/` shows different content than expected

**Causes**:
1. Multiple applications running on same port
2. Old process still running
3. Wrong application directory

**Solution**:

```bash
# 1. Kill all processes on the port
lsof -ti:<port> | xargs kill -9

# 2. Verify port is free
netstat -tuln | grep <port>

# 3. Restart application
python app.py  # or appropriate command
```

### URL Not Opening from VS Code

**Symptom**: VS Code detects port but URL doesn't open or shows error

**Causes**:
1. Port forwarding configuration incorrect
2. Application not bound to `0.0.0.0`
3. Browser blocking pop-ups

**Solution**:

```bash
# 1. Manually construct and test URL
PROJECT_ID=$(echo $PROJECT_ID)
BASE_DOMAIN="localhost"  # or ci.infra, etc.
PORT=5000

# Test URL
echo "Try: http://${PROJECT_ID}-${PORT}.${BASE_DOMAIN}/"

# 2. Test with curl
curl http://${PROJECT_ID}-${PORT}.${BASE_DOMAIN}/

# 3. Check VS Code port forwarding settings
# Settings → Remote → Ports Attributes
```

### Finding Container and Project Information

```bash
# Inside workspace
echo $PROJECT_ID
echo $VSCODE_PROXY_URI
echo $PROXY_DOMAIN
hostname

# From host machine
docker ps | grep workspace
docker inspect workspace-<projectId>
curl http://localhost/api/projects/<projectId>
```

## Quick Reference for AI Agents

### Key Takeaways

1. **Always bind to `0.0.0.0`**, never `localhost` or `127.0.0.1`
2. **URL pattern**: `http://<PROJECT_ID>-<PORT>.<BASE_DOMAIN>:<BASE_PORT if not 80/443>/`
3. **VS Code auto-detects** common ports and opens browser tabs automatically
4. **Common ports**: 3000 (Node), 5000 (Flask), 8000 (Django/FastAPI), 8080 (Spring Boot)
5. **Project ID**: Available in `$PROJECT_ID` environment variable
6. **API calls**: Frontend makes API calls to `/api` (proxied by nginx)
7. **Git server**: Available at `/git` path (proxied by nginx, if enabled)

### Checklist for Starting Applications

- [ ] Application binds to `0.0.0.0` (check your framework's binding parameter)
- [ ] Application uses a standard port (3000, 5000, 8000, 8080, etc.)
- [ ] Application is running (check with `ps aux` or logs)
- [ ] Port is listening on `0.0.0.0` (check with `netstat -tuln | grep <port>`)
- [ ] Can access locally inside container (`curl http://localhost:<port>`)
- [ ] Construct URL: `http://${PROJECT_ID}-<port>.<BASE_DOMAIN>/`
- [ ] VS Code should auto-detect and open browser (or open manually)

### Quick Start Code Templates

#### Flask (Python)
```python
from flask import Flask
app = Flask(__name__)

@app.route('/')
def index():
    return 'Hello from XaresAICoder!'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
```

Access at: `http://${PROJECT_ID}-5000.${BASE_DOMAIN}/`

#### Express (Node.js)
```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Hello from XaresAICoder!'));

app.listen(3000, '0.0.0.0', () => {
  console.log('Server on port 3000');
});
```

Access at: `http://${PROJECT_ID}-3000.${BASE_DOMAIN}/`

#### FastAPI (Python)
```python
from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello from XaresAICoder"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Access at: `http://${PROJECT_ID}-8000.${BASE_DOMAIN}/`

### Getting Help

- **Documentation**: `docs/` directory in XaresAICoder repository
- **API Reference**: `docs/API.md`
- **AI Tools**: `docs/AI_TOOLS.md`
- **Troubleshooting**: `docs/TROUBLESHOOTING.md`
- **Security**: `docs/SECURITY.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-11-22
**Maintainer**: XaresAICoder Development Team
