# Development Guide

Complete guide for contributing to and developing XaresAICoder.

## Table of Contents

- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Building and Deployment](#building-and-deployment)
- [Contributing Guidelines](#contributing-guidelines)
- [Release Process](#release-process)

## Development Environment

### Prerequisites

- **Node.js** 18+ (for backend development)
- **Docker** 20.10+ and Docker Compose
- **Git** for version control
- **VS Code** (recommended) with extensions:
  - ESLint
  - Prettier
  - Docker
  - GitLens

### Local Development Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd XaresAICoder

# 2. Install dependencies
cd server
npm install
cd ..

# 3. Set up development environment
cp .env.example .env
# Edit .env for development settings

# 4. Build development environment
./deploy.sh --skip-network  # For first time
# OR
docker compose up --build   # For quick development
```

### Development Configuration

```bash
# .env for development
BASE_DOMAIN=localhost
BASE_PORT=80
PROTOCOL=http
ENABLE_GIT_SERVER=true
MAX_WORKSPACES_PER_USER=10     # More workspaces for testing
```

## Project Structure

### Repository Layout

```
XaresAICoder/
├── README.md                 # Main project documentation
├── LICENSE                   # Dual license file
├── docker-compose.yml        # Service orchestration
├── deploy.sh                 # Deployment script
├── setup-network.sh          # Network configuration
├── .env.example              # Environment template
├── .gitignore               # Git ignore patterns
│
├── server/                   # Node.js API backend
│   ├── package.json          # Node.js dependencies
│   ├── src/
│   │   ├── index.js         # Main Express server
│   │   ├── routes/          # API route handlers
│   │   │   ├── projects.js  # Project management
│   │   │   ├── health.js    # Health checks
│   │   │   └── git.js       # Git integration
│   │   └── services/        # Business logic
│   │       ├── docker.js    # Docker API integration
│   │       ├── workspace.js # Workspace management
│   │       └── git.js       # Git server integration
│
├── code-server/             # Custom VS Code container
│   ├── Dockerfile           # Container definition
│   ├── setup-scripts/       # Workspace initialization
│   │   ├── workspace-init.sh # Main setup script
│   │   ├── setup-functions.sh # Common functions
│   │   └── templates/       # Project templates
│   └── config/             # VS Code configuration
│
├── frontend/               # Web interface
│   ├── index.html          # Main page
│   ├── app.js             # JavaScript logic
│   ├── style.css          # Styling
│   ├── manifest.json      # PWA manifest
│   ├── sw.js.template     # Service worker template
│   └── icons/             # PWA icons
│
├── nginx-*.conf.template   # Nginx configurations
├── build/                  # Generated build files
└── docs/                   # Documentation
    ├── INSTALLATION.md
    ├── ARCHITECTURE.md
    └── ...
```

### Key Components

#### Backend (server/)

**Express.js API Server**:
- RESTful API for workspace management
- Docker integration via Dockerode
- Real-time container status monitoring
- Git server integration

**Key Files**:
- `src/index.js` - Main server setup and middleware
- `src/routes/projects.js` - Workspace CRUD operations
- `src/services/docker.js` - Docker container management
- `src/services/workspace.js` - Workspace lifecycle

#### Frontend (frontend/)

**Vanilla JavaScript SPA**:
- No framework dependencies for simplicity
- PWA capabilities with service worker
- Real-time UI updates
- Responsive design

**Key Files**:
- `index.html` - Main interface structure
- `app.js` - Application logic and API calls
- `style.css` - VS Code inspired styling
- `sw.js.template` - Service worker for PWA features

#### Container (code-server/)

**Custom VS Code Environment**:
- Based on code-server official image
- Pre-installed development tools
- AI tools integration scripts
- Project template system

**Key Files**:
- `Dockerfile` - Container build definition
- `setup-scripts/workspace-init.sh` - Project initialization
- `templates/` - Project scaffolding templates

## Getting Started

### Development Mode

```bash
# Start in development mode with auto-reload
docker compose up --build

# Make changes to code and see them reflected automatically
# Frontend: Refresh browser
# Backend: Server restarts automatically (nodemon)
# Container: Rebuild with --build flag
```

### Working on Components

#### Backend Development

```bash
# Install dependencies
cd server
npm install

# Run locally (outside Docker)
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

#### Frontend Development

```bash
# Frontend is served by nginx in Docker
# For development, edit files directly
# Changes are reflected immediately (volume mount)

# Test PWA features
# Use Chrome DevTools > Application > Service Workers
```

#### Container Development

```bash
# Build custom image
cd code-server
docker build -t xares-aicoder-codeserver:latest .

# Test template changes
docker run -it --rm xares-aicoder-codeserver:latest bash

# Test workspace initialization
docker run -it --rm \
  -e PROJECT_NAME="test" \
  -e PROJECT_TYPE="python-flask" \
  xares-aicoder-codeserver:latest \
  /home/coder/setup-scripts/workspace-init.sh
```

## Development Workflow

### Feature Development

1. **Create Feature Branch**:
   ```bash
   git checkout -b feature/new-feature
   ```

2. **Development**:
   - Make changes to relevant components
   - Test changes locally
   - Add/update tests as needed

3. **Testing**:
   ```bash
   # Test API endpoints
   curl -X POST http://localhost/api/projects/create \
     -H "Content-Type: application/json" \
     -d '{"projectName":"test","projectType":"empty"}'
   
   # Test workspace creation
   # Use UI to create different project types
   
   # Test container management
   curl -X POST http://localhost/api/projects/PROJECT_ID/stop
   curl -X POST http://localhost/api/projects/PROJECT_ID/start
   ```

4. **Code Review**:
   - Ensure code follows standards
   - Update documentation if needed
   - Test all affected functionality

5. **Commit and Push**:
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   git push origin feature/new-feature
   ```

### Bug Fixes

1. **Reproduce Issue**:
   - Create minimal reproduction case
   - Document expected vs actual behavior
   - Check logs for error details

2. **Debug**:
   ```bash
   # Backend debugging
   docker compose logs server
   
   # Container debugging
   docker logs workspace-PROJECT_ID
   
   # Network debugging
   docker network inspect xares-aicoder-network
   ```

3. **Fix and Test**:
   - Implement fix
   - Verify fix resolves issue
   - Test that fix doesn't break other features

### Hot Reload Development

```bash
# Backend changes (server/)
# Automatic reload with nodemon in development mode

# Frontend changes (frontend/)
# Immediate reload - refresh browser

# Template changes (code-server/setup-scripts/)
# Requires image rebuild
./deploy.sh --build-only

# Configuration changes
# Requires service restart
docker compose restart nginx
```

## Code Standards

### JavaScript/Node.js

**Style Guide**:
```javascript
// Use const/let, not var
const projectName = 'example';
let status = 'creating';

// Async/await preferred over callbacks
async function createWorkspace(config) {
  try {
    const container = await docker.createContainer(config);
    return { success: true, container };
  } catch (error) {
    console.error('Failed to create workspace:', error);
    return { success: false, error: error.message };
  }
}

// Meaningful variable names
const workspaceContainer = await docker.getContainer(containerId);
const isHealthy = await checkWorkspaceHealth(workspaceId);

// Error handling
if (!isValidProjectType(projectType)) {
  return res.status(400).json({
    success: false,
    error: 'Invalid project type'
  });
}
```

**API Response Format**:
```javascript
// Success responses
{
  success: true,
  data: { /* response data */ }
}

// Error responses
{
  success: false,
  error: "Human readable error message",
  code: "ERROR_CODE",
  details: { /* additional error context */ }
}
```

### Shell Scripts

**Bash Standards**:
```bash
#!/usr/bin/env bash
set -e  # Exit on error

# Use meaningful function names
setup_python_flask() {
    local project_name="$1"
    
    # Quote variables
    echo "Setting up Flask project: ${project_name}"
    
    # Check prerequisites
    if ! command -v python3 &> /dev/null; then
        echo "Error: Python3 not found"
        return 1
    fi
    
    # Error handling
    if ! pip install -r requirements.txt; then
        echo "Error: Failed to install dependencies"
        return 1
    fi
}
```

### Docker

**Dockerfile Best Practices**:
```dockerfile
# Use specific tags, not 'latest'
FROM codercom/code-server:4.16.1

# Minimize layers
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Use non-root user
USER coder

# Set working directory
WORKDIR /home/coder

# Copy files with appropriate ownership
COPY --chown=coder:coder setup-scripts/ setup-scripts/
```

### CSS

**Styling Standards**:
```css
/* Use CSS custom properties for consistency */
:root {
  --primary-color: #007acc;
  --background-color: #1e1e1e;
  --text-color: #cccccc;
}

/* BEM naming convention */
.workspace-card {
  /* Block */
}

.workspace-card__title {
  /* Element */
}

.workspace-card--protected {
  /* Modifier */
}

/* Mobile-first responsive design */
.container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

@media (min-width: 768px) {
  .container {
    padding: 2rem;
  }
}
```

## Testing

### Manual Testing

**API Testing**:
```bash
# Test workspace creation
curl -X POST http://localhost/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "test-workspace",
    "projectType": "python-flask",
    "passwordProtected": true,
    "password": "testpass123"
  }'

# Test workspace management
PROJECT_ID="returned-project-id"
curl http://localhost/api/projects/$PROJECT_ID
curl -X POST http://localhost/api/projects/$PROJECT_ID/stop \
  -H "Content-Type: application/json" \
  -d '{"password": "testpass123"}'
curl -X POST http://localhost/api/projects/$PROJECT_ID/start
```

**UI Testing Checklist**:
- [ ] Workspace creation for all template types
- [ ] Password protection toggle works
- [ ] Git repository creation works
- [ ] Workspace start/stop controls work
- [ ] Project deletion works (with password verification)
- [ ] Real-time status updates work
- [ ] PWA installation works
- [ ] Mobile responsive design works

**Container Testing**:
```bash
# Test template initialization
docker run --rm -it \
  -e PROJECT_NAME="test" \
  -e PROJECT_TYPE="python-flask" \
  xares-aicoder-codeserver:latest \
  bash -c "cd /tmp && /home/coder/setup-scripts/workspace-init.sh test python-flask"

# Test AI tools setup
docker run --rm -it xares-aicoder-codeserver:latest \
  bash -c "setup_ai_tools"
```

### Test Project Templates

Create test workspaces for each template type and verify:

**Python Flask**:
- [ ] Virtual environment created
- [ ] Dependencies installed
- [ ] Flask app runs on port 5000
- [ ] Templates and static files work
- [ ] Debug configuration works

**Node.js React**:
- [ ] Dependencies installed via npm
- [ ] Vite dev server runs on port 3000
- [ ] Hot module reload works
- [ ] Build process works
- [ ] ESLint configuration works

**Java Spring Boot**:
- [ ] Maven dependencies downloaded
- [ ] Application runs on port 8080
- [ ] Spring DevTools works
- [ ] Test framework configured
- [ ] Debug configuration works

**Empty Project**:
- [ ] Git repository initialized
- [ ] VS Code settings configured
- [ ] Documentation files created
- [ ] Extension recommendations work

### Integration Testing

**Full Workflow Tests**:
```bash
# Test complete workspace lifecycle
./test-workflow.sh  # Create this script for automated testing

# Test Git server integration
# 1. Create workspace with Git repo
# 2. Make changes in VS Code
# 3. Commit and push to Git server
# 4. Verify repository appears in Forgejo web interface

# Test password protection
# 1. Create password-protected workspace
# 2. Verify authentication required for access
# 3. Test stop/delete require password
# 4. Verify UI shows protection indicators
```

## Building and Deployment

### Build Process

```bash
# Full build (recommended)
./deploy.sh

# Component builds
./deploy.sh --build-only        # Just build images
./deploy.sh --skip-build        # Skip image building
./deploy.sh --skip-network      # Skip network setup
```

### Custom Builds

```bash
# Build with specific configuration
BUILD_ENV=production ./deploy.sh

# Build for different architectures
docker buildx build --platform linux/amd64,linux/arm64 \
  -t xares-aicoder-codeserver:latest .
```

### Production Deployment

```bash
# Production environment setup
cp .env.example .env.production
# Edit .env.production with production settings

# Deploy for production
BUILD_ENV=production ./deploy.sh --git-server

# Production health checks
curl https://your-domain.com/api/health
```

### Version Management

```bash
# Version information is automatically generated from git tags
git tag v1.0.0
git push origin v1.0.0

# Deploy script automatically uses latest tag for versioning
./deploy.sh  # Creates version.js with v1.0.0
```

## Contributing Guidelines

### Pull Request Process

1. **Fork Repository**:
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/XaresAICoder.git
   cd XaresAICoder
   git remote add upstream https://github.com/ORIGINAL_OWNER/XaresAICoder.git
   ```

2. **Create Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes**:
   - Follow code standards
   - Add tests for new features
   - Update documentation
   - Test thoroughly

4. **Commit Messages**:
   ```bash
   # Use conventional commit format
   git commit -m "feat: add password protection for workspaces"
   git commit -m "fix: resolve container startup race condition"
   git commit -m "docs: update API documentation"
   git commit -m "refactor: improve error handling in docker service"
   ```

5. **Submit Pull Request**:
   - Clear title and description
   - Reference related issues
   - Include testing instructions
   - Request appropriate reviewers

### Code Review Guidelines

**For Contributors**:
- Test your changes thoroughly
- Follow the existing code style
- Add appropriate documentation
- Respond to review feedback promptly

**For Reviewers**:
- Check functionality and edge cases
- Verify code follows standards
- Test the changes locally if possible
- Provide constructive feedback

### Issue Reporting

**Bug Reports Should Include**:
```markdown
## Bug Report

**Environment:**
- OS: Ubuntu 22.04
- Docker: 24.0.5
- Docker Compose: v2.20.0

**Steps to Reproduce:**
1. Create Python Flask workspace
2. Enable password protection
3. Try to stop workspace without password

**Expected Behavior:**
Should show password prompt

**Actual Behavior:**
Returns 500 internal server error

**Additional Context:**
- Error logs: [paste logs here]
- Screenshot: [if applicable]
```

**Feature Requests Should Include**:
- Clear description of the feature
- Use case and motivation
- Proposed implementation approach
- Potential impact on existing features

## Release Process

### Versioning

XaresAICoder follows [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Checklist

1. **Pre-release Testing**:
   ```bash
   # Test all major workflows
   ./test-full-workflow.sh
   
   # Test on clean system
   docker system prune -a
   ./deploy.sh
   ```

2. **Update Documentation**:
   - Update CHANGELOG.md
   - Update version references
   - Review and update README

3. **Create Release**:
   ```bash
   # Tag release
   git tag -a v1.2.0 -m "Release v1.2.0: Add multi-language templates"
   git push origin v1.2.0
   
   # Create GitHub release
   gh release create v1.2.0 --title "v1.2.0" --notes-file CHANGELOG.md
   ```

4. **Post-release**:
   - Monitor for issues
   - Update documentation sites
   - Announce in relevant channels

### Hotfix Process

For critical bugs requiring immediate fixes:

```bash
# Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-security-fix

# Make minimal fix
# Test thoroughly
# Create PR to main

# After merge, tag hotfix release
git tag v1.2.1
git push origin v1.2.1
```

---

[← Back to Troubleshooting](TROUBLESHOOTING.md) | [Back to README](../README.md)