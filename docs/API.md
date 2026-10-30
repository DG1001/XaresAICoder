# API Reference

Complete API documentation for XaresAICoder platform.

## Table of Contents

- [Base URL](#base-url)
- [Authentication](#authentication)
- [Group Users](#group-users)
- [Project Management](#project-management)
- [Container Control](#container-control)
- [System Endpoints](#system-endpoints)
- [Password Management](#password-management)
- [Workspace Cloning](#workspace-cloning)
- [Project Notes](#project-notes)
- [Project Metadata](#project-metadata)
- [Network Proxy & Monitoring](#network-proxy--monitoring)
- [Subdomain Aliases](#subdomain-aliases)
- [Whitelist Management](#whitelist-management)
- [Workshop](#workshop)
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

### Login and Roles

The API requires a session. There are two kinds of accounts:

- **Admin**: one shared password, `ADMIN_PASSWORD` in `.env` (`./deploy.sh`
  generates one if it is missing). Full access.
- **Group users**: created by the admin (see [Group Users](#group-users)), each
  with a user name, a password and one or more project groups. They only see
  the projects of their groups (see [Group User Permissions](#group-user-permissions)).

Without a session every endpoint answers
`401 {"error": "Login required", "code": "LOGIN_REQUIRED"}`; while
`ADMIN_PASSWORD` is not set at all, `503 {"code": "LOGIN_NOT_CONFIGURED"}`
(group users cannot log in either then).

Public without a session: `GET /api/health`, `/api/auth/*`, and the workshop
participant endpoints (`/api/workshop/status`, `/claim`, `/my-claim`).

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/login` | Admin: body `{ "password": "..." }` (or `{ "username": "admin", "password": "..." }`). Group user: `{ "username": "...", "password": "..." }` (user name case-insensitive). Response `{ "authenticated": true, "role": "admin" \| "group" }`. Sets the session cookie `xares_admin` (HttpOnly, SameSite=Strict, `Secure` with `PROTOCOL=https`, lifetime `ADMIN_SESSION_HOURS`, default 168 = 7 days). `401` wrong user name or password, `429` after 10 failed attempts per client within 15 minutes (behind a reverse proxy: per address in `X-Forwarded-For`, see [DEPLOYMENT.md](DEPLOYMENT.md#3-production-with-external-ssl-proxy)) |
| `POST /api/auth/logout` | Ends the session and clears the cookie |
| `GET /api/auth/status` | `{ "configured": bool, "authenticated": bool, "role": "admin" \| "group" }`; for group users also `"username"` and `"groups"` |

Changing `ADMIN_PASSWORD` ends all sessions, including those of group users.
A group user's sessions end as soon as the admin sets a new password for them
or deletes them; changes to their groups apply to the next request.

Requests that change state (`POST`/`PUT`/`DELETE`) from a browser must come
from the dashboard's own origin: a different `Origin` hostname or
`Sec-Fetch-Site: same-site/cross-site` is rejected with `403` (workspace apps
run on subdomains and would otherwise ride on the admin's cookie). Clients
without these headers (curl, scripts) are not affected.

```bash
# curl: log in once, reuse the cookie
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"password":"<ADMIN_PASSWORD>"}' http://localhost/api/auth/login
curl -b cookies.txt http://localhost/api/projects/

# as a group user
curl -c teacher.txt -H 'Content-Type: application/json' \
  -d '{"username":"teacher-7a","password":"<password>"}' http://localhost/api/auth/login
```

### Group User Permissions

A group user may call only these endpoints; everything else answers
`403 {"error": "Not allowed for this account", "code": "FORBIDDEN_FOR_ROLE"}`:

| Endpoint | Note |
|----------|------|
| `GET /api/config` | |
| `GET /api/projects/` | Only projects of the user's groups |
| `GET /api/projects/groups` | Only the user's groups that contain projects |
| `GET /api/projects/:projectId` | |
| `PUT /api/projects/:projectId/name` | |
| `POST /api/projects/:projectId/start`, `/stop` | A protected workspace still needs its password |
| `GET` / `PUT /api/projects/:projectId/notes` | |
| `GET /api/projects/:projectId/disk-usage` | |
| `PUT /api/projects/:projectId/password` | Set, change or remove; `currentPassword` as for the admin |

The project endpoints answer `404` for projects outside the user's groups, so
their existence does not leak. Creating, deleting, cloning, moving projects to
another group, aliases, proxy logs, LLM conversations, whitelist, workspace
statistics, user management and the workshop admin endpoints stay admin-only.

### Workspace Passwords

In addition to the admin login, password-protected workspaces require their
workspace password for sensitive operations.

### Password-Protected Operations

For password-protected workspaces, the workspace password is required for:
- Starting, stopping and deleting the workspace
- Cloning it (`POST /:projectId/clone`)
- Subdomain aliases and port detection (`/:projectId/aliases*`, `/:projectId/ports`)
- Proxy logs, recorded domains, LLM conversations and documentation generation
  (`/:projectId/squid-logs`, `/:projectId/recorded-domains`,
  `/:projectId/llm-conversations*`, `/:projectId/generate-documentation`)

Send it in the `X-Workspace-Password` header, percent-encoded (JavaScript:
`encodeURIComponent(password)`), so non-ASCII passwords survive HTTP header
encoding. Plain ASCII passwords without `%` can be sent as is:

```bash
curl -H "X-Workspace-Password: my-password" \
  http://localhost/api/projects/<id>/llm-conversations
```

Start, stop and delete also still accept the password in the JSON body:

```json
{
  "password": "workspace-password"
}
```

A missing or wrong password returns `401`. Organizational metadata (name, group,
notes) can be changed without the workspace password.

## Group Users

Admin only. Users are stored in `group-users.json` on the `workspace_data`
volume (included in `backup.sh`); passwords as bcrypt hashes, never returned.

| Endpoint | Description |
|----------|-------------|
| `GET /api/users` | `{ "success": true, "users": [{ "id", "username", "groups", "createdAt" }] }` |
| `POST /api/users` | Body `{ "username", "password", "groups": [...] }` → `201` with the user. `400` invalid input, `409` user name exists |
| `PUT /api/users/:id` | Body `{ "groups"?: [...], "password"?: "..." }`. A new password ends the user's sessions. `404` unknown user |
| `DELETE /api/users/:id` | Deletes the user and ends their sessions |

Rules: user name 2–40 characters `a-z 0-9 . _ -` (stored in lower case,
unique, `admin` is reserved); password 8–50 characters without control
characters (same rule as workspace passwords); group names like project
groups (1–50 characters: letters, digits, spaces, `-`, `_`). A group does not
need projects yet.

```bash
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"teacher-7a","password":"<password>","groups":["Class 7a"]}' \
  http://localhost/api/users
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
- `sudoEnabled` (boolean, optional): allow sudo in the workspace; defaults to `WORKSPACE_SUDO_ENABLED` (`GET /api/config` → `workspaceSudoDefault`)
- `password` (string, conditional): Required if `passwordProtected` is true (min 8 chars)
- `createGitRepo` (boolean, optional): Create a private Git repository owned by the workspace's own Forgejo user (requires Git server). With the Git server enabled, every workspace gets its own Forgejo user and token (`FORGEJO_USER`/`FORGEJO_TOKEN`), with or without repository.
- `gitUrl`, `gitUsername`, `gitToken` (with `projectType: "git-clone"`): repository to clone. A URL of this platform's Forgejo (`<base>/git/<owner>/<repo>`) needs no token: the new workspace user is added as collaborator and works directly on that repository (e.g. to continue the work of a deleted workspace).
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
- `stopping` - A stop is in progress (see [Stop Workspace](#stop-workspace))
- `stopped` - Container is stopped but can be restarted
- `error` - Container failed or was removed

A project may carry `lastError` (`{ "action": "stop", "message": "...", "at": "<ISO time>" }`)
when an action the server finished in the background failed; it is cleared by the next
start or stop.

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

Stops a running workspace container gracefully. Stopping can take a while when Docker is
busy, so by default the request only starts it: the answer is `202` and the project shows
`status: "stopping"` until the container has stopped (poll `GET /api/projects/:projectId`
or the list). If the stop fails, the project gets `lastError` and its status from Docker;
a stop Docker has not finished after 3 minutes counts as failed (the container may still
stop later).
A second stop request while one runs joins it. Starting a workspace that is still stopping
answers `409`.

**Endpoint**: `POST /api/projects/:projectId/stop` (`?wait=true`: answer only after the
container has stopped, as before)

**Request Body** (for password-protected workspaces; `"wait": true` is the same as
`?wait=true`):
```json
{
  "password": "workspace-password"
}
```

**Response** (`202`, default):
```json
{
  "success": true,
  "accepted": true,
  "message": "Stopping workspace",
  "project": { "projectId": "abc123def456", "status": "stopping" }
}
```

**Response** (`200`, with `wait`):
```json
{
  "success": true,
  "message": "Workspace stopped successfully",
  "project": { "projectId": "abc123def456", "status": "stopped" }
}
```

With `wait`, a failed stop answers `500` (`{ "error": "Failed to stop project", "message": "..." }`).

### List Groups

Returns all groups used across projects, with their projects
(`Uncategorized` last). For group users only their own groups.

**Endpoint**: `GET /api/projects/groups`

**Response**:
```json
{
  "success": true,
  "groups": [
    { "name": "workshop-2026", "count": 2, "projects": ["abc123", "def456"] },
    { "name": "Uncategorized", "count": 1, "projects": ["ghi789"] }
  ]
}
```

### Get Disk Usage

Returns disk usage statistics for a specific workspace container.

**Endpoint**: `GET /api/projects/:projectId/disk-usage`

**Response**:
```json
{
  "success": true,
  "diskUsage": {
    "bytes": 1234567890,
    "totalBytes": 9876543210,
    "readable": "1.1 GB",
    "totalReadable": "9.2 GB"
  }
}
```

## Project Notes

### Get Project Notes

Retrieves notes for a specific project.

**Endpoint**: `GET /api/projects/:projectId/notes`

**Response**:
```json
{
  "success": true,
  "notes": "Student should complete exercises 1-3."
}
```

### Update Project Notes

Updates notes for a specific project.

**Endpoint**: `PUT /api/projects/:projectId/notes`

**Request Body**:
```json
{
  "notes": "Updated instructions for this workspace."
}
```

**Response**:
```json
{
  "success": true,
  "message": "Notes updated successfully"
}
```

**Notes**: Maximum note length is 10KB.

## Project Metadata

### Rename Project

Updates the display name of a project.

**Endpoint**: `PUT /api/projects/:projectId/name`

**Request Body**:
```json
{
  "name": "New Project Name"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Project name updated successfully"
}
```

**Notes**: Name must be 1–100 characters.

### Update Project Group

Assigns or changes the group of a project.

**Endpoint**: `PUT /api/projects/:projectId/group`

**Request Body**:
```json
{
  "group": "workshop-2026"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Project group updated successfully"
}
```

### Rename or Delete a Group

Admin only. Changes all projects of the group **and** the group users assigned
to it in one step.

**Endpoints**:
- `PUT /api/projects/groups/:name` with body `{ "newName": "workshop-2027" }` →
  `{ "success": true, "group": "workshop-2027" }`. Renaming onto an existing
  group merges both.
- `DELETE /api/projects/groups/:name` → `{ "success": true }`. The projects move
  to `Uncategorized`, users lose the group.

`400` for an invalid new name. URL-encode the group name (`Class%207a`).

### Get Squid Proxy Logs

Retrieves filtered Squid proxy logs for a specific workspace (only for proxy-enabled workspaces).

**Endpoint**: `GET /api/projects/:projectId/squid-logs`

**Query Parameters**:
- `lines` (number, optional): Number of log lines to retrieve (default: 50, max: 500)

**Response** (Success - 200):
```json
{
  "success": true,
  "ipAddress": "172.31.128.1",
  "logs": [
    {
      "timestamp": "1733234567.123",
      "duration": "4233",
      "clientIP": "172.31.128.1",
      "status": "TCP_TUNNEL/200",
      "bytes": "5688",
      "method": "CONNECT",
      "url": "opencode.ai:443",
      "rawLine": "1733234567.123   4233 172.31.128.1 TCP_TUNNEL/200 5688 CONNECT opencode.ai:443 - HIER_DIRECT/172.65.90.22 -"
    },
    {
      "timestamp": "1733234888.186",
      "duration": "0",
      "clientIP": "172.31.128.1",
      "status": "TCP_DENIED/403",
      "bytes": "3369",
      "method": "GET",
      "url": "http://blocked-site.com/",
      "rawLine": "1733234888.186      0 172.31.128.1 TCP_DENIED/403 3369 GET http://blocked-site.com/ - HIER_NONE/- text/html"
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
curl -b cookies.txt http://localhost/api/limits
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

**Headers**: `X-Workspace-Password` – required if the *source* workspace is
password-protected (see [Authentication](#authentication)).

**Parameters**:
- `count` (integer, required): Number of clones to create (1–50)
- `password` (string, **required**): Password for all cloned workspaces (min 8, max 50 chars).
  Clones are typically handed to participants and can reach each other's ports inside
  the Docker network, so code-server must be protected.
- `sudoEnabled` (boolean, optional): allow sudo in the clones; defaults to `WORKSPACE_SUDO_ENABLED`
- `keepAiLogins` (boolean, optional, default `false`): keep the AI tool logins and
  conversation histories of the source (e.g. to distribute a shared workshop API key).

**Credential cleanup**: before the clones are created, the snapshot is sanitized once in a
throwaway container without network. Always removed: code-server password files, git
credentials (`~/.git-credentials`, `~/.netrc`, tokens embedded in git remote URLs), GitHub
CLI tokens, npm auth tokens, SSH private keys (`known_hosts` is kept) and shell histories.
Unless `keepAiLogins` is set, also removed: logins and transcripts of Claude Code, Codex,
GitHub Copilot CLI (`~/.copilot`), OpenCode, Crush, Pi, Cline and Kilo Code; for snapshots of
older workspaces also Qwen Code, Continue (API keys in `config.yaml`) and Aider (`~/.env`,
`~/.aider.conf.yml`, chat histories). Platform environment variables of the source (e.g.
`GIT_ACCESS_TOKEN`) are blanked in the clones. Project files and secrets the user put into
other files (e.g. a `.env` in the project) are not touched.

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
- **Git repositories**: Each clone gets its own Forgejo user and token. If the source works with this Forgejo (a recorded repository or a Forgejo `origin`), the clone gets its own **private** repository with the source's state and history, and `origin` points there. Clones cannot see or overwrite each other's work.

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
  "ipAddress": "172.30.128.1",
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

Lists the captures of a workspace, newest first, as small summaries. Agent tools
resend the whole history with every call, so a single capture can be several MB;
the list therefore carries no request or response bodies.

**Query**: `limit` (default 100, max 1000), `offset`, `model`, `dateFrom`, `dateTo`
(filters apply to the page), `full=true` (complete captures as before this change –
can be very large).

**Response** (200):
```json
{
  "success": true,
  "summary": true,
  "total": 90,
  "count": 50,
  "offset": 0,
  "limit": 50,
  "conversations": [
    {
      "_file": "2026-10-29T13-15-29-051707",
      "timestamp": "2026-10-29T13:15:29.051707",
      "method": "POST",
      "url": "https://api.deepseek.com/chat/completions",
      "model": "deepseek-chat",
      "status": 200,
      "messageCount": 186,
      "usage": { "input": 61234, "output": 512, "cached": 60800 },
      "size": 4755813,
      "lastUserMessage": "first 240 characters …",
      "response": "first 240 characters …"
    }
  ]
}
```

`usage` is `null` when the response carries none (e.g. streamed). WebSocket captures
(Codex) have `websocketMessages` and `inProgress` instead of messages. Summaries are
cached by the server until the capture file changes.

### Get One LLM Conversation

**Endpoint**: `GET /api/projects/:projectId/llm-conversations/:file`

`:file` is a summary's `_file` (`[0-9A-Za-z-]`, max. 64 characters, else `400`).
Returns `{ "success": true, "conversation": { … } }` with the complete capture
(request and response headers with credentials redacted, raw bodies, `parsed_request`,
`parsed_response`), or `404` if it does not exist.

### Get Squid Proxy Logs

Returns filtered Squid proxy logs for Security Proxy workspaces.

**Endpoint**: `GET /api/projects/:projectId/squid-logs`

See existing documentation above for response format.

## Subdomain Aliases

Map a human-readable subdomain to any port inside a workspace. The alias is served by nginx as an exact-match `server_name`, so it takes priority over the regex-based UUID routing. Aliases survive workspace stop/restart; deleting one returns a clean 404 (the catch-all server block) rather than leaking the auth-protected frontend.

### List Listening Ports

Auto-detected TCP ports the workspace container is currently listening on. Reads `/proc/net/tcp{,6}` (no `ss`/`netstat` needed). Port `8082` (code-server) is filtered out; loopback-only binds are excluded.

**Endpoint**: `GET /api/projects/:projectId/ports`

**Response** (200):
```json
{ "success": true, "ports": [3000, 8000] }
```

Returns empty array when the workspace is stopped.

### List Aliases

**Endpoint**: `GET /api/projects/:projectId/aliases`

**Response** (200):
```json
{
  "success": true,
  "aliases": [
    {
      "subdomain": "myapp",
      "port": 3000,
      "authProtected": false,
      "authUsername": null,
      "createdAt": "2026-05-15T10:00:00Z",
      "updatedAt": "2026-05-15T10:00:00Z",
      "url": "http://myapp.localhost/"
    }
  ]
}
```

### Create Alias

**Endpoint**: `POST /api/projects/:projectId/aliases`

**Request Body**:
```json
{
  "subdomain": "myapp",
  "port": 3000,
  "authProtected": false,
  "authUsername": "alice",
  "authPassword": "secret123"
}
```

**Validation**:
- `subdomain`: 3-32 chars, lowercase, regex `^[a-z][a-z0-9-]+[a-z0-9]$`, must not be a reserved word (`www`, `api`, `admin`, `git`, `forgejo`, `code-server`, `workshop`, `mitm`, `proxy`, `squid`, `nginx`, `dashboard`, `config`, `localhost`).
- `port`: 1-65535; `8082` is rejected (code-server itself).
- `authUsername`: 1-64 chars from `[A-Za-z0-9_.-]` (required when `authProtected: true`).
- `authPassword`: 6-128 chars (required when `authProtected: true`).

**Response** (201): the newly created alias (same shape as the list entry above).

**Error Codes**:
| Code | Reason |
|------|--------|
| 400 | Invalid subdomain/port/username/password format |
| 404 | Project not found |
| 409 | Subdomain already in use (across all workspaces) |
| 422 | Subdomain is reserved |
| 502 | nginx config validation or reload failed |

### Update Alias

**Endpoint**: `PUT /api/projects/:projectId/aliases/:subdomain`

**Request Body** (all fields optional):
```json
{
  "port": 4000,
  "authProtected": true,
  "authUsername": "alice",
  "authPassword": "newSecret123"
}
```

Use `{ "authProtected": false }` to remove Basic Auth. Use the same body to add Basic Auth or rotate the password.

**Response** (200): the updated alias.

### Delete Alias

**Endpoint**: `DELETE /api/projects/:projectId/aliases/:subdomain`

Removes the alias, deletes the corresponding htpasswd file, regenerates `aliases.conf` and reloads nginx.

**Response** (200):
```json
{ "success": true }
```

### Implementation Notes

- Basic Auth uses **SHA1** hashes (`{SHA}<base64>` in htpasswd) — universally supported by stock nginx. bcrypt is not used because nginx-alpine builds don't guarantee bcrypt support.
- All write endpoints validate (`nginx -t`) and reload (`nginx -s reload`) the new config; on validation failure the previous config is rolled back from `last-known-good.txt`.
- Aliases are **not** copied when cloning a workspace (subdomains must remain globally unique).
- Unknown subdomains (never registered, or deleted) are served by a catch-all server block returning `HTTP 404 "Unknown subdomain..."` instead of falling through to the frontend.

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
- Only plain domain names are accepted (`example.com`, `.example.com`, `*.example.com`).
  IP addresses, URLs, single-label names (e.g. `.com`) and entries containing
  whitespace are rejected with `400` and a list of the invalid entries
- The generated config is checked with `squid -k parse` before it replaces the live
  `squid.conf` (`422` if invalid); if `squid -k reconfigure` fails, the previous
  config is restored
- The change lives in the running squid container only – recreating the container
  restores the default whitelist baked into the image

### Generate Documentation from LLM Conversations

Generates markdown documentation from captured LLM conversations for a workspace.

**Endpoint**: `POST /api/projects/:projectId/generate-documentation`

**Request Body**:
```json
{
  "format": "markdown",
  "type": "clean"
}
```

**Parameters**:
- `format` (string, optional): Output format — `markdown` (default)
- `type` (string, optional): Documentation type — `clean` (default), `detailed`

**Response**:
```json
{
  "success": true,
  "projectId": "abc-123",
  "format": "markdown",
  "type": "clean",
  "documentation": "# AI Session Documentation\n...",
  "conversationCount": 42
}
```

### Delete All LLM Conversations

Deletes all captured LLM conversations for a workspace.

**Endpoint**: `DELETE /api/projects/:projectId/llm-conversations`

**Response**:
```json
{
  "success": true,
  "message": "All conversations deleted successfully"
}
```

### Delete Specific LLM Conversation

Deletes a single LLM conversation by timestamp.

**Endpoint**: `DELETE /api/projects/:projectId/llm-conversations/:timestamp`

**Response**:
```json
{
  "success": true,
  "message": "Conversation deleted successfully"
}
```

## Workshop

Workshop endpoints support participant self-registration and admin management for workshop scenarios.

### Get Workshop Status (Public)

Returns available/total/claimed workspace counts for the current workshop group.

**Endpoint**: `GET /api/workshop/status`

**Response**:
```json
{
  "available": 15,
  "total": 20,
  "claimed": 5
}
```

**Notes**: Workshop group is determined by the `WORKSHOP_GROUP` environment variable.

### Claim Workspace (Public)

Assigns the next free workspace to a participant.

**Endpoint**: `POST /api/workshop/claim`

**Request Body**:
```json
{
  "name": "Max Mustermann",
  "email": "max@example.com"
}
```

**Response** (Success - 200):
```json
{
  "workspaceUrl": "http://workshop-1.localhost/",
  "projectName": "Workshop 1",
  "claimToken": "9f2c4e0b7a1d4c3e8b6a5f4e3d2c1b0a"
}
```

`claimToken` is a secret for this participant only; the landing page stores it
in `localStorage` to show the workspace again later (see My Claim).

**Response** (Duplicate - 409): no workspace URL is returned, so knowing a
participant's email address does not reveal their workspace.
```json
{
  "error": "Diese E-Mail-Adresse ist bereits registriert. Falls du den Link zu deinem Workspace verloren hast, wende dich bitte an die Workshop-Leitung."
}
```

**Validation**: `name` 1–100 characters without control characters, `email` max.
254 characters. Claims are processed one at a time, so one email can only ever
hold one workspace and no workspace is handed out twice.

**Response** (No workspaces available - 503):
```json
{
  "error": "Leider sind keine Workspaces mehr verfügbar. Bitte wenden Sie sich an den Workshop-Leiter."
}
```

### My Claim

Returns the workspace for a claim token from `POST /claim` while the claim is
active. Used by the landing page to show a participant's workspace again.

**Endpoint**: `POST /api/workshop/my-claim`

**Request Body**: `{ "token": "<claimToken>" }`

**Response**: `200` with `{ "workspaceUrl", "projectName" }`; `404` if the claim
was released (or the token is unknown); `400` for a malformed token.

### List Claims (Admin)

Returns all active claims and release history. Requires admin password.

**Endpoint**: `GET /api/workshop/claims`

**Auth**: an admin session (dashboard login) **or** the header
`X-Admin-Password: <WORKSHOP_ADMIN_PASSWORD>` (percent-encoded; plain ASCII
passwords without `%` can be sent as is). The password is not accepted as a
query parameter. Returns `401` for a wrong password and `503` if there is no
session and `WORKSHOP_ADMIN_PASSWORD` is not set.

**Response**:
```json
{
  "claims": [
    {
      "projectId": "abc-123",
      "name": "Max Mustermann",
      "email": "max@example.com",
      "projectName": "Workshop 1",
      "workspaceUrl": "http://workshop-1.localhost/",
      "claimedAt": "2026-04-19T10:00:00.000Z"
    }
  ],
  "history": []
}
```

### Release Claim (Admin)

Releases a claimed workspace back to the pool. Requires admin password.

**Endpoint**: `POST /api/workshop/claims/:projectId/release`

**Headers**: `X-Admin-Password: <WORKSHOP_ADMIN_PASSWORD>` (see List Claims)

**Response**:
```json
{
  "success": true,
  "released": {
    "name": "Max Mustermann",
    "email": "max@example.com",
    "projectName": "Workshop 1",
    "workspaceUrl": "http://workshop-1.localhost/",
    "claimedAt": "2026-04-19T10:00:00.000Z"
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
| 401 | `LOGIN_REQUIRED` | No valid session (log in again) |
| 403 | `FORBIDDEN_FOR_ROLE` | Endpoint not allowed for a group user |
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
curl -b cookies.txt -X POST http://localhost/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-web-app",
    "projectType": "python-flask",
    "passwordProtected": true,
    "password": "secure123!",
    "createGitRepo": true
  }'

# 3. Get project details
curl -b cookies.txt http://localhost/api/projects/abc123def456

# 4. List all projects
curl -b cookies.txt http://localhost/api/projects/

# 5. Stop the workspace (with password)
curl -b cookies.txt -X POST http://localhost/api/projects/abc123def456/stop \
  -H "Content-Type: application/json" \
  -d '{"password": "secure123!"}'

# 6. Start the workspace again
curl -b cookies.txt -X POST http://localhost/api/projects/abc123def456/start

# 7. Clone workspace for a workshop (20 student copies)
curl -b cookies.txt -X POST http://localhost/api/projects/abc123def456/clone \
  -H "Content-Type: application/json" \
  -d '{"count": 20, "password": "student-pw-123"}'

# 8. Delete the project (with password)
curl -b cookies.txt -X DELETE http://localhost/api/projects/abc123def456 \
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