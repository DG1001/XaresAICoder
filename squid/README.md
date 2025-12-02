# Squid Proxy Configuration

This directory contains the Squid transparent proxy configuration for XaresAICoder network access control.

## Overview

The Squid proxy provides:
- **Network access control**: Whitelist-based filtering of outgoing connections
- **HTTPS inspection**: Full URL visibility including HTTPS paths
- **Comprehensive logging**: Per-workspace audit trail of all requests
- **Flexible filtering**: Domain, URL path, regex, and HTTP method filtering

## Files

- `squid.conf` - Main Squid configuration with default whitelist
- `Dockerfile` - Squid container definition
- `generate-ca-cert.sh` - Script to generate SSL CA certificate
- `whitelist-minimal.conf` - Example minimal whitelist (package managers only)
- `whitelist-ai-dev.conf` - Example AI development whitelist (AI APIs + tools)
- `certs/` - SSL CA certificates (generated, not in Git)

## Quick Start

The proxy is automatically configured when you deploy with `--enable-proxy`:

```bash
./deploy.sh --enable-proxy
```

This will:
1. Generate SSL CA certificate (first run only)
2. Build Squid container with configuration
3. Configure workspace containers to use proxy
4. Enforce network isolation (workspaces cannot bypass proxy)

## Customizing the Whitelist

### Edit squid.conf

The main configuration file is `squid/squid.conf`. Look for the "Whitelist ACLs" section:

```squid
# ============================================
# Whitelist ACLs - CUSTOMIZE THESE
# ============================================
```

### Adding New Domains

To allow a new domain:

```squid
# Define ACL for the domain
acl my_service dstdomain example.com .example.com

# Allow access from workspace containers
http_access allow internal_network my_service
```

### Restricting to Specific URLs

To allow only specific paths within a domain:

```squid
# Allow only API endpoints
acl github_domain dstdomain github.com
acl github_api_paths urlpath_regex ^/api/

http_access allow internal_network github_domain github_api_paths
```

### Blocking Specific Patterns

To block specific URLs even on allowed domains:

```squid
# Block expensive AI models
acl expensive_models urlpath_regex gpt-4 claude-opus

# This must come BEFORE the allow rules
http_access deny expensive_models
```

### HTTP Method Filtering

To make domains read-only:

```squid
# Define read-only methods
acl http_methods_readonly method GET HEAD OPTIONS

# Allow only read-only access to documentation
acl docs_site dstdomain docs.example.com
http_access allow internal_network docs_site http_methods_readonly
```

## Example Configurations

### Python Development Course

Package managers + Python docs only:

```squid
# Package managers
acl pypi_domain dstdomain .pypi.org .pythonhosted.org
acl npm_domain dstdomain registry.npmjs.org
acl pypi_paths urlpath_regex ^/simple/ ^/packages/
acl npm_paths urlpath_regex ^/[^/]+$ ^/[^/]+/-/

# Documentation
acl docs_python dstdomain docs.python.org
acl http_methods_readonly method GET HEAD OPTIONS

# Allow access
http_access allow internal_network pypi_domain pypi_paths
http_access allow internal_network npm_domain npm_paths
http_access allow internal_network docs_python http_methods_readonly
http_access deny all
```

### Course-Specific GitHub Access

Allow only specific repositories:

```squid
# GitHub domain
acl github_domain dstdomain github.com .github.com

# Course repositories only
acl course_repos urlpath_regex ^/university-name/CS101-.*

# Allow only course repos
http_access allow internal_network github_domain course_repos
```

### AI APIs with Model Restrictions

Allow AI APIs but block expensive models:

```squid
# AI API domains
acl ai_openai dstdomain api.openai.com
acl ai_anthropic dstdomain api.anthropic.com

# Block expensive models (must come BEFORE allow rules)
acl expensive_models urlpath_regex gpt-4 claude-opus
http_access deny expensive_models

# Allow AI APIs
http_access allow internal_network ai_openai
http_access allow internal_network ai_anthropic
```

## Applying Configuration Changes

After editing `squid.conf`:

1. **Restart the proxy container**:
   ```bash
   docker-compose restart squid-proxy
   ```

2. **Or reload configuration** (without downtime):
   ```bash
   docker exec xaresaicoder-squid-proxy-1 squid -k reconfigure
   ```

3. **Verify configuration**:
   ```bash
   docker exec xaresaicoder-squid-proxy-1 squid -k parse
   ```

## Viewing Logs

### Real-Time Monitoring

```bash
# All traffic
docker-compose logs -f squid-proxy

# Specific workspace (replace with actual container IP)
docker exec xaresaicoder-squid-proxy-1 tail -f /var/log/squid/access.log | grep "172.18.0.5"

# Blocked requests only
docker exec xaresaicoder-squid-proxy-1 tail -f /var/log/squid/access.log | grep "TCP_DENIED"
```

### Access Log Format

```
timestamp duration source_ip status bytes method url user upstream content_type
```

Example:
```
1701234567.123 45 172.18.0.5 TCP_MISS/200 1543 GET https://pypi.org/simple/flask/ - HIER_DIRECT/151.101.0.223 text/html
```

### Per-Student Reports

Generate traffic report for a specific workspace:

```bash
WORKSPACE_IP="172.18.0.5"

# Total requests
docker exec xaresaicoder-squid-proxy-1 grep "$WORKSPACE_IP" /var/log/squid/access.log | wc -l

# Unique domains
docker exec xaresaicoder-squid-proxy-1 grep "$WORKSPACE_IP" /var/log/squid/access.log | \
  awk '{print $7}' | sed 's|https\?://||' | cut -d'/' -f1 | sort -u

# Blocked requests
docker exec xaresaicoder-squid-proxy-1 grep "$WORKSPACE_IP" /var/log/squid/access.log | \
  grep "TCP_DENIED"

# Data transferred (MB)
docker exec xaresaicoder-squid-proxy-1 grep "$WORKSPACE_IP" /var/log/squid/access.log | \
  awk '{sum+=$5} END {print sum/1024/1024 " MB"}'
```

## SSL Certificate Management

### Certificate Location

- **CA Certificate + Key**: `squid/certs/squid-ca-cert.pem` (used by Squid)
- **CA Certificate (CRT)**: `squid/certs/squid-ca-cert.crt` (trusted in workspaces)

### Regenerating Certificate

If you need to regenerate the SSL certificate:

```bash
# Delete existing certificate
rm -rf squid/certs/

# Regenerate
./squid/generate-ca-cert.sh

# Rebuild code-server image to trust new certificate
docker-compose build code-server

# Restart proxy
docker-compose restart squid-proxy
```

## Troubleshooting

### Workspace Cannot Access Internet

1. **Check proxy is running**:
   ```bash
   docker-compose ps squid-proxy
   ```

2. **Check workspace proxy configuration**:
   ```bash
   docker exec <workspace-container> env | grep PROXY
   ```
   Should show:
   ```
   HTTP_PROXY=http://squid-proxy:3128
   HTTPS_PROXY=http://squid-proxy:3128
   ```

3. **Check proxy logs for blocked requests**:
   ```bash
   docker-compose logs squid-proxy | grep TCP_DENIED
   ```

### SSL Certificate Errors

If workspaces show SSL certificate errors:

1. **Verify CA certificate is trusted**:
   ```bash
   docker exec <workspace-container> ls -la /usr/local/share/ca-certificates/
   ```

2. **Rebuild code-server image**:
   ```bash
   docker-compose build code-server
   ```

3. **Recreate workspace containers** (delete and create new)

### Allowed Domain Not Working

1. **Check Squid configuration syntax**:
   ```bash
   docker exec xaresaicoder-squid-proxy-1 squid -k parse
   ```

2. **Check ACL order** (deny rules must come before allow rules for same domain)

3. **Check logs for deny reason**:
   ```bash
   docker-compose logs squid-proxy | tail -100
   ```

4. **Test specific URL**:
   ```bash
   docker exec <workspace-container> curl -v -x http://squid-proxy:3128 https://example.com
   ```

## Security Considerations

### SSL Interception Privacy

- Squid can see ALL HTTPS traffic in plaintext (including API keys)
- Logs may contain sensitive information
- Follow institutional privacy policies
- Inform users that traffic is monitored

### Certificate Security

- Keep `squid/certs/squid-ca-key.pem` secure
- This key allows decryption of all workspace HTTPS traffic
- Do not commit to Git (already in .gitignore)
- Limit access to administrators only

### Log Retention

- Logs can grow large with many users
- Configure log rotation in production
- Example logrotate configuration:
  ```
  /var/log/squid/*.log {
      daily
      rotate 30
      compress
      delaycompress
      notifempty
      missingok
  }
  ```

## Further Reading

- **Squid Documentation**: http://www.squid-cache.org/Doc/
- **ACL Configuration**: http://www.squid-cache.org/Doc/config/acl/
- **SSL Bumping**: https://wiki.squid-cache.org/Features/SslBump
- **XaresAICoder Proxy Architecture**: `../docs/OUTGOING_PROXY.md`
