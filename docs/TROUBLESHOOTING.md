# Troubleshooting Guide

Complete troubleshooting guide for XaresAICoder platform issues.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Installation Issues](#installation-issues)
- [Workspace Creation Problems](#workspace-creation-problems)
- [Container Management Issues](#container-management-issues)
- [Network and Connectivity](#network-and-connectivity)
- [Port Forwarding Problems](#port-forwarding-problems)
- [Password Protection Issues](#password-protection-issues)
- [Performance Problems](#performance-problems)
- [Git Server Issues](#git-server-issues)
- [AI Tools Problems](#ai-tools-problems)
- [System Recovery](#system-recovery)

## Quick Diagnostics

### Health Check Commands

```bash
# 1. Check system health
curl http://localhost/api/health

# 2. Check Docker status
docker info
docker compose ps

# 3. Check service logs
docker compose logs --tail=50

# 4. Check container resources
docker stats --no-stream

# 5. Check network connectivity
docker network inspect xares-aicoder-network
```

### Expected Healthy Output

```json
// Health check response
{
  "status": "ok",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "version": "4.2.0",
  "uptime": "2d 14h 22m"
}
```

```bash
# Docker compose status
NAME                    COMMAND                  SERVICE   STATUS    PORTS
xaresaicoder-nginx-1    "/docker-entrypoint.…"   nginx     running   0.0.0.0:80->80/tcp
xaresaicoder-server-1   "docker-entrypoint.s…"   server    running   3000/tcp
```

## Installation Issues

### Docker Not Found

**Symptoms**:
```bash
$ ./deploy.sh
deploy.sh: line 55: docker: command not found
```

**Solutions**:

1. **Install Docker**:
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   
   # Add user to docker group
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. **Verify Installation**:
   ```bash
   docker --version
   docker info
   ```

### Docker Compose Not Found

**Symptoms**:
```bash
[ERROR] Docker Compose is not available
```

**Solutions**:

1. **Docker Compose v2** (Recommended):
   ```bash
   # Usually included with Docker Desktop
   # Or install Docker Engine with Compose plugin
   sudo apt-get install docker-compose-plugin
   ```

2. **Docker Compose v1** (Legacy):
   ```bash
   sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

### Permission Denied Errors

**Symptoms**:
```bash
Got permission denied while trying to connect to the Docker daemon socket
```

**Solutions**:
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Apply group membership
newgrp docker

# Or run with sudo (not recommended for production)
sudo ./deploy.sh
```

### Network Overlap Errors

**Symptoms**:
```bash
Error response from daemon: Pool overlaps with other one on this address space
```

**Solutions**:
```bash
# 1. Check existing networks
docker network ls

# 2. Find conflicting subnet
docker network inspect bridge

# 3. Edit network configuration
nano setup-network.sh

# Change subnet from 172.19.0.0/16 to available range:
NETWORK_SUBNET="172.21.0.0/16"  # or 172.18.0.0/16

# 4. Remove old network and recreate
docker network rm xares-aicoder-network
./setup-network.sh
```

## Workspace Creation Problems

### Code-Server Image Missing

**Symptoms**:
```bash
Error: No such image: xares-aicoder-codeserver:latest
```

**Solutions**:
```bash
# Build the code-server image
cd code-server
docker build -t xares-aicoder-codeserver:latest .
cd ..

# Or use deploy script
./deploy.sh --build-only
```

### Workspace Creation Timeout

**Symptoms**:
- Workspace stuck in "creating" status
- No workspace URL returned after 60+ seconds

**Diagnosis**:
```bash
# Check for failed containers
docker ps -a | grep workspace-

# Check container logs
docker logs workspace-PROJECT_ID

# Check system resources
docker stats
df -h
```

**Solutions**:

1. **Resource Issues**:
   ```bash
   # Free up disk space
   docker system prune -a
   
   # Free up memory
   docker stop $(docker ps -q)
   docker system prune -f
   ```

2. **Network Issues**:
   ```bash
   # Restart Docker daemon
   sudo systemctl restart docker
   
   # Recreate network
   docker network rm xares-aicoder-network
   ./setup-network.sh
   ```

3. **Template Issues**:
   ```bash
   # Check template script logs
   docker logs workspace-PROJECT_ID | grep setup
   
   # Test template manually
   docker run -it xares-aicoder-codeserver:latest bash
   ```

### Java Spring Boot Slow Creation

**Symptoms**:
- Java projects take 30-60 seconds to create
- Other templates work fine

**Explanation**: This is normal behavior. Java Spring Boot template:
- Downloads Maven dependencies
- Compiles initial project
- Sets up comprehensive project structure

**Solutions**:
- Wait patiently (up to 2 minutes)
- Check logs: `docker logs workspace-PROJECT_ID`
- Monitor progress in VS Code terminal when it opens

## Container Management Issues

### Cannot Start Workspace

**Symptoms**:
```json
{
  "success": false,
  "error": "Failed to start workspace container"
}
```

**Diagnosis**:
```bash
# Check if container exists
docker ps -a | grep workspace-PROJECT_ID

# Check container status
docker inspect workspace-PROJECT_ID

# Try manual start
docker start workspace-PROJECT_ID
```

**Solutions**:

1. **Container Exited**:
   ```bash
   # Check exit reason
   docker logs workspace-PROJECT_ID
   
   # Remove and recreate
   docker rm workspace-PROJECT_ID
   # Then create new workspace through UI
   ```

2. **Resource Constraints**:
   ```bash
   # Check available resources
   docker system df
   free -h
   
   # Clean up unused resources
   docker system prune -a
   ```

3. **Network Issues**:
   ```bash
   # Check network connectivity
   docker network inspect xares-aicoder-network
   
   # Reconnect to network
   docker network disconnect xares-aicoder-network workspace-PROJECT_ID
   docker network connect xares-aicoder-network workspace-PROJECT_ID
   ```

### Cannot Stop Workspace

**Symptoms**:
- Stop button doesn't work
- API returns timeout error
- Container still running after stop command

**Solutions**:

1. **Force Stop**:
   ```bash
   # Force stop container
   docker stop workspace-PROJECT_ID --time 10
   
   # If still running, force kill
   docker kill workspace-PROJECT_ID
   ```

2. **Check for Stuck Processes**:
   ```bash
   # Check processes in container
   docker exec workspace-PROJECT_ID ps aux
   
   # Kill specific processes if needed
   docker exec workspace-PROJECT_ID pkill -f node
   docker exec workspace-PROJECT_ID pkill -f python
   ```

### Workspace Status Stuck

**Symptoms**:
- UI shows "creating" but workspace is running
- Status doesn't update after operations

**Solutions**:
```bash
# Refresh page and check API directly
curl http://localhost/api/projects/PROJECT_ID

# Check actual container status
docker ps | grep workspace-PROJECT_ID

# Restart API server if needed
docker compose restart server
```

## Network and Connectivity

### 502 Bad Gateway

**Symptoms**:
- nginx returns 502 error
- Cannot access main application or workspaces

**Diagnosis**:
```bash
# Check nginx logs
docker compose logs nginx

# Check if backend services are running
docker compose ps

# Check service connectivity
docker exec xaresaicoder-nginx-1 curl http://server:3000/api/health
```

**Solutions**:

1. **Backend Service Down**:
   ```bash
   # Restart server
   docker compose restart server
   
   # Check server logs
   docker compose logs server
   ```

2. **Network Issues**:
   ```bash
   # Restart all services
   docker compose down
   docker compose up -d
   
   # Check network connectivity
   docker network inspect xares-aicoder-network
   ```

3. **Configuration Issues**:
   ```bash
   # Check nginx configuration
   docker exec xaresaicoder-nginx-1 nginx -t
   
   # Reload nginx
   docker compose exec nginx nginx -s reload
   ```

### Service Unavailable (503)

**Symptoms**:
- HTTP 503 errors
- Services appear to be running

**Solutions**:
```bash
# Check service health
curl http://localhost/api/health

# Check resource usage
docker stats

# Check for memory/disk exhaustion
free -h
df -h

# Restart services if needed
docker compose restart
```

## Port Forwarding Problems

### VS Code Port Detection Not Working

**Symptoms**:
- Development server running but VS Code doesn't show port
- No "Open in Browser" notification

**Solutions**:

1. **Check VS Code Settings**:
   ```json
   // In workspace .vscode/settings.json
   {
     "remote.autoForwardPorts": true,
     "remote.portsAttributes": {
       "5000": {
         "label": "Flask App",
         "onAutoForward": "openBrowserOnce"
       }
     }
   }
   ```

2. **Manual Port Forwarding**:
   ```bash
   # In VS Code terminal
   # Start your application bound to all interfaces
   python app.py  # Flask
   npm run dev    # React/Vite
   mvn spring-boot:run  # Spring Boot
   ```

3. **Check Application Binding**:
   ```python
   # Flask - bind to all interfaces
   app.run(host='0.0.0.0', port=5000)
   
   # Not just localhost
   # app.run(host='127.0.0.1', port=5000)  # Wrong!
   ```

### Subdomain URLs Not Working

**Symptoms**:
- VS Code shows port forwarded but subdomain returns 404
- URLs like `projectid-5000.localhost` don't work

**Diagnosis**:
```bash
# Check nginx configuration
docker exec xaresaicoder-nginx-1 cat /etc/nginx/nginx.conf

# Check if nginx sees the subdomain request
docker compose logs nginx | grep projectid-5000

# Test container connectivity
docker exec xaresaicoder-nginx-1 curl http://workspace-projectid:5000
```

**Solutions**:

1. **DNS Resolution**:
   ```bash
   # Test local DNS resolution
   nslookup projectid-5000.localhost
   
   # Add to /etc/hosts if needed (usually not required)
   echo "127.0.0.1 projectid-5000.localhost" >> /etc/hosts
   ```

2. **Check Container Network**:
   ```bash
   # Verify container is on correct network
   docker inspect workspace-projectid | grep NetworkMode
   
   # Reconnect to network if needed
   docker network connect xares-aicoder-network workspace-projectid
   ```

3. **Application Configuration**:
   ```bash
   # Ensure app binds to all interfaces, not just localhost
   # Check in VS Code terminal:
   netstat -tuln | grep :5000
   
   # Should show 0.0.0.0:5000, not 127.0.0.1:5000
   ```

### Application Returns 404

**Symptoms**:
- Subdomain URL loads but application returns 404
- Application works in container terminal but not via browser

**Solutions**:

1. **Check Application Routes**:
   ```python
   # Flask example - ensure route handles all paths
   @app.route('/')
   @app.route('/<path:path>')
   def catch_all(path=''):
       return render_template('index.html')
   ```

2. **Check Base Path Configuration**:
   ```javascript
   // React/Vite - check base URL configuration
   // vite.config.js
   export default {
     base: '/',  // Ensure base is root
     server: {
       host: '0.0.0.0',
       port: 3000
     }
   }
   ```

3. **Check Proxy Headers**:
   ```python
   # Flask - handle proxy headers if needed
   from werkzeug.middleware.proxy_fix import ProxyFix
   app.wsgi_app = ProxyFix(app.wsgi_app)
   ```

## Password Protection Issues

### Cannot Access Protected Workspace

**Symptoms**:
- VS Code shows authentication prompt
- Correct password doesn't work
- Gets rejected repeatedly

**Solutions**:

1. **Password Case Sensitivity**:
   ```bash
   # Passwords are case-sensitive
   # Check exact password from creation response
   curl http://localhost/api/projects/PROJECT_ID
   ```

2. **Browser Cache Issues**:
   ```bash
   # Clear browser cache
   # Or use incognito/private mode
   # Or try different browser
   ```

3. **Container Restart Required**:
   ```bash
   # Restart workspace container
   docker restart workspace-PROJECT_ID
   
   # Wait for container to be ready
   curl http://PROJECT_ID.localhost/
   ```

### Invalid Password for Stop/Delete

**Symptoms**:
```json
{
  "success": false,
  "error": "Invalid password for password-protected workspace"
}
```

**Solutions**:

1. **Check Password in Request**:
   ```bash
   # Ensure password is in request body
   curl -X POST http://localhost/api/projects/PROJECT_ID/stop \
     -H "Content-Type: application/json" \
     -d '{"password": "correct-password-here"}'
   ```

2. **Check Workspace Protection Status**:
   ```bash
   # Verify workspace is actually password protected
   curl http://localhost/api/projects/PROJECT_ID
   # Look for "passwordProtected": true
   ```

3. **Server Memory Issues**:
   ```bash
   # Password might be lost if server restarted
   # Check server uptime
   curl http://localhost/api/health
   
   # If server restarted, workspace passwords are lost
   # Delete workspace and recreate if needed
   ```

## Performance Problems

### High Memory Usage

**Symptoms**:
- System becomes slow
- Out of memory errors
- Containers being killed

**Diagnosis**:
```bash
# Check memory usage
free -h
docker stats --no-stream

# Check which containers use most memory
docker stats --format "table {{.Container}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Check for memory leaks
docker system df
```

**Solutions**:

1. **Resource Cleanup**:
   ```bash
   # Clean unused containers and images
   docker system prune -a
   
   # Stop unused workspaces
   docker stop $(docker ps -q --filter "name=workspace-")
   ```

2. **Adjust Resource Limits**:
   ```yaml
   # Edit docker-compose.yml
   deploy:
     resources:
       limits:
         memory: 2G  # Reduce from 4G
   ```

3. **System Optimization**:
   ```bash
   # Increase swap if needed
   sudo fallocate -l 2G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

### High CPU Usage

**Symptoms**:
- System becomes unresponsive
- High load averages
- Containers using excessive CPU

**Solutions**:

1. **Identify CPU-Heavy Containers**:
   ```bash
   # Find high CPU containers
   docker stats --format "table {{.Container}}\t{{.CPUPerc}}"
   
   # Check processes in container
   docker exec CONTAINER_ID top
   ```

2. **Reduce CPU Limits**:
   ```yaml
   # Adjust in docker-compose.yml
   deploy:
     resources:
       limits:
         cpus: '1.0'  # Reduce from 2.0
   ```

3. **Check for Runaway Processes**:
   ```bash
   # Check for infinite loops or stuck processes
   docker exec workspace-PROJECT_ID ps aux
   
   # Kill problematic processes
   docker exec workspace-PROJECT_ID pkill -f problematic-process
   ```

### Slow Workspace Creation

**Symptoms**:
- Workspaces take very long to create
- Timeout errors during creation

**Solutions**:

1. **Pre-pull Images**:
   ```bash
   # Pre-pull base images to speed up creation
   docker pull node:18-alpine
   docker pull python:3.11-alpine
   docker pull openjdk:17-jdk-alpine
   ```

2. **Optimize Docker Build Cache**:
   ```bash
   # Rebuild with build cache
   docker build --cache-from xares-aicoder-codeserver:latest \
     -t xares-aicoder-codeserver:latest .
   ```

3. **Check Network Speed**:
   ```bash
   # Test internet connectivity for package downloads
   curl -o /dev/null -s -w "%{time_total}\n" https://registry.npmjs.org/
   ```

## Git Server Issues

### Forgejo Not Starting

**Symptoms**:
- Git server URLs return 502 error
- Forgejo container not running

**Diagnosis**:
```bash
# Check if Forgejo container is running
docker ps | grep forgejo

# Check Forgejo logs
docker compose logs forgejo

# Check if profile is enabled
grep ENABLE_GIT_SERVER .env
```

**Solutions**:

1. **Enable Git Server Profile**:
   ```bash
   # Ensure Git server is enabled
   echo "ENABLE_GIT_SERVER=true" >> .env
   
   # Deploy with Git server
   ./deploy.sh --git-server
   ```

2. **Check Volume Permissions**:
   ```bash
   # Check Forgejo data volume
   docker volume inspect xaresaicoder_forgejo_data
   
   # Fix permissions if needed
   docker run --rm -v xaresaicoder_forgejo_data:/data alpine \
     chown -R 1000:1000 /data
   ```

### Git Repository Creation Fails

**Symptoms**:
- Workspace creation succeeds but Git repo creation fails
- "createGitRepo": true but no repository created

**Solutions**:

1. **Check Forgejo API**:
   ```bash
   # Test Forgejo API connectivity
   curl -u developer:admin123! \
     http://localhost/git/api/v1/user
   ```

2. **Check Admin User**:
   ```bash
   # Verify admin user exists
   docker exec xaresaicoder-forgejo-1 \
     forgejo admin user list
   ```

3. **Manual Repository Creation**:
   ```bash
   # Create repository manually
   curl -u developer:admin123! -X POST \
     -H "Content-Type: application/json" \
     -d '{"name":"test-repo","private":false}' \
     http://localhost/git/api/v1/user/repos
   ```

## AI Tools Problems

### API Key Issues

**Symptoms**:
- AI tools return authentication errors
- "Invalid API key" messages

**Solutions**:

1. **Check Environment Variables**:
   ```bash
   # In workspace terminal
   echo $OPENAI_API_KEY
   echo $ANTHROPIC_API_KEY
   echo $GEMINI_API_KEY
   ```

2. **Set API Keys**:
   ```bash
   # Set in workspace
   export OPENAI_API_KEY=your_key_here
   export ANTHROPIC_API_KEY=your_key_here
   
   # Make permanent
   echo 'export OPENAI_API_KEY=your_key' >> ~/.bashrc
   ```

3. **Test API Connectivity**:
   ```bash
   # Test OpenAI API
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer $OPENAI_API_KEY"
   ```

### Tool Installation Issues

**Symptoms**:
- `command not found` errors for AI tools
- Setup scripts fail

**Solutions**:

1. **Reinstall Tools**:
   ```bash
   # Use built-in setup commands
   setup_aider
   setup_opencode
   setup_gemini
   ```

2. **Check PATH**:
   ```bash
   # Verify tools are in PATH
   which aider
   which opencode
   
   # Add to PATH if needed
   export PATH="$HOME/.local/bin:$PATH"
   ```

3. **Manual Installation**:
   ```bash
   # Install aider manually
   pip install aider-chat
   
   # Install OpenCode SST manually
   curl -sSL https://install.opencodesst.com | bash
   ```

## System Recovery

### Complete System Reset

**When to Use**:
- Multiple persistent issues
- Corrupted system state
- Major configuration problems

**Steps**:
```bash
# 1. Stop all services
docker compose down -v

# 2. Remove all containers and images
docker system prune -a

# 3. Remove networks
docker network prune

# 4. Remove volumes (WARNING: This deletes all workspace data)
docker volume prune

# 5. Clean repository
git clean -fd
git reset --hard HEAD

# 6. Fresh deployment
./deploy.sh
```

### Backup and Restore

**Before Major Changes**:
```bash
# Backup configuration
cp .env .env.backup
cp docker-compose.yml docker-compose.yml.backup

# Backup workspace data
docker run --rm -v xaresaicoder_workspace_data:/data \
  -v $(pwd):/backup alpine \
  tar czf /backup/workspace-backup.tar.gz /data

# Backup Git server data
docker run --rm -v xaresaicoder_forgejo_data:/data \
  -v $(pwd):/backup alpine \
  tar czf /backup/forgejo-backup.tar.gz /data
```

**Restore from Backup**:
```bash
# Restore configuration
cp .env.backup .env

# Restore workspace data
docker run --rm -v xaresaicoder_workspace_data:/data \
  -v $(pwd):/backup alpine \
  tar xzf /backup/workspace-backup.tar.gz -C /

# Restart services
docker compose up -d
```

### Getting Additional Help

1. **Check Logs First**:
   ```bash
   docker compose logs --tail=100
   ```

2. **System Information**:
   ```bash
   # Gather system info for support
   docker version
   docker compose version
   uname -a
   free -h
   df -h
   ```

3. **Create Support Bundle**:
   ```bash
   # Create comprehensive log bundle
   mkdir support-bundle
   docker compose logs > support-bundle/compose-logs.txt
   docker system info > support-bundle/docker-info.txt
   docker network ls > support-bundle/networks.txt
   docker volume ls > support-bundle/volumes.txt
   cp .env support-bundle/config.env
   tar czf support-bundle.tar.gz support-bundle/
   ```

4. **Community Support**:
   - GitHub Issues: Report platform-specific problems
   - Docker Documentation: For Docker-related issues
   - Tool-specific support: Check individual AI tool documentation

---

[← Back to Security](SECURITY.md) | [Next: Development Guide →](DEVELOPMENT.md)