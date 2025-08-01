# API Reference

Complete API documentation for XaresAICoder platform.

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Project Management](#project-management)
- [Container Control](#container-control)
- [System Endpoints](#system-endpoints)
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

# 7. Delete the project (with password)
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

[← Back to Project Templates](PROJECT_TEMPLATES.md) | [Next: AI Tools →](AI_TOOLS.md)