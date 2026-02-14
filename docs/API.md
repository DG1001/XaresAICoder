# API Reference

Complete API documentation for XaresAICoder platform.

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Project Management](#project-management)
- [Container Control](#container-control)
- [System Endpoints](#system-endpoints)
- [Password Management](#password-management)
- [Workspace Cloning](#workspace-cloning)
- [Network Proxy & Monitoring](#network-proxy--monitoring)
- [Whitelist Management](#whitelist-management)
- [Git Integration](#git-integration)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Examples](#examples)

## Base URL

The API is available at the same domain as your XaresAICoder installation:

```
http://localhost/api          # Default localhost
http://your-domain.com/api    # Custom domain
```

All API endpoints are prefixed with `/api`.

## Authentication

Currently, XaresAICoder uses **workspace-level password protection** rather than platform-level authentication. Some operations require workspace passwords when workspaces are password-protected.

### Password-Protected Operations

Workspace passwords are required for:
- Stopping password-protected workspaces
- Deleting password-protected workspaces

```json
{
  "password": "workspace-password"
}
```

## Project Management

### Create Project

Creates a new workspace with the specified configuration.

**Endpoint**: `POST /api/projects/create`

**Request Body**:
```json
{
  "projectName": "my-awesome-project",
  "projectType": "python-flask",
  "passwordProtected": true,
  "password": "secure-password-123",
  "createGitRepo": true
}
```

**Parameters**:
- `projectName` (string, required): Project name (alphanumeric, hyphens, underscores)
- `projectType` (string, required): Template type
  - `empty` - Empty project with basic setup
  - `python-flask` - Flask web application  
  - `nodejs-react` - React application with Vite
  - `java-spring` - Spring Boot application
- `passwordProtected` (boolean, optional): Enable password protection
- `password` (string, conditional): Required if `passwordProtected` is true (min 8 chars)
- `createGitRepo` (boolean, optional): Create Git repository (requires Git server)
- `proxyMode` (string, optional): Network proxy mode — `none` (default), `logging` (LLM Logging Proxy, unrestricted with recording), `security` (Security Proxy, whitelist-only)
- `memoryLimit` (string, optional): Memory limit — `1g`, `2g` (default), `4g`, `8g`, `16g`
- `cpuCores` (string, optional): CPU cores — `1`, `2` (default), `4`, `8`
- `group` (string, optional): Group name for organizing workspaces

**Response** (Success - 201):
```json
{
  "success": true,
  "project": {
    "id": "abc123def456",
    "name": "my-awesome-project",
    "type": "python-flask",
    "status": "running",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "workspaceUrl": "http://abc123def456.localhost/",
    "passwordProtected": true,
    "hasGitRepo": true,
    "gitRepoUrl": "http://localhost/git/developer/my-awesome-project"
  },
  "password": "secure-password-123"
}
```

**Response** (Error - 400):
```json
{
  "success": false,
  "error": "Project name already exists"
}
```

### Get Project Details

Retrieves detailed information about a specific project.

**Endpoint**: `GET /api/projects/:projectId`

**Parameters**:
- `projectId` (string): Project identifier

**Response**:
```json
{
  "success": true,
  "project": {
    "id": "abc123def456",
    "name": "my-awesome-project", 
    "type": "python-flask",
    "status": "running",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "lastActivity": "2024-01-15T14:22:00.000Z",
    "workspaceUrl": "http://abc123def456.localhost/",
    "passwordProtected": true,
    "hasGitRepo": true,
    "gitRepoUrl": "http://localhost/git/developer/my-awesome-project",
    "container": {
      "status": "running",
      "health": "healthy",
      "uptime": "4h 15m",
      "resources": {
        "cpu": "0.8%",
        "memory": "1.2GB"
      }
    }
  }
}
```

**Status Values**:
- `creating` - Workspace is being created
- `running` - Container is active and accessible
- `stopped` - Container is stopped but can be restarted
- `error` - Container failed or was removed

### List All Projects

Retrieves a list of all projects with their current status.

**Endpoint**: `GET /api/projects/`

**Response**:
```json
{
  "success": true, 
  "projects": [
    {
      "id": "abc123def456",
      "name": "my-flask-app",
      "type": "python-flask", 
      "status": "running",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "workspaceUrl": "http://abc123def456.localhost/",
      "passwordProtected": true,
      "hasGitRepo": true
    },
    {
      "id": "def456ghi789",
      "name": "react-dashboard",
      "type": "nodejs-react",
      "status": "stopped", 
      "createdAt": "2024-01-14T16:45:00.000Z",
      "workspaceUrl": "http://def456ghi789.localhost/",
      "passwordProtected": false,
      "hasGitRepo": false
    }
  ],
  "count": 2
}
```

### Delete Project

Permanently deletes a project and its associated container.

**Endpoint**: `DELETE /api/projects/:projectId`

**Request Body** (for password-protected workspaces):
```json
{
  "password": "workspace-password"
}
```

**Response** (Success - 200):
```json
{
  "success": true,
  "message": "Project deleted successfully",
  "projectId": "abc123def456"
}
```

**Response** (Error - 401):
```json
{
  "success": false,
  "error": "Invalid password for password-protected workspace"
}
```

## Container Control

### Start Workspace

Starts a stopped workspace container.

**Endpoint**: `POST /api/projects/:projectId/start`

**Response**:
```json
{
  "success": true,
  "message": "Workspace started successfully",
  "project": {
    "id": "abc123def456",
    "status": "running",
    "workspaceUrl": "http://abc123def456.localhost/"
  }
}
```

### Stop Workspace

Stops a running workspace container gracefully.

**Endpoint**: `POST /api/projects/:projectId/stop`

**Request Body** (for password-protected workspaces):
```json
{
  "password": "workspace-password"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Workspace stopped successfully",
  "projectId": "abc123def456"
}
```

### Get Squid Proxy Logs

Retrieves filtered Squid proxy logs for a specific workspace (only for proxy-enabled workspaces).

**Endpoint**: `GET /api/projects/:projectId/squid-logs`

**Query Parameters**:
- `lines` (number, optional): Number of log lines to retrieve (default: 50, max: 500)

**Response** (Success - 200):
```json
{
  "success": true,
  "ipAddress": "172.30.0.5",
  "logs": [
    {
      "timestamp": "1733234567.123",
      "duration": "4233",
      "clientIP": "172.30.0.5",
      "status": "TCP_TUNNEL/200",
      "bytes": "5688",
      "method": "CONNECT",
      "url": "opencode.ai:443",
      "rawLine": "1733234567.123   4233 172.30.0.5 TCP_TUNNEL/200 5688 CONNECT opencode.ai:443 - HIER_DIRECT/172.65.90.22 -"
    },
    {
      "timestamp": "1733234888.186",
      "duration": "0",
      "clientIP": "172.30.0.5",
      "status": "TCP_DENIED/403",
      "bytes": "3369",
      "method": "GET",
      "url": "http://blocked-site.com/",
      "rawLine": "1733234888.186      0 172.30.0.5 TCP_DENIED/403 3369 GET http://blocked-site.com/ - HIER_NONE/- text/html"
    }
  ]
}
```

**Response** (Error - 404):
```json
{
  "success": false,
  "message": "Workspace not found or not using proxy"
}
```

**Log Entry Fields**:
- `timestamp`: Unix timestamp with milliseconds
- `duration`: Request duration in milliseconds
- `clientIP`: Workspace container IP address
- `status`: Squid status code (e.g., TCP_TUNNEL/200, TCP_DENIED/403)
- `bytes`: Response size in bytes
- `method`: HTTP method (GET, POST, CONNECT, etc.)
- `url`: Destination URL
- `rawLine`: Original Squid log line

**Status Codes**:
- `TCP_TUNNEL/200`: Successful HTTPS connection through proxy
- `TCP_DENIED/403`: Request blocked by proxy whitelist
- `TCP_MISS/200`: Successful HTTP GET request (not cached)

## System Endpoints

### Health Check

Checks the health status of the API server.

**Endpoint**: `GET /api/health`

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "version": "1.0.0",
  "uptime": "2d 14h 22m"
}
```

### Workspace Statistics

Retrieves platform-wide workspace statistics.

**Endpoint**: `GET /api/workspace/stats`

**Response**:
```json
{
  "success": true,
  "stats": {
    "totalWorkspaces": 15,
    "runningWorkspaces": 8,
    "stoppedWorkspaces": 5,
    "errorWorkspaces": 2,
    "totalUsers": 3,
    "systemResources": {
      "totalMemory": "16GB",
      "usedMemory": "8.2GB",
      "totalCPU": "8 cores",
      "usedCPU": "3.2 cores",
      "diskUsage": "45GB / 500GB"
    }
  }
}
```

### System Configuration

Retrieves platform configuration information.

**Endpoint**: `GET /api/config`

**Response**:
```json
{
  "success": true,
  "config": {
    "platform": "XaresAICoder",
    "version": "4.2.0",
    "features": {
      "gitServer": true,
      "passwordProtection": true,
      "multipleTemplates": true
    },
    "limits": {
      "maxWorkspacesPerUser": 5,
      "workspaceTimeout": 120,
      "maxMemoryPerWorkspace": "4GB",
      "maxCPUPerWorkspace": 2
    },
    "gitServer": {
      "enabled": true,
      "url": "http://localhost/git/",
      "version": "Forgejo 9.0"
    }
  }
}
```

### Resource Limits Configuration

Retrieves current resource limit configuration for workspace management.

**Endpoint**: `GET /api/limits`

**Response**:
```json
{
  "maxConcurrentWorkspaces": 5,
  "cpuPerWorkspace": 4.0,
  "memoryPerWorkspaceMB": 8192,
  "enableResourceLimits": true
}
```

**Parameters**:
- `maxConcurrentWorkspaces` (integer): Maximum number of simultaneously running workspaces
- `cpuPerWorkspace` (number): Maximum CPU cores allocated per workspace
- `memoryPerWorkspaceMB` (integer): Maximum RAM in megabytes per workspace
- `enableResourceLimits` (boolean): Whether resource limit enforcement is enabled

**Usage**:
```bash
# Check current resource limits
curl http://localhost/api/limits
```

This endpoint is used by the frontend to dynamically populate resource selection options, ensuring users can only choose values within configured limits.

## Password Management

### Update Workspace Password

Update or remove password protection for a workspace.

**Endpoint**: `PUT /api/projects/:projectId/password`

**Request Body**:
```json
{
  "currentPassword": "old-password",
  "newPassword": "new-secure-password"
}
```

Or to remove password protection:
```json
{
  "currentPassword": "old-password",
  "removePassword": true
}
```

**Parameters**:
- `currentPassword` (string): Required for already-protected workspaces
- `newPassword` (string, optional): New password (min 8, max 50 chars)
- `removePassword` (boolean, optional): Set to `true` to remove password protection

**Response** (Success - 200):
```json
{
  "success": true,
  "message": "Password updated successfully",
  "passwordProtected": true
}
```

**Notes**:
- On running containers: writes override file, restarts code-server, waits for readiness
- On stopped containers: writes override file via Docker putArchive (applies on next start)

## Workspace Cloning

### Clone Workspace

Creates multiple identical copies of an existing workspace using Docker filesystem snapshots (`docker commit`). Designed for workshop scenarios where a teacher prepares a base workspace and needs to create N copies for students.

**Endpoint**: `POST /api/projects/:projectId/clone`

**Request Body**:
```json
{
  "count": 5,
  "password": "optional-student-password"
}
```

**Parameters**:
- `count` (integer, required): Number of clones to create (1–50)
- `password` (string, optional): Password for all cloned workspaces (min 8, max 50 chars)

**Response** (Success - 202):
```json
{
  "success": true,
  "message": "Cloning 5 workspaces from \"Base Workshop\"",
  "sourceProjectId": "abc-123",
  "sourceProjectName": "Base Workshop",
  "clones": [
    { "projectId": "clone-id-1", "projectName": "Base Workshop 1", "status": "creating" },
    { "projectId": "clone-id-2", "projectName": "Base Workshop 2", "status": "creating" },
    { "projectId": "clone-id-3", "projectName": "Base Workshop 3", "status": "creating" },
    { "projectId": "clone-id-4", "projectName": "Base Workshop 4", "status": "creating" },
    { "projectId": "clone-id-5", "projectName": "Base Workshop 5", "status": "creating" }
  ],
  "totalCount": 5
}
```

**Response** (Error - 400):
```json
{
  "error": "Failed to clone project",
  "message": "Cannot create 10 clones: only 3 workspace slots remaining (limit: 5)"
}
```

**What gets cloned**: The entire container filesystem (installed packages, files, configs, git repos) via `docker commit`, plus metadata (proxyMode, group, memoryLimit, cpuCores, gitUrl).

**Notes**:
- Returns 202 immediately; clones are created sequentially in the background
- Source workspace can be running or stopped (paused briefly during snapshot)
- Each clone is an independent container with its own copy-on-write layer
- Snapshot image is ephemeral and cleaned up automatically after cloning
- Clone names follow the pattern `{sourceName} 1`, `{sourceName} 2`, etc.
- Workspace limit is checked all-or-nothing before any clones are created

**Error Cases**:
- `404`: Source project not found
- `400`: Source still creating, invalid count, workspace limit exceeded

## Network Proxy & Monitoring

### Get Recorded Domains

Returns all domains recorded by mitmproxy for a workspace using LLM Logging Proxy mode, grouped by category.

**Endpoint**: `GET /api/projects/:projectId/recorded-domains`

**Response** (Success - 200):
```json
{
  "success": true,
  "projectId": "abc-123",
  "ipAddress": "172.30.0.5",
  "domains": {
    "pypi.org": {"count": 15, "first_seen": "2026-02-14T10:00:00Z", "last_seen": "2026-02-14T11:30:00Z"},
    "api.anthropic.com": {"count": 3, "first_seen": "2026-02-14T10:05:00Z", "last_seen": "2026-02-14T11:00:00Z"}
  },
  "categorized": {
    "Package Managers": [{"domain": "pypi.org", "count": 15, "first_seen": "...", "last_seen": "..."}],
    "AI APIs": [{"domain": "api.anthropic.com", "count": 3, "first_seen": "...", "last_seen": "..."}]
  },
  "totalDomains": 2
}
```

**Categories**: Package Managers, AI APIs, Documentation, Version Control, System, Other

### Get LLM Conversations

See [LLM_CONVERSATION_LOGGING.md](LLM_CONVERSATION_LOGGING.md) for full details.

**Endpoint**: `GET /api/projects/:projectId/llm-conversations`

### Get Squid Proxy Logs

Returns filtered Squid proxy logs for Security Proxy workspaces.

**Endpoint**: `GET /api/projects/:projectId/squid-logs`

See existing documentation above for response format.

## Whitelist Management

### Get Current Whitelist

Returns the current Security Proxy (squid) whitelist by parsing `squid.conf`.

**Endpoint**: `GET /api/whitelist`

**Response** (Success - 200):
```json
{
  "success": true,
  "domains": [".anthropic.com", ".debian.org", ".github.com", ".pypi.org"],
  "raw": "# Whitelist ACLs section content..."
}
```

### Apply Whitelist

Replaces the Security Proxy whitelist with the provided domains. Merges with base defaults (apt repos, VS Code extensions), normalizes to squid `.domain` format, deduplicates subdomains, writes to squid.conf, and runs `squid -k reconfigure`.

**Endpoint**: `PUT /api/whitelist`

**Request Body**:
```json
{
  "domains": ["pypi.org", "api.anthropic.com", "github.com", "registry.npmjs.org"]
}
```

**Response** (Success - 200):
```json
{
  "success": true,
  "domainCount": 12,
  "domains": [".anthropic.com", ".debian.org", ".eclipsecontent.org", ".github.com", "..."]
}
```

**Notes**:
- Base domains are always included (apt repos, VS Code extensions) regardless of input
- Domains are normalized to `.domain` format (squid convention: matches both bare domain and all subdomains)
- Redundant subdomains are automatically removed (e.g., `.api.anthropic.com` removed when `.anthropic.com` exists)
- Changes take effect immediately via `squid -k reconfigure`

## Git Integration

### List Git Repositories

Lists all Git repositories in the integrated Git server.

**Endpoint**: `GET /api/git/repositories`

**Response**:
```json
{
  "success": true,
  "repositories": [
    {
      "name": "my-flask-app",
      "fullName": "developer/my-flask-app",
      "description": "Python Flask web application",
      "url": "http://localhost/git/developer/my-flask-app",
      "cloneUrl": "http://localhost/git/developer/my-flask-app.git",
      "private": false,
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### Create Git Repository

Creates a new Git repository in the integrated Git server.

**Endpoint**: `POST /api/git/repositories`

**Request Body**:
```json
{
  "name": "new-project",
  "description": "My new project repository",
  "private": false
}
```

**Response**:
```json
{
  "success": true,
  "repository": {
    "name": "new-project",
    "fullName": "developer/new-project", 
    "url": "http://localhost/git/developer/new-project",
    "cloneUrl": "http://localhost/git/developer/new-project.git"
  }
}
```

## Error Handling

### Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional error details"
  }
}
```

### Common Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `INVALID_PROJECT_NAME` | Project name contains invalid characters |
| 400 | `INVALID_PROJECT_TYPE` | Unsupported project template type |
| 400 | `PROJECT_EXISTS` | Project name already in use |
| 400 | `INVALID_PASSWORD` | Password too short or weak |
| 401 | `INVALID_WORKSPACE_PASSWORD` | Incorrect workspace password |
| 404 | `PROJECT_NOT_FOUND` | Project ID does not exist |
| 409 | `WORKSPACE_LIMIT_EXCEEDED` | Maximum workspaces per user reached |
| 409 | `CONCURRENT_LIMIT_REACHED` | Maximum concurrent workspaces reached |
| 500 | `CONTAINER_CREATE_FAILED` | Failed to create Docker container |
| 500 | `GIT_REPO_CREATE_FAILED` | Failed to create Git repository |
| 503 | `SERVICE_UNAVAILABLE` | Docker daemon or system unavailable |

### Validation Errors

```json
{
  "success": false,
  "error": "Validation failed",
  "code": "VALIDATION_ERROR",
  "details": {
    "projectName": "Project name must be 3-50 characters",
    "password": "Password must be at least 8 characters"
  }
}
```

## Rate Limiting

Currently, no rate limiting is implemented. Future versions may include:
- Request rate limiting per IP
- Workspace creation limits
- API key-based throttling

## Examples

### Complete Workflow Example

```bash
# 1. Check system health
curl http://localhost/api/health

# 2. Create a new Python Flask project
curl -X POST http://localhost/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-web-app",
    "projectType": "python-flask",
    "passwordProtected": true,
    "password": "secure123!",
    "createGitRepo": true
  }'

# 3. Get project details
curl http://localhost/api/projects/abc123def456

# 4. List all projects
curl http://localhost/api/projects/

# 5. Stop the workspace (with password)
curl -X POST http://localhost/api/projects/abc123def456/stop \
  -H "Content-Type: application/json" \
  -d '{"password": "secure123!"}'

# 6. Start the workspace again
curl -X POST http://localhost/api/projects/abc123def456/start

# 7. Clone workspace for a workshop (20 student copies)
curl -X POST http://localhost/api/projects/abc123def456/clone \
  -H "Content-Type: application/json" \
  -d '{"count": 20, "password": "student-pw-123"}'

# 8. Delete the project (with password)
curl -X DELETE http://localhost/api/projects/abc123def456 \
  -H "Content-Type: application/json" \
  -d '{"password": "secure123!"}'
```

### JavaScript/Fetch Example

```javascript
// Create a new workspace
async function createWorkspace(name, type) {
  const response = await fetch('/api/projects/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectName: name,
      projectType: type,
      passwordProtected: false
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    console.log('Workspace created:', data.project.workspaceUrl);
  } else {
    console.error('Error:', data.error);
  }
}

// Get all projects
async function listProjects() {
  const response = await fetch('/api/projects/');
  const data = await response.json();
  
  return data.projects;
}

// Stop workspace with password
async function stopWorkspace(projectId, password) {
  const response = await fetch(`/api/projects/${projectId}/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password })
  });
  
  return response.json();
}
```

### Python Example

```python
import requests
import json

BASE_URL = "http://localhost/api"

def create_workspace(name, project_type, password=None):
    """Create a new workspace"""
    data = {
        "projectName": name,
        "projectType": project_type
    }
    
    if password:
        data["passwordProtected"] = True
        data["password"] = password
    
    response = requests.post(f"{BASE_URL}/projects/create", json=data)
    return response.json()

def get_project(project_id):
    """Get project details"""
    response = requests.get(f"{BASE_URL}/projects/{project_id}")
    return response.json()

def list_projects():
    """List all projects"""
    response = requests.get(f"{BASE_URL}/projects/")
    return response.json()

def stop_workspace(project_id, password=None):
    """Stop a workspace"""
    data = {}
    if password:
        data["password"] = password
    
    response = requests.post(f"{BASE_URL}/projects/{project_id}/stop", json=data)
    return response.json()

# Example usage
if __name__ == "__main__":
    # Create workspace
    result = create_workspace("test-app", "python-flask", "mypassword")
    if result["success"]:
        project_id = result["project"]["id"]
        print(f"Created workspace: {project_id}")
        
        # Get details
        details = get_project(project_id)
        print(f"Status: {details['project']['status']}")
        
        # Stop workspace
        stop_result = stop_workspace(project_id, "mypassword")
        print(f"Stop result: {stop_result['success']}")
```

---

[← Back to Architecture](ARCHITECTURE.md) | [Next: AI Tools →](AI_TOOLS.md)