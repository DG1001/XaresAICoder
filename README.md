# XaresAICoder

A browser-based AI coding platform that integrates VS Code (code-server) with OpenCode SST for AI-powered development.

## Overview

XaresAICoder provides isolated development workspaces running VS Code in the browser, with OpenCode SST pre-installed for AI coding assistance. Each workspace runs in a separate Docker container with resource limits and automatic cleanup.

## Features

- **Browser-based VS Code** using code-server
- **OpenCode SST integration** for AI-powered coding
- **Isolated workspaces** with Docker containers
- **Real-time container management** with start/stop controls
- **Dynamic status monitoring** showing actual container states
- **Python Flask** project templates
- **Automatic project initialization** with Git
- **Resource management** with timeouts and limits
- **Intuitive web interface** for complete project lifecycle management

## Quick Start

### Prerequisites

- Docker and Docker Compose
- 4GB+ RAM available for containers
- Modern web browser

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd XaresAICoder
   ```

2. **Create environment file**:
   ```bash
   cp .env.example .env
   # Edit .env with your preferences
   ```

3. **Build and start services**:
   ```bash
   docker-compose up --build
   ```

4. **Access the platform**:
   Open http://localhost in your browser

### First Project

1. Enter a project name
2. Select "Python Flask" as the project type
3. Click "Create Workspace"
4. Wait for the workspace to be created
5. VS Code will open in a new tab

## Architecture

### Services

- **nginx**: Reverse proxy and static file server
- **server**: Node.js API for project management
- **code-server containers**: Dynamic VS Code instances

### Components

```
├── docker-compose.yml      # Service orchestration
├── nginx.conf             # Reverse proxy configuration
├── server/                # Node.js API backend
│   ├── src/
│   │   ├── index.js      # Main server
│   │   ├── routes/       # API endpoints
│   │   └── services/     # Docker & workspace management
├── code-server/          # Custom VS Code container
│   ├── Dockerfile
│   ├── setup-scripts/    # OpenCode SST installation
│   └── config/          # VS Code configuration
├── frontend/            # Landing page
└── docs/               # User documentation
```

## Development

### Building Code-Server Image

Before starting the platform, build the custom code-server image:

```bash
cd code-server
docker build -t xares-aicoder-codeserver:latest .
cd ..
```

### Running in Development

```bash
# Start all services
docker-compose up --build

# View logs
docker-compose logs -f server

# Stop services
docker-compose down
```

### API Endpoints

#### Project Management
- `POST /api/projects/create` - Create new project with health check
- `GET /api/projects/:id` - Get project details with real-time status
- `DELETE /api/projects/:id` - Delete project and cleanup containers
- `GET /api/projects/` - List all projects with current container status

#### Container Control
- `POST /api/projects/:id/start` - Start stopped workspace container
- `POST /api/projects/:id/stop` - Stop running workspace container

#### System
- `GET /api/health` - API server health check
- `GET /api/workspace/stats` - Get workspace statistics

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | 3000 | API server port |
| `CODE_SERVER_PASSWORD` | default_password | VS Code access password |
| `WORKSPACE_TIMEOUT_MINUTES` | 120 | Workspace auto-stop timeout |
| `MAX_WORKSPACES_PER_USER` | 5 | Maximum workspaces per user |

### Resource Limits

Each workspace container:
- **CPU**: 2 cores
- **Memory**: 4GB
- **Disk**: 10GB
- **Network**: Isolated bridge network

## OpenCode SST Integration

### Installation

OpenCode SST is automatically installed in each workspace. Currently uses a mock implementation - replace the installation script in `code-server/setup-scripts/setup-opencode.sh` with the actual OpenCode SST installation method.

### Usage in Workspace

```bash
# Authenticate
opencode auth login

# Use AI assistance
opencode "create a REST API endpoint"

# Get help
opencode --help
```

## Project Templates

### Python Flask

Includes:
- Virtual environment setup
- Flask and python-dotenv installed
- Sample application (app.py)
- Requirements file
- Git repository initialization

### Adding New Templates

1. Update `setup-scripts/workspace-init.sh`
2. Add project type to API validation
3. Update frontend project type selector

## Container Management

### Real-time Status Monitoring

XaresAICoder provides real-time container status checking:
- **Running**: Container is active and VS Code is accessible
- **Stopped**: Container is stopped, can be restarted
- **Error**: Container failed or was manually removed

### Workspace Lifecycle

```bash
# Create new workspace (includes health check)
POST /api/projects/create

# Start stopped workspace (waits for readiness)
POST /api/projects/:id/start

# Stop running workspace (graceful shutdown)
POST /api/projects/:id/stop

# Delete workspace (removes container)
DELETE /api/projects/:id
```

### Health Checks

- Workspace creation waits for code-server to respond (15-second timeout)
- Real-time status updates via Docker API inspection
- Automatic cleanup of inactive workspaces after timeout

## Monitoring

### Logs

```bash
# API server logs
docker-compose logs server

# All service logs
docker-compose logs

# Specific workspace logs
docker logs workspace-<project-id>
```

## Security

### Container Security

- No root access in workspaces
- Resource limits enforced
- Network isolation
- Regular base image updates

### User Data

- API keys stored only in user workspaces
- No persistent user authentication
- Workspace isolation prevents cross-contamination

## Troubleshooting

### Common Issues

**Containers won't start**
```bash
# Check Docker daemon
docker info

# Check available resources
docker system df
```

**Workspace creation fails**
```bash
# Check code-server image exists
docker images | grep xares-aicoder-codeserver

# Build if missing
cd code-server && docker build -t xares-aicoder-codeserver:latest .
```

**Workspace shows as running but gives 502 error**
```bash
# Check if container is actually running
docker ps | grep workspace-<project-id>

# If stopped, use the start button in the UI or:
curl -X POST http://localhost/api/projects/<project-id>/start
```

**Container management issues**
```bash
# Check real-time status
curl http://localhost/api/projects/

# Manually stop problematic container
docker stop workspace-<project-id>

# Restart via API (will auto-detect stopped state)
curl -X POST http://localhost/api/projects/<project-id>/start
```

**Network issues**
```bash
# Recreate network
docker-compose down
docker network prune
docker-compose up
```

### Cleanup

```bash
# Remove all containers and volumes
docker-compose down -v

# Clean up unused Docker resources
docker system prune -a
```

## Limitations

### Current Phase 1 Limitations

- Only Python Flask projects supported
- Basic user management (no authentication)
- OpenCode SST mock implementation
- Local storage only (no persistence layer)

### Future Enhancements

- Multiple language support (Node.js, Java, etc.)
- User authentication system
- GitHub integration
- Real OpenCode SST integration
- Deployment capabilities
- Database persistence

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with Docker Compose
5. Submit a pull request

## License

This project uses a **Dual License** model - see the [LICENSE](LICENSE) file for details.

### Option 1: MIT License (Free for All Use)
- ✅ **Completely free** for personal, educational, and commercial use
- ✅ No restrictions on modification, distribution, or commercial use
- ✅ Compatible with all open source dependencies
- ✅ Standard MIT License terms apply

### Option 2: Commercial License (Paid)
For organizations that want additional benefits:
- ✅ Commercial support and warranty
- ✅ Priority bug fixes and feature requests
- ✅ Custom development assistance
- ✅ Legal protection and indemnification
- ✅ Service level agreements (SLA)

### Choose Your License
- **Individual/Open Source Projects**: Use **MIT License** (completely free)
- **Enterprise/Organizations**: Consider **Commercial License** for additional support

**Note**: The MIT License allows full commercial use without any fees or restrictions.

## Support

- **User Guide**: See `docs/user-guide.md`
- **API Documentation**: Available at `/api/health` when running
- **Issues**: Report bugs and feature requests via GitHub issues