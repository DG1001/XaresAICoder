# XaresAICoder Network Troubleshooting Guide

## Overview

XaresAICoder uses a persistent external Docker network to ensure workspace containers can be restarted after the main application restarts. This guide covers network setup, troubleshooting, and recovery procedures.

## Network Architecture

```
External Network: xares-aicoder-network (persistent)
├── nginx container (proxy/routing)
├── server container (API backend)  
└── workspace-* containers (user workspaces)
```

## Quick Setup

### 1. First Time Setup
```bash
# Create the persistent network
./setup-network.sh

# Start XaresAICoder
docker-compose up -d
```

### 2. Verify Network Health
```bash
# Check if network exists
docker network ls | grep xares-aicoder-network

# Inspect network details
docker network inspect xares-aicoder-network

# Check connected containers
docker network inspect xares-aicoder-network --format '{{range $k,$v := .Containers}}{{printf "%s: %s\n" $k $v.Name}}{{end}}'
```

## Common Issues and Solutions

### Issue 1: "Workspace cannot be restarted" after coder restart

**Symptoms:**
- Workspace appears in project list
- Clicking restart fails with network errors
- Container exists but won't start

**Cause:** 
Container is orphaned (disconnected from network after `docker-compose down`)

**Solution:**
```bash
# Automatic recovery (handled by XaresAICoder)
# Just try to restart the workspace - recovery is automatic

# Manual recovery if needed
docker network connect xares-aicoder-network workspace-{project-id}
```

**Technical Details:**
XaresAICoder now automatically detects orphaned containers and reconnects them to the network before starting.

### Issue 2: "Network does not exist" error

**Symptoms:**
- XaresAICoder fails to start
- Console shows network errors
- Docker Compose fails

**Cause:**
External network hasn't been created

**Solution:**
```bash
# Create the network
./setup-network.sh

# Restart XaresAICoder
docker-compose up -d
```

### Issue 3: Network conflicts or wrong subnet

**Symptoms:**
- Network exists but with wrong configuration
- IP address conflicts
- Containers can't communicate

**Solution:**
```bash
# Check current network config
docker network inspect xares-aicoder-network

# If wrong, recreate network
docker network rm xares-aicoder-network
./setup-network.sh

# Restart everything
docker-compose down
docker-compose up -d
```

### Issue 4: Migration from old network system

**Symptoms:**
- Upgrading from older XaresAICoder version
- Containers using old prefixed network name
- Mixed network configurations

**Solution:**
```bash
# 1. Stop all services
docker-compose down

# 2. Create new external network
./setup-network.sh

# 3. Remove old network (if it exists)
docker network rm xaresaicoder_xares-aicoder-network 2>/dev/null || true

# 4. Start with new configuration
docker-compose up -d

# 5. Restart any existing workspaces (auto-recovery will handle network connection)
```

## Network Configuration Details

### Network Specifications
- **Name:** `xares-aicoder-network`
- **Driver:** `bridge`
- **Subnet:** `172.20.0.0/16`
- **Type:** External persistent network

### Container Network Settings
- **NetworkMode:** `xares-aicoder-network`
- **Aliases:** Each container gets an alias matching its name
- **DNS:** Automatic container-to-container DNS resolution

## Diagnostic Commands

### Check Network Status
```bash
# List all networks
docker network ls

# Detailed network inspection
docker network inspect xares-aicoder-network

# Check which containers are connected
docker network inspect xares-aicoder-network | jq '.Containers'
```

### Check Container Network Status
```bash
# List all workspace containers
docker ps -a --filter name=workspace- --format "table {{.Names}}\t{{.Status}}\t{{.Networks}}"

# Inspect specific container network
docker inspect workspace-{project-id} | jq '.[0].NetworkSettings.Networks'

# Test container connectivity
docker exec workspace-{project-id} ping server
```

### Network Health Check API
XaresAICoder provides an internal network health check:

```bash
# Access via API (if exposed)
curl http://localhost/api/system/network-health

# Or check container logs
docker-compose logs server | grep -i network
```

## Advanced Troubleshooting

### Complete Network Reset
If all else fails, perform a complete network reset:

```bash
# 1. Stop everything
docker-compose down

# 2. Stop all workspace containers
docker stop $(docker ps -q --filter name=workspace-)

# 3. Remove old network
docker network rm xares-aicoder-network 2>/dev/null || true

# 4. Create fresh network
./setup-network.sh

# 5. Restart XaresAICoder
docker-compose up -d

# 6. Workspace containers will auto-recover when restarted
```

### Manual Container Recovery
If automatic recovery fails:

```bash
# 1. Find orphaned containers
docker ps -a --filter name=workspace- | grep -v xares-aicoder-network

# 2. Connect each container manually
docker network connect xares-aicoder-network workspace-{project-id}

# 3. Start the container
docker start workspace-{project-id}
```

### Logging and Debugging
Enable detailed network logging:

```bash
# View Docker daemon logs
journalctl -u docker.service -f

# View container network logs
docker logs workspace-{project-id} 2>&1 | grep -i network

# View XaresAICoder network recovery logs
docker-compose logs server | grep -i "orphaned\|recovery\|network"
```

## Prevention Best Practices

### 1. Always Use setup-network.sh
```bash
# Include in deployment scripts
./setup-network.sh
docker-compose up -d
```

### 2. Monitor Network Health
```bash
# Add to monitoring scripts
docker network inspect xares-aicoder-network >/dev/null || {
    echo "Network missing, recreating..."
    ./setup-network.sh
}
```

### 3. Graceful Shutdown
```bash
# Proper shutdown sequence
docker-compose down  # This is safe with external networks
```

### 4. Backup Network Configuration
```bash
# Save network config for restore
docker network inspect xares-aicoder-network > network-backup.json
```

## Migration Guide

### From Docker Compose Managed to External Network

1. **Backup existing data:**
   ```bash
   docker-compose exec server cp -r /app/workspaces /tmp/backup/
   ```

2. **Stop services:**
   ```bash
   docker-compose down
   ```

3. **Update configuration:**
   ```bash
   git pull  # Get latest XaresAICoder with external network support
   ```

4. **Create external network:**
   ```bash
   ./setup-network.sh
   ```

5. **Start with new configuration:**
   ```bash
   docker-compose up -d
   ```

6. **Verify existing workspaces work:**
   - Workspaces should appear in the UI
   - Starting them should trigger automatic recovery
   - All data should be preserved

## API Endpoints for Network Management

XaresAICoder provides internal APIs for network management:

- `GET /api/system/network-health` - Check network status
- `POST /api/system/recover-orphans` - Manually trigger orphan recovery
- `GET /api/system/container-status` - List all containers and their network status

These are internal APIs primarily used for diagnostics and automated recovery.