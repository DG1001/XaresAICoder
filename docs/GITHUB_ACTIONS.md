# GitHub Actions CI/CD Setup

This document explains how to set up and use the automated Docker image building with GitHub Actions and GitHub Container Registry.

## Overview

XaresAICoder includes GitHub Actions workflows that automatically build and push Docker images to GitHub Container Registry (ghcr.io) when code changes are made. This enables faster deployments using pre-built images instead of building locally every time.

## Workflows

### 1. Build and Push (`build-and-push.yml`)

**Triggers:**
- Push tags matching `v*.*.*` pattern (e.g., v1.0.0, v2.1.3)
- Manual workflow dispatch with custom tag name

**Features:**
- **Tag-triggered builds**: Only builds when you create a new version tag
- **Multi-architecture builds**: Supports both amd64 and arm64 platforms
- **Efficient caching**: Uses GitHub Actions cache to speed up builds
- **Semantic versioning**: Creates multiple tags (exact version, major.minor, major, latest)

**Images Built for each tag:**
- `ghcr.io/[username]/xaresaicoder-server:v1.0.0` (exact version)
- `ghcr.io/[username]/xaresaicoder-server:v1.0` (major.minor)
- `ghcr.io/[username]/xaresaicoder-server:v1` (major)
- `ghcr.io/[username]/xaresaicoder-server:latest` (always latest)
- Same pattern for code-server image

### 2. Release Documentation (`release.yml`)

**Triggers:**
- GitHub releases (when you publish a release)

**Features:**
- **Deployment guides**: Creates step-by-step deployment instructions
- **Version-specific documentation**: Tailored guides for each release
- **Artifact uploads**: Provides downloadable deployment guides

## Setup Instructions

### 1. Enable GitHub Container Registry

The workflows automatically use GitHub Container Registry. No additional setup is required as it uses the `GITHUB_TOKEN` which is automatically provided.

### 2. Repository Configuration

1. **Public Repository**: Images will be publicly accessible
2. **Private Repository**: Images will require authentication to pull

### 3. First Time Setup

1. **Push your code** to GitHub
2. **Create and push a version tag**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. **Workflows run automatically** when the tag is pushed
4. **Images are built** and pushed to GitHub Container Registry
5. **View images** at `https://github.com/[username]/[repo]/pkgs/container/xaresaicoder-server`

## Using Pre-built Images

### Quick Deployment

```bash
# Deploy using latest images from registry
./deploy.sh --use-registry

# Deploy using specific version
./deploy.sh --use-registry --registry-tag v1.0.0

# Deploy using images from specific GitHub user/org
./deploy.sh --use-registry --registry-owner username
```

### Environment Configuration

Add to your `.env` file:

```bash
# Use registry images
USE_REGISTRY_IMAGES=true
SERVER_IMAGE=ghcr.io/yourusername/xaresaicoder-server:latest
CODESERVER_IMAGE=ghcr.io/yourusername/xaresaicoder-codeserver:latest
```

## Image Access Control

### Public Images
- No authentication required
- Anyone can pull and use the images

### Private Images
- Requires GitHub Container Registry authentication
- Login using Personal Access Token (PAT)

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Or create a PAT with read:packages scope
echo $GITHUB_PAT | docker login ghcr.io -u USERNAME --password-stdin
```

## Workflow Customization

### Modify Build Triggers

Edit `.github/workflows/build-and-push.yml`:

```yaml
on:
  push:
    branches:
      - main
      - develop
      - feature/*  # Add feature branches
    paths:
      - 'server/**'
      - 'code-server/**'
      # Add more paths as needed
```

### Change Image Names

Update the `env` section in workflows:

```yaml
env:
  REGISTRY: ghcr.io
  IMAGE_NAME_SERVER: ${{ github.repository }}-server
  IMAGE_NAME_CODESERVER: ${{ github.repository }}-codeserver
```

### Add Build Arguments

For custom build arguments, modify the build step:

```yaml
- name: Build and push Server image
  uses: docker/build-push-action@v5
  with:
    context: ./server
    build-args: |
      BUILD_VERSION=${{ github.sha }}
      BUILD_DATE=${{ github.event.head_commit.timestamp }}
```

## Troubleshooting

### Build Failures

1. **Check workflow logs** in GitHub Actions tab
2. **Verify Dockerfile syntax** in both `server/` and `code-server/` directories
3. **Check resource limits** - GitHub Actions has 6-hour timeout per job

### Image Pull Failures

1. **Verify image exists** at `https://github.com/[username]/[repo]/pkgs`
2. **Check authentication** for private repositories
3. **Verify image name** and tag in deployment configuration

### Permission Issues

1. **Enable Actions** in repository settings
2. **Check write permissions** for GITHUB_TOKEN
3. **Verify Container Registry** is enabled for your account

## Manual Build Trigger

You can manually trigger builds through GitHub UI:

1. Go to **Actions** tab in your repository
2. Select **Build and Push Docker Images** workflow
3. Click **Run workflow**
4. Enter a tag name (e.g., v1.0.0-beta) and run

## Creating Releases

### Method 1: Command Line
```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0

# Optionally create a GitHub release
gh release create v1.0.0 --title "v1.0.0" --notes "Release notes here"
```

### Method 2: GitHub UI
1. Go to **Releases** tab in your repository
2. Click **Create a new release**
3. Choose or create a tag (e.g., v1.0.0)
4. Add release title and notes
5. Publish release

## Registry Management

### View Images
- Visit `https://github.com/[username]/[repo]/pkgs`
- See all tags and versions
- Download or delete images

### Image Cleanup
- Old images are kept indefinitely by default
- Set up retention policies in repository settings
- Manually delete old tags to save space

## Benefits

1. **Faster Deployments**: No need to build images locally
2. **Consistent Environments**: Same images across different deployment targets
3. **Version Control**: Track and rollback to specific image versions
4. **Resource Efficiency**: Build once, deploy anywhere
5. **Reduced Workload**: Only builds when you create release tags
6. **Unique Versioning**: Each tag creates a unique, immutable version

## Best Practices

1. **Use semantic versioning** (v1.0.0, v1.1.0, v2.0.0)
2. **Test locally first** before creating release tags
3. **Keep images small** by optimizing Dockerfiles
4. **Monitor build times** and optimize as needed
5. **Secure secrets** - never commit tokens or passwords
6. **Create meaningful releases** with proper release notes
7. **Use pre-release tags** (v1.0.0-beta) for testing