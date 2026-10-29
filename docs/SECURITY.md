# Security Features

Comprehensive security guide for XaresAICoder platform.

## Table of Contents

- [Security Overview](#security-overview)
- [Workspace Security](#workspace-security)
- [Container Isolation](#container-isolation)
- [Network Security](#network-security)
- [Data Protection](#data-protection)
- [Authentication](#authentication)
- [Best Practices](#best-practices)
- [Security Configuration](#security-configuration)
- [Monitoring](#monitoring)
- [Incident Response](#incident-response)

## Security Overview

XaresAICoder implements a multi-layered security approach focusing on:
- ✅ **Container Isolation** - Each workspace runs in isolated containers
- ✅ **Password Protection & Management** - Workspace-level authentication with set/update/remove support
- ✅ **Network Segmentation** - Isolated Docker networks with dual proxy modes
- ✅ **Resource Limits** - Prevent resource exhaustion attacks
- ✅ **No Root Access** - Non-privileged container execution
- ✅ **Data Isolation** - Separate storage for each workspace
- ✅ **Outgoing Traffic Control** - Security Proxy with domain whitelisting, LLM Logging Proxy for monitoring

### Security Principles

1. **Defense in Depth** - Multiple security layers
2. **Principle of Least Privilege** - Minimal required access
3. **Isolation by Default** - Workspaces cannot access each other
4. **User-Controlled Security** - Optional protection levels
5. **Transparency** - Clear security boundaries and limitations

## Workspace Security

### Password Protection

**Per-Workspace Control**: Security is configurable per workspace rather than platform-wide.

#### Creating Protected Workspaces

```json
{
  "projectName": "secure-project",
  "projectType": "python-flask",
  "passwordProtected": true,
  "password": "MySecurePassword123!"
}
```

#### Password Requirements

- **Minimum Length**: 8 characters
- **Maximum Length**: 50 characters
- **Recommended**: 12+ characters with mixed case, numbers, symbols
- **Auto-Generated**: Secure 12-character passwords available via UI
- **Custom Passwords**: User-defined passwords supported

#### Password Storage

Passwords are persisted to disk via `saveProjectsToDisk()` and survive server restarts:

```javascript
// Passwords are hashed using bcrypt with 10 salt rounds
const bcrypt = require('bcrypt');
const hashedPassword = await bcrypt.hash(password, 10);

// Stored in project metadata (hashed, never plaintext)
project.passwordProtected = true;
project.passwordHash = hashedPassword;
```

**Security Features**:
- ✅ **Bcrypt Hashing** - Industry-standard password hashing with salt
- ✅ **Persistent Storage** - Password state survives server restarts via disk serialization
- ✅ **Container Override File** - Password changes applied to running/stopped containers via `/home/coder/.code-server-auth`
- ✅ **No Plaintext Storage** - Only bcrypt hashes stored server-side

#### Password Management (Set, Update, Remove)

Workspace passwords can be managed after creation via the `PUT /api/projects/:projectId/password` endpoint:

**Set password on unprotected workspace:**
> The API needs the admin login. Log in once with curl and reuse the cookie:
> `curl -c cookies.txt -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD from .env>"}' http://localhost/api/auth/login`
> (see [API.md → Authentication](API.md#authentication)).

```bash
curl -b cookies.txt -X PUT http://localhost/api/projects/abc123/password \
  -H "Content-Type: application/json" \
  -d '{"newPassword": "MySecurePassword123!"}'
```

**Update existing password:**
```bash
curl -b cookies.txt -X PUT http://localhost/api/projects/abc123/password \
  -H "Content-Type: application/json" \
  -d '{"currentPassword": "OldPassword123!", "newPassword": "NewPassword456!"}'
```

**Remove password protection:**
```bash
curl -b cookies.txt -X PUT http://localhost/api/projects/abc123/password \
  -H "Content-Type: application/json" \
  -d '{"currentPassword": "OldPassword123!", "removePassword": true}'
```

**Implementation details:**
- For **running containers**: writes override file via `docker exec`, then stop+start to apply
- For **stopped containers**: writes override file via `putArchive` API (applied on next start)
- The entrypoint script reads `/home/coder/.code-server-auth` to configure code-server auth mode
- Current password is required when changing or removing protection on already-protected workspaces

#### Protected Operations

Operations requiring password verification:
- **Workspace Access** - VS Code authentication prompt
- **Stop Workspace** - API requires password
- **Delete Workspace** - API requires password
- **Password Change/Remove** - Requires current password

```bash
# Stop protected workspace
curl -b cookies.txt -X POST http://localhost/api/projects/abc123/stop \
  -H "Content-Type: application/json" \
  -d '{"password": "MySecurePassword123!"}'
```

### Visual Security Indicators

- **Lock Icons** - Protected workspaces show lock symbols in the project list
- **Password Management Modal** - UI for setting, updating, or removing passwords (key icon button)
- **Password Prompts** - Clear authentication requirements for protected operations
- **Status Messages** - Security status in project lists

## Container Isolation

### Docker Security Configuration

```yaml
# Container security settings
services:
  workspace-${PROJECT_ID}:
    security_opt:
      - no-new-privileges:true    # Prevent privilege escalation
    user: "1000:1000"            # Non-root user execution
    read_only: false             # Development needs write access
    tmpfs:
      - /tmp:size=1G,noexec,nosuid,nodev
```

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'               # Maximum CPU cores
      memory: 4G                # Maximum RAM
      pids: 512                 # Maximum processes
    reservations:
      memory: 1G                # Guaranteed RAM
```

**Protection Against**:
- CPU exhaustion attacks
- Memory bombs
- Fork bombs
- Resource starvation

### File System Security

```yaml
volumes:
  # Each workspace has isolated storage
  - workspace_data_${PROJECT_ID}:/home/coder/project
  
tmpfs:
  # Temporary storage with security restrictions
  - /tmp:size=1G,noexec,nosuid,nodev
```

**Features**:
- **Isolated Storage** - Workspaces cannot access each other's files
- **Temporary File Restrictions** - No executable files in /tmp
- **Volume Encryption** - Host-level encryption support
- **Backup Isolation** - Separate backup policies per workspace

### VS Code Workspace Trust

The image switches VS Code's Workspace Trust off (`"security.workspace.trust.enabled": false`
in the user settings). Otherwise every new workspace opens in Restricted Mode, and Cline,
Claude Code for VS Code and other extensions only start after a click on "Trust".

What this means: the workspace folder counts as trusted. Settings in a cloned repository's
`.vscode/settings.json` apply, and extensions such as the Python extension may run tools or
interpreters that the repository configures. Automatic tasks stay off: `task.allowAutomaticTasks`
defaults to `off` and cannot be switched on by a repository. Such code runs as `coder` inside
the workspace container only, but it can read what is stored there (AI tool logins, the
workspace's Forgejo token). Do not open untrusted repositories in workspaces that hold
credentials, or switch the setting back on in your VS Code user settings.

### Network Isolation

Workspaces never share a network with the API server, and each proxy mode has
its own network:

| Network | Internal | Members |
|---------|----------|---------|
| `xares-control` | no | nginx, API server, Forgejo — **no workspaces** |
| `xares-aicoder-network` (external) | no | Direct workspaces (no proxy), nginx, Forgejo; squid/mitmproxy use it for internet access |
| `xares-internal` (`INTERNAL_NETWORK_SUBNET`) | yes | LLM Logging Proxy workspaces, mitmproxy, nginx, dnsmasq |
| `xares-security` (`SECURITY_NETWORK_SUBNET`) | yes | Security Proxy workspaces, squid, nginx, dnsmasq |

**What this enforces**:
- **API server unreachable from workspaces** - It sits only on `xares-control`; no workspace can resolve or reach `server:3000`.
- **No proxy hopping** - A Security Proxy workspace cannot use the unrestricted mitmproxy to bypass the whitelist, and Logging Proxy workspaces cannot reach squid. Squid only accepts clients from `SECURITY_NETWORK_SUBNET`.
- **No platform API via nginx** - nginx must share a network with every workspace to proxy code-server and app ports. `location /api/` therefore denies all workspace subnets (403). The API server generates the rules from the live Docker networks on every start (`/etc/nginx/dynamic/api-access.conf`). Requests that arrive through mitmproxy or squid are denied as well, because the proxies reach nginx from a workspace subnet.
- **Existing workspaces are migrated** - On start the API server moves every workspace to the network of its proxy mode, and `start` repairs containers whose network was recreated by `docker compose down/up`.

Still allowed on purpose: workspaces can reach each other's ports (also via nginx subdomains — clones require a password for that reason), the workspace UI and app subdomains through nginx, and Forgejo (direct workspaces, see "Git Server Credentials" below).

**Limitation — traffic relayed by the host.** nginx tells workspaces apart from legitimate clients by source address. The bridge gateway (e.g. `172.19.0.1`) stays allowed, because the host itself and Docker Desktop's port forwarding reach nginx from there (Docker on Linux does not list a gateway it assigned itself; the server then uses the subnet's first address, Docker's default). Anything a workspace can send *through the host's published port* therefore looks like a host request:
- **Docker Desktop**: `host.docker.internal:<HOST_PORT>` reaches nginx from the gateway — from direct workspaces and through mitmproxy. Binding `HOST_PORT` to `127.0.0.1` does not help there. Do not run untrusted participants on Docker Desktop.
- **Linux, Docker 28** (verified behaviour on Docker 28.5): requests to a gateway or host address keep the workspace's source address (403); internal networks (`xares-internal`, `xares-security`) cannot reach published host ports at all. Older Docker versions with the userland proxy can relay such requests from the gateway address. Mitigations: bind `HOST_PORT` to `127.0.0.1` when a reverse proxy on the same host fronts the platform, or block the workspace subnets from the host's published ports in the firewall (`DOCKER-USER`/`INPUT`).
- The public URL: any workspace with internet access (direct, LLM Logging Proxy, or Security Proxy if the platform's own domain is whitelisted) reaches the platform like any other client.

Since the admin login (see "Authentication") these paths only lead to the login: without a session the API answers `401`. The network rules remain as defense in depth.

## Network Security

### Outgoing Traffic Control — Dual Proxy Modes

XaresAICoder supports two proxy modes for controlling workspace outgoing traffic:

**Security Proxy (squid)** — Whitelist-only access for student workspaces:
- All traffic must pass through squid proxy with domain whitelist enforcement
- Unauthorized domains return `TCP_DENIED/403`
- Whitelist is dynamically managed via `PUT /api/whitelist` API
- Base domains (apt repos, VS Code extensions) always included

**LLM Logging Proxy (mitmproxy)** — Unrestricted access with recording for teacher workspaces:
- All traffic passes through mitmproxy (no blocking)
- Every accessed domain is recorded per workspace IP
- LLM API conversations are captured in full
- Recorded domains can be reviewed and applied as the Security Proxy whitelist

**Teacher-to-Student Workflow:**
1. Teacher creates workspace with LLM Logging Proxy (unrestricted)
2. Teacher works normally — installs packages, uses AI tools, browses docs
3. All accessed domains are recorded automatically
4. Teacher reviews recorded domains via UI (categorized by type)
5. Teacher applies selected domains as the global squid whitelist
6. Students create workspaces with Security Proxy — only whitelisted domains accessible

See [OUTGOING_PROXY.md](OUTGOING_PROXY.md) for detailed proxy configuration and [LLM_CONVERSATION_LOGGING.md](LLM_CONVERSATION_LOGGING.md) for domain recording details.

### Reverse Proxy Configuration

```nginx
# nginx security headers
add_header X-Frame-Options DENY;
add_header X-Content-Type-Options nosniff;
add_header X-XSS-Protection "1; mode=block";
add_header Referrer-Policy strict-origin-when-cross-origin;

# Workspace access control
location ~* ^/(?<workspace>[a-zA-Z0-9-]+)\.(?<domain>[^/]+)/ {
    # Validate workspace ID format
    if ($workspace !~ ^[a-zA-Z0-9]{12}$) {
        return 403;
    }
    
    proxy_pass http://workspace-$workspace:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

### Custom Subdomain Aliases — Security Considerations

The Aliases feature lets users map readable subdomains (e.g. `myapp.<domain>`) to workspace ports. This trades obscurity for usability and has two relevant security properties:

**Catch-all 404 for unknown hosts** — A `listen 80 default_server; server_name _; return 404;` block is installed so that any Host header which doesn't match a defined server (frontend, workspace UUID, workspace port subdomain, registered alias) gets a clean `HTTP 404 "Unknown subdomain..."`. This prevents:
- Scanners hitting the password-protected frontend on random `*.<domain>` Host headers
- A deleted alias silently falling back to the platform UI instead of indicating "this alias no longer exists"
- Confusion when a user mistypes the port in a workspace subdomain

**Per-alias Basic Auth** — Each alias can carry an `auth_basic` block with an htpasswd file at `/etc/nginx/dynamic/auth/<projectId>__<sub>.htpasswd`. **Strongly recommended for public-facing deployments**: a short, sprechende Subdomain like `myapp.example.com` is far easier to enumerate than a workspace UUID. Treat the alias as "shareable URL" only when the protected resource is intentionally public, or behind Basic Auth, or behind your organization's outer access layer.

- Passwords are hashed as `{SHA}<base64-sha1>` (universally supported by stock nginx). bcrypt is intentionally not used because the alpine-based nginx image doesn't guarantee bcrypt support; SHA1 with htpasswd is the safe baseline.
- The htpasswd file is written with mode `0644` so the nginx worker (running as `nginx` user) can read it. The file contains only the salted hash, never the plaintext password.
- Reserved subdomain names (`www`, `api`, `admin`, `git`, `forgejo`, `workshop`, …) are rejected at the API layer to prevent shadowing of system routes.
- Aliases are **not** copied when cloning workspaces (would break global uniqueness).

### Port Security

**Port Allocation**:
- **Dynamic Assignment** - Ports assigned per workspace
- **Range Restrictions** - Only allowed port ranges
- **Proxy-Only Access** - No direct port exposure
- **Automatic Cleanup** - Ports released when workspace stops

```javascript
// Port validation in server
const ALLOWED_PORTS = [3000, 5000, 8000, 8080, 4200, 9000];
const isValidPort = (port) => ALLOWED_PORTS.includes(parseInt(port));
```

### SSL/TLS (Production)

For production deployments with HTTPS:

```nginx
# SSL configuration
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;

# HSTS header
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

## Data Protection

### Data Classification

| Data Type | Location | Protection Level | Retention |
|-----------|----------|------------------|-----------|
| **Workspace Code** | Container volumes | Isolated | Until deletion |
| **API Keys** | Container environment | User-managed | Session-based |
| **Passwords** | Server disk (hashed) | Bcrypt hashed | Persistent |
| **System Logs** | Host filesystem | Standard | Configurable |
| **Git Repositories** | Forgejo volumes | Git server auth | Persistent |
| **Recorded Domains** | mitmproxy volume | Per-workspace IP | Until container reset |
| **LLM Conversations** | mitmproxy volume | Per-workspace IP | Until container reset |
| **Proxy Logs** | Squid volume | Per-workspace IP | Until container reset |

> **"Per-workspace IP" is a fixed address.** Proxy recordings (domains, LLM
> conversations, Squid logs) are partitioned by the workspace's container IP.
> Every proxied workspace gets a fixed IP when it is created (stored in
> `projects.json`, pinned in Docker), so it keeps its recordings across
> restarts. An address is only reused after its workspace was deleted; the new
> owner does not see the previous recordings (conversations are archived,
> domain records cleared, older Squid lines hidden). See
> [LLM_CONVERSATION_LOGGING.md](LLM_CONVERSATION_LOGGING.md#ip-to-project-mapping).

### Data Isolation

```bash
# Each workspace has separate data volumes
docker volume create workspace_data_abc123
docker volume create workspace_data_def456

# No cross-workspace access possible
docker run --volume workspace_data_abc123:/data workspace-abc123
docker run --volume workspace_data_def456:/data workspace-def456
```

### Backup Security

**Backup Strategy**:
- **Volume-Level Backups** - Isolated per workspace
- **User-Controlled** - Users responsible for their data
- **Git Integration** - Code backed up to Git repositories
- **No Platform Storage** - No persistent user data on platform

### Data Encryption

**At Rest**:
- Host filesystem encryption (user-configured)
- Docker volume encryption support
- Git repository encryption in Forgejo

**In Transit**:
- HTTPS for production deployments
- TLS for internal communication (optional)
- Encrypted Git operations over HTTPS

## Authentication

### Admin Login (Dashboard and API)

The dashboard and the whole platform API require an admin login: one shared
password (`ADMIN_PASSWORD` in `.env`, generated by `./deploy.sh` if missing).
Without it the API stays locked (`503`). Sessions are signed, HttpOnly,
SameSite=Strict cookies (7 days by default, `ADMIN_SESSION_HOURS`, at most 30);
the signing key lives in the data volume and is mixed with the password, so
changing the password ends all sessions. Ten failed logins per client within
15 minutes block further attempts. Behind a reverse proxy nginx takes the
client address from `X-Forwarded-For`, but only from the Docker host (network
gateways) and from `TRUSTED_PROXIES`; otherwise all users would share the
proxy's address and one person's typos would block everybody. A trusted
address can claim any client address, so `TRUSTED_PROXIES` must only list
proxies, and the published port should be bound to loopback when the proxy
runs on the same host (`HOST_PORT=127.0.0.1:<port>`). Without a proxy in
front, set `TRUSTED_PROXIES=none`: clients that reach nginx from a Docker
gateway (IPv6 clients forwarded by `docker-proxy`, older Docker with the
userland proxy, Docker Desktop) could otherwise choose their address and
dodge the limit. That gives no access to the API (the gateways are allowed
there anyway), but unlimited password guesses. An extra Basic Auth in
front of the dashboard is not needed. State-changing requests must come from the dashboard's
own origin (workspace apps on sibling subdomains are same-site and would
otherwise send the admin's cookie along).

Public without login: `/api/health`, the login endpoints and the workshop
participant endpoints. The workshop admin page accepts the dashboard session
or `WORKSHOP_ADMIN_PASSWORD`.

This closes the remaining path from section "Network Isolation": a request a
workspace relays through the host now reaches nginx, but the API answers
`401` without a session.

### Group Users (Roles)

Besides the admin, the admin can create group users (Users tab, `/api/users`),
e.g. for teachers who look after one class. A group user has a user name, a
password (bcrypt) and one or more project groups, and only sees the projects of
these groups. There they can open, rename, start and stop workspaces, edit
notes and set, change or remove the workspace password (`currentPassword` is
checked as for the admin; protected workspaces still need their password for
start/stop). Everything else is admin-only: creating, deleting, cloning,
moving projects between groups, aliases, proxy logs, LLM conversations,
recorded domains, the whitelist, user management, the workshop admin page.

How it is enforced:
- The session cookie carries the account (`admin` or the user's id) and, for
  group users, a version; the server checks both on every request against the
  current user list. Deleting a user or setting a new password ends their
  sessions at once; group changes apply to the next request.
- A middleware after the login check lets group users reach only an allowlist
  of endpoints (`403 FORBIDDEN_FOR_ROLE` otherwise). Project endpoints answer
  `404` for projects outside their groups, and the lists are filtered, so other
  groups' projects stay invisible.
- The dashboard hides what a group user may not do; that is convenience only,
  the server check is what counts.
- Logins share the rate limit (10 failures per client within 15 minutes); an
  unknown user name takes as long as a wrong password.

Limits:
- A group user sees the workspace URLs of their groups and can open them.
  Workspaces without a password are then open to them, like to everybody who
  knows the URL (see "Workspace Passwords").
- Renaming a group (sidebar or `PUT /api/projects/groups/:name`) carries the
  users along; moving a single project to another group changes who sees it.
- There is one admin account; group users cannot get admin rights.

### Workspace Passwords

In addition, workspaces can be protected individually:

```mermaid
graph TD
    A[User Access] --> B{Workspace Type}
    B -->|Unprotected| C[Direct Access]
    B -->|Protected| D[Password Required]
    D --> E{Valid Password?}
    E -->|Yes| F[VS Code Access]
    E -->|No| G[Access Denied]
    F --> H[Password can be changed/removed at any time]
    C --> I[Password can be added at any time]
```

### Git Server: One Forgejo Account per Workspace

The Forgejo admin account (`GIT_ADMIN_USER`/`GIT_ADMIN_PASSWORD`) stays on the
API server. Every workspace gets its own Forgejo user (`<project-slug>-<8 hex of
the project ID>`, profile visibility *private*) and an access token limited to
it (`write:repository`, `write:user`), passed in as `FORGEJO_USER` /
`FORGEJO_TOKEN` and used in its remote URLs. Older code-server images read
`GIT_ADMIN_USER`/`GIT_ADMIN_PASSWORD`, so these carry the same workspace values.

- Repositories created by the platform or `setup_local_remote` are **private**
  and belong to the workspace user. A workspace cannot read, push to or even see
  the repositories of other workspaces, and its token cannot use the admin API
  or sign in to the web UI.
- **Clones** get their own user and their own private repository with the
  source's state and history — no shared repository any participant could
  overwrite.
- **Deleting a workspace** revokes its token; user and repositories stay. To
  continue, create a workspace from the repository URL
  (`<base>/git/<user>/<repo>.git`): the new workspace user is added as
  collaborator automatically.
- Administrators sign in to `/git/` with the admin account and see everything.
  The admin account must be a Forgejo administrator (the server creates users,
  tokens and repositories); see `.env.example`.
- `./deploy.sh` replaces the well-known default password `admin123!` once with
  a random one; `./deploy.sh --rotate-git-password` sets a new one at any time.
- **Nothing visible without a login** (`GIT_REQUIRE_SIGNIN_VIEW`, default
  `true`, Forgejo's `REQUIRE_SIGNIN_VIEW`): explore pages, profiles,
  repositories and the API need a signed-in user or a token; anonymous visitors
  only get the start page, the login page and `/api/healthz`. Without it,
  repositories created as public before the per-workspace accounts (owned by
  the admin account) are readable by anybody who reaches `/git/`, e.g. once
  no Basic Auth is in front of the platform.

**Upgrade from earlier versions:** workspaces created before carried the admin
password in their environment and in `.git/config`. On the first start of the
new server every workspace gets its own user; when its container runs, its
repositories are transferred to that user and the remote URLs switch to its
token (a clone that pointed at its source gets an own copy instead). Old
containers keep the admin password in their environment until they are
recreated — the password rotation makes it worthless. Repositories that were
public stay public, but are hidden from other workspace users because the
owning user is private.

Verification — from inside a workspace, all must fail:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -u "$FORGEJO_USER:$FORGEJO_TOKEN" http://forgejo:3000/api/v1/admin/users        # 403
curl -s -o /dev/null -w '%{http_code}\n' -u "$FORGEJO_USER:$FORGEJO_TOKEN" http://forgejo:3000/api/v1/repos/<other>/<repo> # 404
git push http://$FORGEJO_USER:$FORGEJO_TOKEN@forgejo:3000/<other>/<repo>.git   # repository not found
```

Not reachable from Security/Logging Proxy workspaces: Forgejo is not on their
internal networks (unchanged).

### VS Code Authentication

Protected workspaces use VS Code's built-in authentication, controlled by the entrypoint script which reads an optional override file:

```bash
# /home/coder/.code-server-auth (written by password management API)
AUTH_FLAG=password          # or "none" to remove protection
export PASSWORD='secret'    # set when AUTH_FLAG=password
```

### Workspace Password Checks in the API

In addition to the login (admin or group user), API endpoints respect workspace protection:
- **Stop/Delete** operations require the workspace password in the request body
- **Password management** (`PUT /api/projects/:id/password`) requires current password when changing/removing
- **Adding** a password to an unprotected workspace does not require authentication
- Returns `401 Unauthorized` for invalid passwords

## Best Practices

### For Users

#### 1. Workspace Security
```bash
# Always use strong passwords for sensitive projects
{
  "passwordProtected": true,
  "password": "MyVerySecurePassword123!@#"
}

# Regularly backup important code to Git
git add .
git commit -m "Regular backup"
git push origin main

# Don't store secrets in code
echo "API_KEY=secret" >> .env
echo ".env" >> .gitignore
```

#### 2. API Key Management
```bash
# Store API keys as environment variables, not in code
export OPENAI_API_KEY=your_key_here

# Use different keys for different projects
export PROJECT_A_KEY=key1
export PROJECT_B_KEY=key2

# Monitor API usage regularly
# Check provider dashboards for unusual activity
```

#### 3. Network Security
```bash
# Bind development servers to all interfaces for port forwarding
# Flask
app.run(host='0.0.0.0', port=5000)

# Node.js
app.listen(3000, '0.0.0.0')

# Spring Boot
server.address=0.0.0.0
```

### For Administrators

#### 1. Platform Hardening
```bash
# Regular security updates
apt update && apt upgrade -y

# Monitor Docker security
docker system events

# Regular log review  
docker compose logs | grep -i error
```

#### 2. Resource Monitoring
```bash
# Monitor resource usage
docker stats

# Check for suspicious activity
docker ps -a | grep -E "(restart|exit)"

# Monitor network connections
netstat -tulpn | grep docker
```

#### 3. Backup Strategy
```bash
# Regular platform backups
docker compose down
tar -czf xaresaicoder-backup.tar.gz .

# Database backups (if using external DB)
pg_dump xaresaicoder > backup.sql
```

## Security Configuration

### Environment Variables

```bash
# Security-related environment variables
MAX_WORKSPACES_PER_USER=5          # Resource limits
DOCKER_NETWORK=xares-aicoder-network # Network isolation

# Production security
FORCE_HTTPS=true                    # Redirect HTTP to HTTPS
SECURE_COOKIES=true                 # HTTPS-only cookies
DISABLE_TELEMETRY=true             # No external telemetry
```

### Docker Compose Security

```yaml
# Security-focused docker-compose.yml
version: '3.8'
services:
  server:
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_ADMIN  # Only if needed
    
  nginx:
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN      # Only if needed
      - DAC_OVERRIDE
```

### Firewall Configuration

```bash
# UFW configuration for production
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow ssh

# Allow HTTP/HTTPS
ufw allow 80
ufw allow 443

# Enable firewall
ufw enable
```

## Monitoring

### Security Monitoring

```bash
# Monitor failed authentication attempts
docker compose logs server | grep -i "invalid password"

# Monitor resource usage
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Monitor network connections
ss -tulpn | grep docker
```

### Log Analysis

```bash
# Security-relevant log patterns
grep -E "(failed|error|unauthorized)" /var/log/auth.log

# Docker security events
docker system events --filter type=container --filter event=die

# Application security logs
docker compose logs | grep -E "(401|403|error)"
```

### Automated Monitoring

```bash
#!/bin/bash
# security-monitor.sh

# Check for unusual container activity
CONTAINER_COUNT=$(docker ps -q | wc -l)
if [ $CONTAINER_COUNT -gt 20 ]; then
  echo "Alert: High container count: $CONTAINER_COUNT"
fi

# Check for high resource usage
HIGH_CPU=$(docker stats --no-stream --format "{{.CPUPerc}}" | sed 's/%//' | awk '$1 > 80')
if [ ! -z "$HIGH_CPU" ]; then
  echo "Alert: High CPU usage detected"
fi

# Check for failed authentications
FAILED_AUTH=$(docker compose logs server | grep -c "Invalid password")
if [ $FAILED_AUTH -gt 10 ]; then
  echo "Alert: Multiple authentication failures: $FAILED_AUTH"
fi
```

## Incident Response

### Security Incident Types

1. **Unauthorized Access** - Someone accessing protected workspace
2. **Resource Abuse** - Excessive CPU/memory usage
3. **Container Escape** - Attempt to break container isolation
4. **Data Breach** - Unauthorized access to workspace data
5. **API Abuse** - Excessive API requests or attacks
6. **Proxy Bypass** - Workspace attempting to bypass proxy restrictions
7. **Whitelist Abuse** - Unauthorized whitelist modifications

### Response Procedures

#### 1. Immediate Response
```bash
# Stop all containers
docker compose down

# Review logs
docker compose logs > incident-logs.txt

# Check system integrity
docker system df
docker system info
```

#### 2. Investigation
```bash
# Analyze container activity
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}"

# Check network connections
netstat -tulpn | grep docker

# Review authentication logs
grep -i "password" docker-compose-logs.txt
```

#### 3. Containment
```bash
# Remove suspicious workspaces
docker rm -f suspicious-container-id

# Reset workspace passwords
# (Requires manual intervention through API)

# Update security configurations
nano .env  # Update security settings
```

#### 4. Recovery
```bash
# Clean system
docker system prune -a

# Rebuild with security updates
./deploy.sh --build-only

# Restore from backups if needed
tar -xzf backup.tar.gz
```

### Reporting

Document security incidents with:
- **Timeline** - When incident occurred
- **Impact** - What was affected
- **Root Cause** - How it happened
- **Response** - Actions taken
- **Prevention** - Future mitigation steps

---

[← Back to AI Tools](AI_TOOLS.md) | [Next: Troubleshooting →](TROUBLESHOOTING.md)