# Outgoing Network Proxy for XaresAICoder

## Executive Summary

This document outlines network security strategies for XaresAICoder deployments in educational and enterprise environments where workspace network access must be restricted and monitored. The recommended solution uses a transparent HTTP/HTTPS proxy (Squid) to enforce whitelist-based access control and provide comprehensive audit logging for accountability.

## Problem Statement

### Security Concerns

XaresAICoder provides isolated browser-based development environments with pre-installed AI coding assistants. While powerful for education and development, unrestricted internet access poses several risks:

1. **Unauthorized External Connections**: AI agents operating autonomously may make unexpected connections to external services
2. **Data Exfiltration**: Students or users could potentially send sensitive code or data to unauthorized external services
3. **Resource Abuse**: Unrestricted access to paid AI APIs could lead to cost overruns
4. **Academic Integrity**: Students might access unauthorized resources during assessments
5. **Compliance**: Educational institutions may have regulatory requirements for network monitoring and access control

### Use Cases

- **University Lectures**: 100+ students using AI coding environments simultaneously
- **Enterprise Training**: Corporate environments with strict data governance policies
- **Assessment Scenarios**: Controlled environments for coding examinations
- **Research Institutions**: Environments requiring audit trails for compliance

## Security Level Options

### Overview

Four security levels are available, each with different trade-offs between security, usability, and complexity:

| Level | Solution | Security | Usability | Complexity | Recommended For |
|-------|----------|----------|-----------|------------|-----------------|
| 1 | Airgapped | Highest | Lowest | Low | Maximum security, no internet needed |
| 2 | Whitelist Gateway | High | Medium | High | Few allowed services with strict isolation |
| 3 | Transparent Proxy | High | High | Medium | **Most educational/enterprise deployments** |
| 4 | Admin Approval | Highest | Lowest | Very High | Research environments, case-by-case review |

### Level 1: Airgapped Network

**Approach**: Workspaces operate on an internal Docker network with no internet access.

**Characteristics**:
- Complete network isolation from the internet
- Access only to internal resources (Git server, documentation server)
- No external API calls possible (AI tools must use local models)

**Advantages**:
- Maximum security - no data can leave the network
- Simple to implement (Docker network without gateway)
- No maintenance of whitelists or proxy rules

**Limitations**:
- AI coding assistants cannot access cloud APIs (OpenAI, Anthropic, Google)
- No access to external package repositories (npm, PyPI) - must use internal mirrors
- Cannot clone external Git repositories
- Limited to pre-installed tools and local models

**Best For**: Maximum security scenarios where all resources are internal (highly regulated industries, classified environments)

### Level 2: Whitelist Gateway Pattern

**Approach**: Dedicated gateway container for each allowed external service.

**Characteristics**:
- One container per allowed domain (github-gateway, pypi-gateway, openai-gateway)
- Each gateway only resolves DNS and forwards traffic for its specific domain
- Workspaces connect through gateway containers using custom DNS resolution

**Advantages**:
- Fine-grained control - enable/disable services by starting/stopping containers
- Strong isolation - compromise of one gateway doesn't affect others
- Clear audit trail per service

**Limitations**:
- High operational complexity - many containers to manage
- DNS resolution complexity for workspaces
- Difficult to add new allowed domains (requires new container deployment)
- Resource overhead (each gateway is a separate container)

**Best For**: Environments with a small, fixed set of allowed external services (typically 3-5 domains)

### Level 3: Transparent HTTP/HTTPS Proxy (Squid)

**Approach**: Single proxy container enforcing whitelist-based access control with comprehensive logging.

**Characteristics**:
- All workspace traffic routed through centralized Squid proxy
- Whitelist-based access control with flexible rules (domain, URL path, regex, HTTP methods)
- Full HTTP/HTTPS interception with SSL bumping for HTTPS inspection
- Comprehensive logging of all requests with source tracking
- Editable whitelist without container restarts

**Advantages**:
- **Recommended solution** - best balance of security, usability, and maintainability
- Flexible access control (can restrict by domain, URL path, or regex pattern)
- Comprehensive audit logging with per-student/workspace tracking
- Easy whitelist updates via configuration file
- Minimal performance impact
- Industry-standard technology (Squid)

**Limitations**:
- SSL interception requires certificate management (CA certificate must be trusted in workspaces)
- All HTTPS traffic is decrypted at proxy (privacy consideration)
- Single point of failure (proxy failure blocks all internet access)

**Best For**: Educational institutions, corporate training, enterprise deployments with 10-1000+ users

### Level 4: Interactive Admin Approval

**Approach**: Interactive proxy that prompts administrator to approve each new connection request.

**Characteristics**:
- Uses mitmproxy with custom approval script
- Each unique domain/URL requires real-time admin approval
- Full request inspection before approval
- Approved domains can be whitelisted for future automatic approval

**Advantages**:
- Maximum control - human review of all new connections
- Gradual whitelist building based on actual usage patterns
- Complete visibility into all connection attempts
- Useful for understanding baseline traffic before implementing automated rules

**Limitations**:
- Not scalable - requires admin intervention for each new domain
- High operational burden for large deployments
- Slow user experience - delays while waiting for approval
- Not suitable for unattended operation

**Best For**: Research environments, initial whitelist discovery, small-scale deployments with dedicated security staff

## Recommended Solution: Transparent Proxy (Level 3)

### Architecture Overview

The transparent proxy solution adds a Squid proxy container to the XaresAICoder deployment:

```
┌─────────────────────────────────────────────────────────────┐
│                     xares-aicoder-network                    │
│                                                              │
│  ┌──────────┐      ┌────────────┐      ┌──────────────┐   │
│  │ Workspace│─────▶│   Squid    │─────▶│   Internet   │   │
│  │Container │      │   Proxy    │      │              │   │
│  └──────────┘      └────────────┘      └──────────────┘   │
│       ▲                  │                                  │
│       │                  ▼                                  │
│       │            ┌────────────┐                          │
│       │            │  Access    │                          │
│       │            │  Logs      │                          │
│       │            └────────────┘                          │
│       │                                                     │
│  ┌──────────────────────────────┐                         │
│  │  XaresAICoder Server          │                         │
│  │  (Container Management)       │                         │
│  └──────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Access Control Capabilities

Squid provides granular access control beyond simple domain whitelisting:

#### 1. Domain-Based Access

Allow entire domains or subdomains:
- `github.com` - Full GitHub access
- `.pypi.org` - PyPI package repository
- `api.openai.com` - OpenAI API

#### 2. URL Path-Based Access

Restrict to specific paths within a domain:
- `github.com/university-name/*` - Only course-specific repositories
- `pypi.org/simple/*` - Package API only (block web interface)
- `api.anthropic.com/v1/messages` - Specific API endpoints only

#### 3. Pattern Matching (Regex)

Complex rules using regular expressions:
- Block expensive AI models: `!.*/gpt-4/.*` (allow all except GPT-4)
- Allow only specific file types: `.*\.(zip|tar\.gz|whl)$`
- Course-specific resources: `.*/CS101/.*` or `.*/spring2025/.*`

#### 4. HTTP Method Filtering

Control what actions are allowed:
- Documentation sites: `GET` only (read-only, no posting)
- Git repositories: `GET` and `POST` (clone and push)
- API endpoints: `POST` only (prevent browsing)

#### 5. Content Type Filtering

Restrict by response content type:
- Allow only package downloads: `application/zip`, `application/x-tar`
- Block HTML pages: deny `text/html` (prevent web browsing)

#### 6. Time-Based Access

Enable/disable access based on schedule:
- Allow AI APIs only during lecture hours
- Block expensive resources outside class time
- Emergency access windows

### Example Access Control Scenarios

#### Scenario 1: Python Development Course

**Requirements**:
- Students need PyPI packages
- Allow course GitHub repositories only
- Read-only access to Python documentation
- Block web browsing and social media

**Squid ACL Configuration**:
```
# Package managers (API only)
acl pypi_api dstdomain .pypi.org
acl pypi_paths urlpath_regex ^/simple/

# Course repositories
acl course_github dstdomain github.com
acl course_repos urlpath_regex ^/university-name/CS101-.*

# Documentation (read-only)
acl python_docs dstdomain docs.python.org
acl http_methods_readonly method GET HEAD

# Allow rules
http_access allow pypi_api pypi_paths
http_access allow course_github course_repos
http_access allow python_docs http_methods_readonly
http_access deny all
```

#### Scenario 2: AI-Assisted Development

**Requirements**:
- Access to specific AI APIs (Claude, GPT-3.5)
- Block expensive models (GPT-4, Claude Opus)
- Allow npm and PyPI packages
- Course-specific Git repositories
- Rate limiting per student

**Control Rules**:
- Whitelist: `api.anthropic.com`, `api.openai.com`, `registry.npmjs.org`, `pypi.org`
- Block patterns: `/v1/messages.*claude-opus/`, `/v1/chat/completions.*gpt-4/`
- Repository whitelist: `github.com/course-name/*`
- Rate limit: 100 requests/hour per workspace IP

## Logging and Accountability

### What Gets Logged

Every outgoing HTTP/HTTPS request captures:

- **Source Identification**: Workspace container IP address
- **Destination**: Full URL including domain, path, and query parameters
- **Timing**: Timestamp (millisecond precision), request duration
- **Request Details**: HTTP method, user agent, request headers
- **Response Details**: Status code, content type, bytes transferred
- **Access Decision**: Allowed or denied, matching ACL rule

### Student/Workspace Correlation

Since each workspace runs in an isolated container with a unique IP address on the `xares-aicoder-network`, logs can be correlated:

```
Container IP → Workspace ID → Student/User
```

The XaresAICoder server maintains this mapping and can provide:
- Per-student activity reports
- Blocked request summaries
- Resource usage statistics (bandwidth, request counts)
- Timeline analysis for specific students

### Log Format Example

```
1701234567.123 45 172.18.0.5 TCP_MISS/200 1543 GET https://pypi.org/simple/flask/ - HIER_DIRECT/151.101.0.223 text/html
```

Fields:
- `1701234567.123` - Unix timestamp with milliseconds
- `45` - Request duration (ms)
- `172.18.0.5` - Source IP (workspace container)
- `TCP_MISS/200` - Cache status and HTTP status code
- `1543` - Bytes transferred
- `GET` - HTTP method
- `https://pypi.org/simple/flask/` - Full URL
- `HIER_DIRECT/151.101.0.223` - Upstream connection details
- `text/html` - Content type

### Audit Capabilities

**Real-Time Monitoring**:
- Live tail of specific student's activity
- Alert on blocked requests or policy violations
- Dashboard showing active connections

**Historical Analysis**:
- Per-student traffic reports (requests, domains, bandwidth)
- Identify policy violations or suspicious activity
- Generate compliance reports for administrators

**Retention and Privacy**:
- Configurable log retention (daily/weekly rotation)
- Anonymization options for long-term storage
- Compliance with institutional privacy policies

### Example Queries

```bash
# Total requests by student (workspace IP)
grep "172.18.0.5" /var/log/squid/access.log | wc -l

# Unique domains accessed
grep "172.18.0.5" /var/log/squid/access.log | awk '{print $7}' |
  sed 's|https\?://||' | cut -d'/' -f1 | sort -u

# Blocked attempts
grep "172.18.0.5" /var/log/squid/access.log | grep "TCP_DENIED"

# Data transferred (MB)
grep "172.18.0.5" /var/log/squid/access.log |
  awk '{sum+=$5} END {print sum/1024/1024 " MB"}'

# Requests to expensive AI APIs
grep "172.18.0.5" /var/log/squid/access.log | grep -E "gpt-4|claude-opus"
```

## Deployment Considerations

### Performance Impact

**Expected Overhead**:
- HTTP requests: ~5-10ms latency added
- HTTPS requests: ~20-30ms latency added (SSL inspection)
- Minimal throughput impact (<5% for typical workloads)
- Cache can improve performance for repeated requests

**Scaling**:
- Single Squid instance handles 100+ concurrent workspaces
- Horizontal scaling: Multiple Squid instances with load balancing
- Vertical scaling: Increase CPU/memory for higher throughput

### Resource Requirements

**Squid Container**:
- CPU: 1-2 cores for 100 workspaces
- Memory: 512MB-1GB base + ~10MB per active workspace
- Disk: 100MB-1GB for logs (depends on retention policy)
- Network: Minimal overhead (<5% bandwidth increase)

### Maintenance Requirements

**Regular Tasks**:
- Log rotation (daily or weekly)
- Whitelist updates (add new allowed domains/URLs)
- Certificate renewal (if using SSL interception)
- Periodic log analysis and reporting

**Low Maintenance**:
- Whitelist updates don't require container restart
- Automated log rotation via logrotate
- Squid is mature, stable software with minimal updates needed

### Certificate Management

**For SSL/HTTPS Interception**:

Squid must decrypt HTTPS traffic to inspect URLs and enforce policies. This requires:

1. **Generate CA Certificate**: Create a Certificate Authority certificate that Squid will use to sign intercepted connections
2. **Trust CA in Workspaces**: The CA certificate must be trusted in workspace containers (added during container creation)
3. **Certificate Renewal**: CA certificates typically valid for 1-10 years (configurable)

**Privacy Consideration**: With SSL interception, the proxy can see all HTTPS traffic in plaintext. This is necessary for URL-based filtering but means:
- Proxy has access to all transmitted data (including API keys in headers)
- Logs may contain sensitive information
- Institutional privacy policies must be followed
- Students/users should be informed of monitoring

**Alternative - Domain-Only Filtering**: For stricter privacy, Squid can filter by domain without SSL interception (cannot see URL paths or content), but this limits filtering capabilities.

## Integration with XaresAICoder

### Architecture Changes

**New Component**:
- Add `squid-proxy` service to `docker-compose.yml`
- Squid container joins `xares-aicoder-network`

**Workspace Configuration**:
- Workspace containers configured to use Squid as HTTP/HTTPS proxy
- Environment variables: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`
- Certificate trust setup during container creation (if using SSL interception)

**Server Changes**:
- Store workspace IP → workspace ID mapping for log correlation
- Optional: Admin API for whitelist management
- Optional: Web dashboard for log viewing and reports

### Configuration Management

**Whitelist Management**:
- Configuration file (`squid.conf`) mounted as volume
- Updates possible without container restart: `squid -k reconfigure`
- Optional: Web interface for administrators to edit whitelist
- Version control for configuration changes (audit trail)

**Profile-Based Configuration**:
- Different whitelist profiles for different course types
- Example: Python course vs JavaScript course vs AI/ML course
- Assigned per workspace or per user group

### Monitoring Integration

**Health Checks**:
- Squid health endpoint monitoring
- Alert on proxy failures (blocks all workspace traffic)

**Metrics Collection**:
- Request rate per workspace
- Blocked request counts
- Bandwidth usage per student
- Top accessed domains

**Dashboard Integration**:
- Show workspace network status (proxy online/offline)
- Per-student activity summary in admin UI
- Real-time blocked request notifications

## Security Considerations

### Threat Model

**Threats Mitigated**:
- ✅ Unauthorized external API access
- ✅ Data exfiltration to unknown services
- ✅ Student access to prohibited resources during assessments
- ✅ Excessive use of expensive AI APIs
- ✅ Malware command & control (blocked domains)

**Remaining Risks**:
- ⚠️ Allowed domains may be compromised or misused
- ⚠️ Students may tunnel traffic through allowed services (e.g., SSH over HTTP)
- ⚠️ Proxy compromise would expose all traffic
- ⚠️ Certificate trust allows man-in-the-middle capability

### Operational Security

**Access Control**:
- Limit who can modify proxy configuration (role-based access)
- Audit trail for all configuration changes
- Separate credentials for proxy admin vs XaresAICoder admin

**Monitoring**:
- Alert on unusual traffic patterns (high volume, unexpected domains)
- Regular review of blocked requests (identify policy gaps)
- Monitor proxy resource usage (detect DoS attempts)

**Incident Response**:
- Process for handling policy violations
- Emergency whitelist bypass procedure (for critical issues)
- Log preservation for investigations

### Compliance and Privacy

**Data Protection**:
- Logs may contain sensitive information (API keys, personal data in URLs)
- Implement appropriate access controls on log storage
- Define retention policies compliant with regulations (GDPR, FERPA, etc.)
- Consider log anonymization for long-term retention

**Transparency**:
- Inform users that traffic is monitored and logged
- Document what is logged and how logs are used
- Provide data access/deletion procedures (user rights)

**Regulatory Alignment**:
- FERPA (US education): Student data protection requirements
- GDPR (EU): Data processing, retention, user rights
- Institutional policies: May have additional requirements

## Getting Started

### Decision Framework

Use this flowchart to determine if the transparent proxy solution is appropriate:

1. **Do workspaces need any internet access?**
   - No → Use Level 1 (Airgapped)
   - Yes → Continue to #2

2. **Is the list of allowed services very small (<5 domains) and fixed?**
   - Yes → Consider Level 2 (Gateway Pattern)
   - No → Continue to #3

3. **Do you need audit logging and flexible access control?**
   - Yes → **Use Level 3 (Transparent Proxy)** ✅
   - No → Level 1 may be sufficient

4. **Is this a small research environment with dedicated security staff?**
   - Yes, and initial whitelist unknown → Consider Level 4 (Admin Approval) for discovery, then move to Level 3
   - No → **Use Level 3 (Transparent Proxy)** ✅

### Implementation Phases

**Phase 1: Planning (1-2 weeks)**
- Define initial whitelist based on course/use case requirements
- Review institutional privacy and compliance policies
- Get security team approval for SSL interception approach
- Define log retention and access policies

**Phase 2: Proof of Concept (1 week)**
- Deploy Squid in test environment
- Configure basic whitelist (package managers, documentation)
- Test with sample workspaces
- Verify logging and certificate trust

**Phase 3: Pilot Deployment (2-4 weeks)**
- Deploy to small user group (10-20 students)
- Monitor for issues and policy gaps
- Refine whitelist based on real usage
- Train administrators on management tasks

**Phase 4: Production Rollout**
- Deploy to full user population
- Establish monitoring and alerting
- Implement regular review processes
- Document procedures for common tasks

### Next Steps

**For Discussion with Security Teams**:
1. Review SSL interception privacy implications
2. Define acceptable use policy for workspace network access
3. Establish log retention and access control policies
4. Determine whitelist approval process
5. Plan for incident response (policy violations)

**For Implementation**:
1. Prepare detailed whitelist for specific course/use case
2. Define Squid ACL configuration
3. Create Docker Compose integration for XaresAICoder
4. Implement workspace container proxy configuration
5. Build admin tools for whitelist management and log analysis

## Additional Resources

### Squid Proxy Documentation
- Official Documentation: http://www.squid-cache.org/Doc/
- ACL Configuration: http://www.squid-cache.org/Doc/config/acl/
- SSL Bumping Guide: https://wiki.squid-cache.org/Features/SslBump

### Related XaresAICoder Documentation
- `ARCHITECTURE.md` - System architecture and Docker networking
- `SECURITY.md` - General security considerations
- `DEPLOYMENT.md` - Deployment configurations

### Alternative Solutions
- **Privoxy**: Lighter alternative to Squid (no HTTPS interception)
- **TinyProxy**: Minimal proxy with basic filtering
- **mitmproxy**: Python-based proxy with scripting capabilities

## Conclusion

The transparent proxy solution (Level 3) provides the optimal balance of security, usability, and operational simplicity for most educational and enterprise XaresAICoder deployments. It enables:

- **Flexible Access Control**: Domain, URL path, and pattern-based filtering
- **Complete Accountability**: Per-student logging and audit trails
- **Operational Simplicity**: Single proxy component, editable configuration
- **Scalability**: Handles 100+ concurrent users with minimal resources

For deployments requiring network access control and monitoring, this solution is recommended as the starting point for security team discussions and implementation planning.
