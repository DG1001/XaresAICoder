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

**Login and client addresses:**
- The dashboard has its own login (admin and group users, see [API.md](API.md#login-and-roles)).
  An extra Basic Auth in front of the main domain is not needed and would make group users
  log in twice. Forgejo under `/git/` shows nothing without a login either
  (`GIT_REQUIRE_SIGNIN_VIEW`, default `true`).
- Ten wrong passwords within 15 minutes block the login per client. Behind the external
  nginx every request comes from the proxy, so XaresAICoder's nginx takes the client address
  from `X-Forwarded-For` (the `$proxy_add_x_forwarded_for` line above is required). A proxy on
  the Docker host itself is trusted automatically (it arrives from a Docker network gateway).
  For a proxy on another machine, list its address in `TRUSTED_PROXIES` in `.env`
  (IP addresses or CIDR ranges) and restart the server.
- Bind `HOST_PORT` to loopback (`HOST_PORT=127.0.0.1:8080`) so that nobody can bypass the
  external nginx (see [SECURITY.md](SECURITY.md#admin-login-dashboard-and-api)).

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

# Deploy with integrated Git server
./deploy.sh --git-server

# Deploy with network access control (educational/enterprise)
./deploy.sh --enable-proxy

# Deploy with both Git server and proxy
./deploy.sh --git-server --enable-proxy

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
- **No reverse proxy in front** (clients reach the published port directly): set
  `TRUSTED_PROXIES=none` in `.env`, so nobody can choose their client address to dodge the
  login limit (see [SECURITY.md](SECURITY.md#admin-login-dashboard-and-api))

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

## Pinned versions

Service images and Dockerfile bases are pinned so a rebuild produces the same stack:
`nginx:1.29.0-alpine`, `codeberg.org/forgejo/forgejo:9.0.3`, `mitmproxy/mitmproxy:12.2.1`
(in `docker-compose.yml`), `andyshinn/dnsmasq` and `ubuntu/squid` by digest (no version
tag matches the builds in use), `codercom/code-server:4.141.0`, and `node:22-alpine`
for the API server (major pinned, patch updates come with rebuilds). To update, change
the version, redeploy and test. The AI tools are not pinned: each image build installs
their latest releases. Inside a workspace nothing updates automatically, so all workspaces
created from one image share the same versions; `update_ai_agents` updates them on demand
(no sudo).

## Logs

- **Docker logs** of every service and every workspace are rotated by size: at
  `LOG_MAX_SIZE` (default `10m`) a new file starts, `LOG_MAX_FILE` (default `3`) files
  are kept. Workspaces created before this setting keep unlimited logs until they are
  recreated.
- **Squid** writes `access.log` and `cache.log` to the volume `squid_logs`. They are
  rotated daily (earlier at 100 MB) and kept compressed for 14 days
  (`squid/logrotate.conf`, run hourly inside the container). The proxy log viewer shows
  the current `access.log` only.
- **LLM conversations and recorded domains** (volume `mitmproxy_logs`) are data, not
  logs: they are kept until deleted in the dashboard. Conversations of an earlier
  workspace on a reused IP address move to `llm_conversations/_archive/`.

## Backup and Restore

`./backup.sh` saves what is needed to rebuild the platform: `.env` (secrets), the proxy
CA in `squid/certs` (every workspace image trusts it) and the volumes `workspace_data`,
`forgejo_data`, `nginx_dynamic`, `squid_whitelist` and `mitmproxy_logs`. Forgejo is
stopped for a few seconds while its volume is copied (SQLite and Git repositories are
only consistent at rest); Git is unreachable meanwhile.

```bash
./backup.sh                       # → backups/xares-YYYYmmdd-HHMMSS/, keeps the newest 7
./backup.sh --keep 14             # keep 14 (0 = keep all)
./backup.sh --dir /mnt/backup     # other target directory
./backup.sh --workspaces          # also the files of every workspace
```

Backups contain secrets (`.env`, the CA key, AI tool logins with `--workspaces`): the
directory is created with mode 700; copy it off the host to an equally protected place.
`backups/` is in `.gitignore`.

**Workspaces** have no volumes; their files live in the container. With
`--workspaces`, `/workspace` and `/home/coder` of every workspace (also stopped ones)
are saved, without caches (`~/.cache`, `~/.npm`, cached extension packages), VS Code
extensions and the OpenCode binary (both come with the image), and without the
workspace's code-server login. Packages installed system-wide (`sudo apt install`) are
not included. This takes a while: about 8 minutes and 1.2 GB for 27 workspaces on the
reference machine.

**Nightly via cron:**

```bash
0 3 * * * cd /path/to/XaresAICoder && ./backup.sh >> backups/backup.log 2>&1
```

The exit code is non-zero if anything failed, including single workspaces (listed in
`workspaces/FAILED` of the backup).

### Restoring the platform

```bash
./backup.sh --restore backups/xares-20261019-030000
```

Stops the platform containers (workspaces keep running), saves the current state to
`backups/xares-<time>-before-restore` (not removed by `--keep`), restores `.env`, CA
and volumes, and starts the platform again. If `.env` or the CA changed, it is not
started; run `./deploy.sh` instead (without `--skip-build` if the CA changed, so the
code-server image trusts it again).

**New host:** clone the repository, copy the backup over, run
`./backup.sh --restore <backup>` (creates the volumes), then `./deploy.sh`. The projects
are listed again, but their containers do not exist on the new host: create new
workspaces and copy the files in (below).

### Restoring workspace files

```bash
./backup.sh --restore-workspace backups/xares-20261019-030000 <project-id>
./backup.sh --restore-workspace backups/xares-20261019-030000 <old-id> --into <new-id>
```

Copies `/workspace` and `/home/coder` from the backup into the workspace container
(stopped meanwhile if running). Files with the same name are overwritten, other files
stay. `workspaces/index.tsv` in the backup lists project IDs and names. With `--into`,
the new workspace keeps its own password and Git account; Git remotes copied from the
old workspace still point to its repository.

## Upgrading Existing Installations

The security hardening (packages 1 and 2, see `docs/DEVLOG.md`) changes how the
platform is accessed. Before upgrading:

1. **Back up** the volumes `xaresaicoder_workspace_data`, `xaresaicoder_forgejo_data`,
   `xaresaicoder_mitmproxy_logs` and your `.env`.
2. **Deploy with `./deploy.sh`** (not a bare `docker compose up`): it generates
   `ADMIN_PASSWORD`, checks the new network subnet, rotates the default Forgejo admin
   password and builds the images. Rebuild the code-server image (no `--skip-build`)
   so `setup_local_remote` works with per-workspace Git accounts. Unattended (script,
   cron): `./deploy.sh --skip-env --rebuild` with your feature flags.

What changes:

| Area | Change | Action |
|------|--------|--------|
| Dashboard / API | Admin login required; without `ADMIN_PASSWORD` the API is locked (503) | Use the password `deploy.sh` prints (also in `.env`); scripts log in once and send the cookie (`curl -c/-b cookies.txt`, see API.md) |
| Networks | API server only on `xares-control`; Security Proxy workspaces move to the new internal network `xares-security` (`SECURITY_NETWORK_SUBNET`, default `172.31.0.0/16`) | Nothing — workspaces are moved automatically on server/workspace start |
| Proxy IPs | Proxied workspaces get fixed IPs; logs stay with the workspace | Stopped workspaces get a new address; their older recordings are not linked to them |
| Forgejo | Every workspace gets its own Forgejo user and token, repositories private; the default admin password `admin123!` is replaced | Log in to `/git/` with `GIT_ADMIN_USER` / `GIT_ADMIN_PASSWORD` from `.env`; repositories move to the workspace users when each workspace runs next |
| Clones | Credentials are stripped from snapshots; a clone password is required; each clone gets its own repository | Pass `password` when cloning via API; tick "Copy AI tool logins" if participants should share the teacher's AI logins |
| Workspaces | Hard CPU limit, Docker's default seccomp profile, sudo chosen per workspace (default `WORKSPACE_SUDO_ENABLED`) | Applies to new and recreated workspaces only |
| Workshop admin | Dashboard session or `X-Admin-Password` header (never in the URL) | — |
| Protected workspaces | API calls for clone, aliases, ports, logs, documentation need `X-Workspace-Password` | Update scripts |
| Whitelist | IP addresses, URLs and single labels are rejected; the applied whitelist now lives on the volume `squid_whitelist` and survives redeploys | Re-apply your whitelist once after the upgrade (it was reset by every deploy before); delete the volume to return to the default |
| `deploy.sh` flags | Feature flags are sticky: `--git-server` / `--enable-proxy` switch on, the new `--disable-git-server` / `--disable-proxy` switch off; without a flag the `.env` value is kept. `--skip-env` only skips the interactive part: flags, the proxy subnet check and `HOST_PORT` still apply (it used to ignore the flags) | Scripts that relied on "no flag = off" must pass `--disable-…` |
| Images | Server on Node 22 with `npm ci`; nginx, Forgejo, mitmproxy, squid, dnsmasq and the code-server base are pinned to fixed versions (see "Pinned versions") | Nothing; updates happen deliberately by editing the version |
| Forgejo secret key | The compose file shipped a public placeholder as `SECRET_KEY`; `deploy.sh` now generates `FORGEJO_SECRET_KEY` | Everybody is logged out of the Forgejo web UI once; 2FA, push mirrors and Actions secrets set up before must be set up again. Without `deploy.sh`, set `FORGEJO_SECRET_KEY` in `.env` (compose refuses to start otherwise) |
| Logs | Docker logs limited to `LOG_MAX_SIZE` × `LOG_MAX_FILE` (default 10 MB × 3); squid logs rotated daily, 14 days kept (see "Logs") | Existing workspaces keep unlimited Docker logs until recreated |
| Backups | New `./backup.sh` with restore (see "Backup and Restore") | Set up a nightly cron job |
| `.env` | `deploy.sh` makes it readable by its owner only (`chmod 600`); without a terminal (CI, cron, `</dev/null`) every prompt takes its default instead of ending the script silently | Tools reading `.env` must run as its owner |
| AI tools | Removed Continue, Aider and Qwen Code; added GitHub Copilot CLI and the VS Code extensions Cline, Kilo Code and Claude Code; OpenCode 2. CLI tools in `/opt/ai-tools` (owned by `coder`), one `update_ai_agents` without sudo, no automatic updates (see [AI_TOOLS.md](AI_TOOLS.md)) | Rebuild the code-server image (`./deploy.sh` without `--skip-build`); existing workspaces keep their old tools until recreated. The applied Security Proxy whitelist stays: add `.githubcopilot.com`, `.kilo.ai`, `.cline.bot` if those tools are used |
| VS Code Workspace Trust | Switched off in the image (new workspaces no longer open in Restricted Mode; see [SECURITY.md](SECURITY.md#vs-code-workspace-trust)) | Rebuild the code-server image. Existing workspaces keep the prompt until recreated; click "Trust" there once |
| Kilo Code | No longer pre-installed (about 550 MB in the image, about 350 MB RAM per workspace even when idle); users install it with `code-server --install-extension kilocode.kilo-code` where wanted | Rebuild the code-server image. Existing workspaces keep Kilo until recreated; remove it there with `code-server --uninstall-extension kilocode.kilo-code` and reload the window |
| Login / group users | Group users with their own login, limited to the projects of their groups (Users tab, `/api/users`, see [API.md](API.md#group-user-permissions)); the session cookie now names the account | Everybody logs in once more after the update (older sessions are no longer valid). `{"password": …}` logins of scripts keep working |
| Remote URLs on screen | `info`, `setup_local_remote` and the server log print Git remote URLs without the Forgejo token | Rebuild the code-server image; existing workspaces keep the old scripts until recreated |
| Forgejo without login | Anonymous visitors see nothing in Forgejo (`GIT_REQUIRE_SIGNIN_VIEW=true`): no explore pages, profiles, public repositories or API; workspaces use their tokens and are not affected | Applied when `./deploy.sh` recreates Forgejo. Anonymous `git clone` of public repositories stops working: set `GIT_REQUIRE_SIGNIN_VIEW=false` in `.env` if they are meant to be public |
| Unattended updates and other hosts | `deploy.sh --rebuild` rebuilds the code-server image without asking (without a terminal the question answers "no", so an update via script kept the old image); `setup-network.sh` keeps an existing `xares-aicoder-network` on an alternative subnet instead of asking to recreate it (the question ended unattended deploys); the fixed addresses of nginx and mitmproxy on `xares-internal` come from `.env` (`NGINX_INTERNAL_IP`, `MITMPROXY_IP`), written by `deploy.sh` together with the subnet; scripts start with `#!/usr/bin/env bash`; `deploy.sh` checks for `openssl` before generating the proxy CA | Nothing. On a non-default `INTERNAL_NETWORK_SUBNET` the next `./deploy.sh` adds the two addresses; a `docker-compose.yml` edited by hand for that can go back to the original |
| Stopping workspaces | `POST /api/projects/:id/stop` answers `202` right away and the stop runs on the server (status `stopping`, visible to every client and after a reload); a failed stop stays on the workspace as `lastError` and in the dashboard; when Docker reports a timeout although the container stops, the server checks again before reporting a failure | Scripts that expect the container to be stopped when the call returns add `?wait=true` (answers `200` afterwards, as before) |
| LLM conversations | `GET /api/projects/:id/llm-conversations` returns summaries without bodies (with `total`); the complete capture comes from `GET …/llm-conversations/:file`; `?full=true` keeps the old list; nginx compresses JSON from the API | Scripts that read bodies from the list add `full=true` or fetch single captures |
| Login behind a reverse proxy | nginx takes the client address from `X-Forwarded-For` of a proxy on the Docker host or in `TRUSTED_PROXIES`, so the login limit applies per client instead of to everybody at once; sessions last 7 days instead of 12 hours | The external nginx must send `X-Forwarded-For` (see [Production with External SSL Proxy](#3-production-with-external-ssl-proxy)); a Basic Auth in front of the dashboard can go. Without a reverse proxy in front, set `TRUSTED_PROXIES=none` (see [SECURITY.md](SECURITY.md#admin-login-dashboard-and-api)). An `.env` with `ADMIN_SESSION_HOURS=12` keeps 12 hours: change or remove the line |

Old workspace containers keep the previous environment (incl. the rotated, now useless
Forgejo admin password) until they are recreated; `setup_local_remote` works in them
again only after recreation.

**Remaining limits** (details in [SECURITY.md](SECURITY.md)): one admin account (group
users only see their groups); workspaces can reach each other's ports; Security/Logging Proxy
workspaces cannot reach Forgejo; on Docker Desktop workspaces reach published host ports
via `host.docker.internal` (the login still applies).

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

> The API needs the admin login. Log in once with curl and reuse the cookie:
> `curl -c cookies.txt -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD from .env>"}' http://localhost/api/auth/login`
> (see [API.md → Authentication](API.md#authentication)).

```bash
# API health (replace with your domain:port)
curl http://localhost/api/health
curl http://dev.mycompany.internal:8000/api/health
curl https://coder.sensem.de/api/health

# List projects
curl -b cookies.txt http://localhost/api/projects/

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
- **Network Access Control**: See `OUTGOING_PROXY.md` for configuring network restrictions and monitoring
- **Network Issues**: See `NETWORK_TROUBLESHOOTING.md` for detailed network guidance
- **Credential Management**: See `CREDENTIAL_MANAGEMENT.md` for Git and AI tool integration

## 🚀 Management Commands

After deployment, use these commands:

```bash
# View logs
docker compose logs        # or docker-compose logs
docker compose logs server # specific service

# Restart services (keeps existing image — does NOT apply code changes)
docker compose restart     # or docker-compose restart

# Apply code changes: rebuild image AND recreate container
docker compose build server && docker compose up -d server
# ⚠️  'restart' alone is NOT enough after code changes — it reuses the old image
# Always use 'up -d' after a build to recreate the container with the new image.
# The deploy script (./deploy.sh) handles this correctly automatically.

# Update deployment  
git pull
./deploy.sh --skip-network  # preserves existing network

# Complete reset
docker compose down
docker system prune -f
./deploy.sh
```