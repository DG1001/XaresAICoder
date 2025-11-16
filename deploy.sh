#!/bin/bash

# XaresAICoder Deployment Script
# Handles building the code-server image and deploying the application

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to detect and set Docker Compose command
setup_docker_compose_cmd() {
    if command_exists docker && docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
        print_status "Using Docker Compose v2 (docker compose)"
    elif command_exists docker-compose; then
        DOCKER_COMPOSE_CMD="docker-compose"
        print_status "Using Docker Compose v1 (docker-compose)"
    else
        return 1
    fi
    return 0
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command_exists docker; then
        print_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Setup Docker Compose command (v1 or v2)
    if ! setup_docker_compose_cmd; then
        print_error "Docker Compose is not available"
        print_error "Please install either:"
        print_error "  - Docker Compose v2 (included with Docker Desktop)"
        print_error "  - Docker Compose v1 (standalone docker-compose)"
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker daemon is not running"
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Function to build code-server image
build_code_server_image() {
    print_status "Building custom code-server image..."
    
    if [ ! -d "code-server" ]; then
        print_error "code-server directory not found. Are you in the project root?"
        exit 1
    fi
    
    cd code-server
    
    # Check if image already exists
    if docker images | grep -q "xares-aicoder-codeserver.*latest"; then
        print_warning "xares-aicoder-codeserver:latest already exists"
        read -p "Do you want to rebuild it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Skipping image build"
            cd ..
            return 0
        fi
    fi
    
    print_status "This may take several minutes as it installs VS Code extensions and AI tools..."
    
    # Build with progress output
    if docker build -t xares-aicoder-codeserver:latest .; then
        print_success "Code-server image built successfully"
    else
        print_error "Failed to build code-server image"
        cd ..
        exit 1
    fi
    
    cd ..
}

# Function to setup environment
setup_environment() {
    local enable_git_server=${1:-false}
    
    print_status "Setting up environment configuration..."
    
    # If no .env exists, help user create one
    if [ ! -f ".env" ]; then
        print_warning "No .env file found"
        echo
        echo "Available environment templates:"
        echo "  1. Localhost development (default)"
        echo "  2. Internal development server"
        echo "  3. Custom configuration"
        echo
        read -p "Choose an option (1-3): " -n 1 -r
        echo
        
        case $REPLY in
            1)
                print_status "Using localhost configuration"
                cp .env.example .env
                ;;
            2)
                print_status "Using internal development server template"
                if [ -f ".env.dev.example" ]; then
                    cp .env.dev.example .env
                    print_warning "Please edit .env to set your actual domain instead of dev.mycompany.internal"
                else
                    print_error ".env.dev.example not found"
                    exit 1
                fi
                ;;
            3)
                print_status "Creating custom configuration"
                cp .env.example .env
                print_warning "Please edit .env to configure your domain, port, and protocol"
                ;;
            *)
                print_status "Using localhost configuration (default)"
                cp .env.example .env
                ;;
        esac
    else
        print_success ".env file already exists"
    fi
    
    # Configure Git server based on flag
    if [ "$enable_git_server" = true ]; then
        print_status "Enabling Git server configuration..."
        if grep -q "^ENABLE_GIT_SERVER=" .env; then
            sed -i 's/^ENABLE_GIT_SERVER=.*/ENABLE_GIT_SERVER=true/' .env
        else
            echo "ENABLE_GIT_SERVER=true" >> .env
        fi
    else
        print_status "Disabling Git server configuration..."
        if grep -q "^ENABLE_GIT_SERVER=" .env; then
            sed -i 's/^ENABLE_GIT_SERVER=.*/ENABLE_GIT_SERVER=false/' .env
        else
            echo "ENABLE_GIT_SERVER=false" >> .env
        fi
    fi
    
    # Ensure HOST_PORT is set (fallback to BASE_PORT if not defined)
    if ! grep -q "^HOST_PORT=" .env; then
        BASE_PORT=$(grep "^BASE_PORT=" .env | cut -d'=' -f2)
        if [ -n "$BASE_PORT" ]; then
            print_status "Setting HOST_PORT to BASE_PORT value: $BASE_PORT"
            echo "HOST_PORT=$BASE_PORT" >> .env
        else
            print_status "Setting default HOST_PORT to 80"
            echo "HOST_PORT=80" >> .env
        fi
    else
        print_success "HOST_PORT already configured"
    fi
    
    # Show current configuration
    print_status "Current configuration:"
    echo "----------------------------------------"
    grep -E "BASE_DOMAIN|BASE_PORT|PROTOCOL|ENABLE_GIT_SERVER" .env | sed 's/^/  /'
    echo "----------------------------------------"
    
    # Ask if user wants to edit
    read -p "Do you want to edit the configuration? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    fi
}

# Function to setup network
setup_network() {
    print_status "Setting up Docker network..."
    
    if [ -f "./setup-network.sh" ]; then
        if ./setup-network.sh; then
            print_success "Docker network setup completed"
        else
            print_error "Failed to setup Docker network"
            exit 1
        fi
    else
        print_error "setup-network.sh not found"
        exit 1
    fi
}

# Function to setup Git server
setup_git_server() {
    # Check if Git server is enabled
    local git_server_enabled=$(grep "^ENABLE_GIT_SERVER=" .env | cut -d'=' -f2)
    
    if [ "$git_server_enabled" = "true" ]; then
        print_status "Setting up Forgejo Git server..."
        
        # Export environment variables for the setup script
        local BASE_DOMAIN=$(grep "^BASE_DOMAIN=" .env | cut -d'=' -f2)
        local BASE_PORT=$(grep "^BASE_PORT=" .env | cut -d'=' -f2)
        local PROTOCOL=$(grep "^PROTOCOL=" .env | cut -d'=' -f2)
        local GIT_ADMIN_USER=$(grep "^GIT_ADMIN_USER=" .env | cut -d'=' -f2)
        local GIT_ADMIN_PASSWORD=$(grep "^GIT_ADMIN_PASSWORD=" .env | cut -d'=' -f2)
        local GIT_ADMIN_EMAIL=$(grep "^GIT_ADMIN_EMAIL=" .env | cut -d'=' -f2)
        local GIT_SITE_NAME=$(grep "^GIT_SITE_NAME=" .env | cut -d'=' -f2)
        
        # Set defaults if not found
        BASE_DOMAIN=${BASE_DOMAIN:-localhost}
        BASE_PORT=${BASE_PORT:-80}
        PROTOCOL=${PROTOCOL:-http}
        GIT_ADMIN_USER=${GIT_ADMIN_USER:-developer}
        GIT_ADMIN_PASSWORD=${GIT_ADMIN_PASSWORD:-admin123!}
        GIT_ADMIN_EMAIL=${GIT_ADMIN_EMAIL:-gitadmin@xaresaicoder.local}
        GIT_SITE_NAME=${GIT_SITE_NAME:-XaresAICoder Git Server}
        
        # Export variables for the setup script
        export BASE_DOMAIN BASE_PORT PROTOCOL GIT_ADMIN_USER GIT_ADMIN_PASSWORD GIT_ADMIN_EMAIL GIT_SITE_NAME
        export FORGEJO_CONTAINER_NAME="xaresaicoder-forgejo"
        
        # Check if setup script exists
        if [ -f "./setup-forgejo.sh" ]; then
            print_status "Running Forgejo automated setup script..."
            if ./setup-forgejo.sh; then
                return 0
            else
                print_warning "Forgejo setup script failed - trying manual setup"
            fi
        else
            print_warning "Setup script not found - trying manual setup"
        fi
        
        # Fallback manual setup if script failed or doesn't exist
        print_status "Attempting manual Forgejo setup..."
        
        # Wait for Forgejo to be ready
        local max_attempts=20
        local attempt=1
        
        while [ $attempt -le $max_attempts ]; do
            if docker exec "$FORGEJO_CONTAINER_NAME" curl -f -s http://localhost:3000/ > /dev/null 2>&1; then
                print_success "Forgejo is ready!"
                break
            fi
            
            print_status "Attempt $attempt/$max_attempts - waiting for Forgejo..."
            sleep 3
            ((attempt++))
        done
        
        if [ $attempt -gt $max_attempts ]; then
            print_error "Forgejo failed to start within expected time"
            return 1
        fi
        
        # Create admin user directly
        print_status "Creating admin user '$GIT_ADMIN_USER'..."
        if docker exec -u git "$FORGEJO_CONTAINER_NAME" forgejo admin user create \
            --admin \
            --username "$GIT_ADMIN_USER" \
            --password "$GIT_ADMIN_PASSWORD" \
            --email "$GIT_ADMIN_EMAIL" 2>/dev/null; then
            print_success "Admin user '$GIT_ADMIN_USER' created successfully!"
        else
            print_warning "Failed to create admin user (may already exist)"
        fi
        
        print_success "Git server setup completed"
        return 0
    else
        print_status "Git server is disabled (ENABLE_GIT_SERVER=false)"
        return 0
    fi
}

# Function to build frontend with version information
build_frontend_version() {
    print_status "Building frontend with version information..."
    
    # Set build environment
    local build_env="${BUILD_ENV:-production}"
    
    # Get version information
    local version="v0.0.0-dev"
    local git_hash="unknown"
    local build_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u)
    
    # Try to get git information
    if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
        version=$(git describe --tags --exact-match HEAD 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0-dev")
        git_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        print_status "Git version: $version, Hash: $git_hash"
    else
        print_warning "Git not available or not in a git repository, using default version"
    fi
    
    # Create version.js file
    cat > frontend/version.js << EOF
// Version information - automatically generated during deployment
window.APP_VERSION = {
    version: '${version}',
    gitTag: '${version}',
    gitHash: '${git_hash}',
    buildDate: '${build_date}',
    buildEnv: '${build_env}'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.APP_VERSION;
}
EOF
    
    # Generate service worker from template
    local safe_version=$(echo "$version" | sed 's/[^a-zA-Z0-9]/_/g')
    
    print_status "Generating service worker from template..."
    
    if [ ! -f "frontend/sw.js.template" ]; then
        print_error "Service worker template not found: frontend/sw.js.template"
        exit 1
    fi
    
    # Generate sw.js from template
    cp frontend/sw.js.template frontend/sw.js
    
    # Replace placeholders
    sed -i "s/{{CACHE_VERSION}}/$safe_version/g" frontend/sw.js
    sed -i "s|{{STATIC_ASSETS_EXTRA}}|  '/version.js',\\n|g" frontend/sw.js
    
    print_success "Frontend version build completed: $version"
}

# Function to generate nginx configuration
generate_nginx_config() {
    local git_server_enabled=$(grep "^ENABLE_GIT_SERVER=" .env | cut -d'=' -f2)
    
    print_status "Generating nginx configuration..."
    
    # Ensure build directory exists
    mkdir -p build
    
    # Start with base template - generate to build directory
    cp nginx-base.conf.template build/nginx.conf.template
    
    if [ "$git_server_enabled" = "true" ]; then
        print_status "Including Git server configuration in nginx"
        # Replace placeholder with Git server configuration
        sed -i '/# GIT_SERVER_PLACEHOLDER/r nginx-git.conf.template' build/nginx.conf.template
        sed -i '/# GIT_SERVER_PLACEHOLDER/d' build/nginx.conf.template
    else
        print_status "Excluding Git server configuration from nginx"
        # Remove placeholder line
        sed -i '/# GIT_SERVER_PLACEHOLDER/d' build/nginx.conf.template
    fi
    
    print_status "Nginx configuration generated at build/nginx.conf.template"
}

# Function to deploy application
deploy_application() {
    local enable_git_server=${1:-false}
    local use_registry=${2:-false}
    
    print_status "Deploying XaresAICoder application..."
    
    # Build frontend with version information
    build_frontend_version
    
    # Generate appropriate nginx configuration
    generate_nginx_config
    
    # Stop existing containers
    print_status "Stopping existing containers..."
    $DOCKER_COMPOSE_CMD down --remove-orphans
    
    # Prepare Docker Compose services list
    local compose_services="server nginx"
    local git_server_enabled=$(grep "^ENABLE_GIT_SERVER=" .env | cut -d'=' -f2)
    
    if [ "$git_server_enabled" = "true" ]; then
        compose_services="$compose_services forgejo"
        print_status "Git server enabled - including Forgejo service"
    else
        print_status "Git server disabled - excluding Forgejo service"
    fi
    
    # Determine compose files and build flags
    local compose_files=""
    local build_flag=""
    
    if [ "$use_registry" = "true" ]; then
        # Use registry override to prevent building
        compose_files="-f docker-compose.yml -f docker-compose.registry.yml"
        build_flag=""  # No --build flag when using registry images
        print_status "Using pre-built images from registry (no local building)"
    else
        # Standard local build deployment
        compose_files=""  # Use default docker-compose.yml only
        build_flag="--build"
        print_status "Building and starting services..."
    fi
    
    if [ "$git_server_enabled" = "true" ]; then
        # Start all services including Git server using profile
        print_status "Enabling Git server profile"
        if $DOCKER_COMPOSE_CMD $compose_files --profile git-server up $build_flag -d; then
            print_success "Services started successfully (with Git server)"
        else
            print_error "Failed to start services"
            exit 1
        fi
    else
        # Start only core services (without Git server profile)
        print_status "Starting core services only"
        if $DOCKER_COMPOSE_CMD $compose_files up $build_flag -d; then
            print_success "Services started successfully (core only)"
        else
            print_error "Failed to start services"
            exit 1
        fi
    fi
    
    # Wait a moment for services to initialize
    print_status "Waiting for services to initialize..."
    sleep 5
    
    # Get configuration for health check
    BASE_DOMAIN=$(grep "^BASE_DOMAIN=" .env | cut -d'=' -f2)
    BASE_PORT=$(grep "^BASE_PORT=" .env | cut -d'=' -f2)
    PROTOCOL=$(grep "^PROTOCOL=" .env | cut -d'=' -f2)
    
    # Construct health check URL
    if [ "$BASE_PORT" = "80" ] && [ "$PROTOCOL" = "http" ]; then
        HEALTH_URL="http://${BASE_DOMAIN}/api/health"
    elif [ "$BASE_PORT" = "443" ] && [ "$PROTOCOL" = "https" ]; then
        HEALTH_URL="https://${BASE_DOMAIN}/api/health"
    else
        HEALTH_URL="${PROTOCOL}://${BASE_DOMAIN}:${BASE_PORT}/api/health"
    fi
    
    # Health check
    print_status "Performing health check..."
    print_status "Testing: $HEALTH_URL"
    
    for i in {1..10}; do
        if curl -s -f "$HEALTH_URL" >/dev/null 2>&1; then
            print_success "Health check passed!"
            break
        else
            if [ $i -eq 10 ]; then
                print_error "Health check failed after 10 attempts"
                print_status "Check the logs with: $DOCKER_COMPOSE_CMD logs"
                exit 1
            fi
            print_status "Health check attempt $i/10 failed, retrying in 3 seconds..."
            sleep 3
        fi
    done
    
    # Setup Git server if enabled
    if [ "$git_server_enabled" = "true" ]; then
        if setup_git_server; then
            print_success "Git server setup completed successfully!"
        else
            print_warning "Git server setup failed - manual setup required"
            print_status "Visit http://localhost/git/ to complete the installation manually"
            print_status "The Git server container is running and ready for manual setup"
        fi
    fi
}

# Function to show deployment information
show_deployment_info() {
    # Get configuration
    BASE_DOMAIN=$(grep "^BASE_DOMAIN=" .env | cut -d'=' -f2)
    BASE_PORT=$(grep "^BASE_PORT=" .env | cut -d'=' -f2)
    PROTOCOL=$(grep "^PROTOCOL=" .env | cut -d'=' -f2)
    GIT_SERVER_ENABLED=$(grep "^ENABLE_GIT_SERVER=" .env | cut -d'=' -f2)
    
    # Construct URLs
    if [ "$BASE_PORT" = "80" ] && [ "$PROTOCOL" = "http" ]; then
        MAIN_URL="http://${BASE_DOMAIN}"
    elif [ "$BASE_PORT" = "443" ] && [ "$PROTOCOL" = "https" ]; then
        MAIN_URL="https://${BASE_DOMAIN}"
    else
        MAIN_URL="${PROTOCOL}://${BASE_DOMAIN}:${BASE_PORT}"
    fi
    
    echo
    print_success "🎉 XaresAICoder deployed successfully!"
    echo
    echo "=============================================="
    echo "  📱 Access your application:"
    echo "     $MAIN_URL"
    echo
    echo "  🔧 API Health Check:"
    echo "     $MAIN_URL/api/health"
    echo
    
    # Show Git server info if enabled
    if [ "$GIT_SERVER_ENABLED" = "true" ]; then
        echo "  🗂️  Git Server (Forgejo):"
        echo "     $MAIN_URL/git/"
        echo "     Admin: $(grep "^GIT_ADMIN_USER=" .env | cut -d'=' -f2) / $(grep "^GIT_ADMIN_PASSWORD=" .env | cut -d'=' -f2)"
        echo
    fi
    
    echo "  📊 Workspace Pattern:"
    echo "     Workspaces will be accessible at:"
    echo "     ${PROTOCOL}://[workspace-id].${BASE_DOMAIN}$([ "$BASE_PORT" != "80" ] && [ "$BASE_PORT" != "443" ] && echo ":${BASE_PORT}")"
    echo
    echo "  🐳 Management Commands:"
    echo "     View logs:    $DOCKER_COMPOSE_CMD logs"
    echo "     Stop:         $DOCKER_COMPOSE_CMD down"
    echo "     Restart:      $DOCKER_COMPOSE_CMD restart"
    echo "=============================================="
    echo
}

# Function to detect GitHub repository owner
detect_registry_owner() {
    local owner=""
    
    # Try to detect from git remote
    if command_exists git && git rev-parse --git-dir >/dev/null 2>&1; then
        local remote_url=$(git remote get-url origin 2>/dev/null || echo "")
        if [[ $remote_url =~ github\.com[:/]([^/]+)/([^/]+) ]]; then
            owner="${BASH_REMATCH[1]}"
            # Convert to lowercase for consistency with GitHub Container Registry
            owner=$(echo "$owner" | tr '[:upper:]' '[:lower:]')
            # Use stderr for status messages to avoid mixing with return value
            print_status "Auto-detected GitHub owner: $owner" >&2
        fi
    fi
    
    # If we couldn't detect, ask user
    if [ -z "$owner" ]; then
        print_warning "Could not auto-detect GitHub repository owner" >&2
        read -p "Enter your GitHub username/organization: " owner >&2
        if [ -z "$owner" ]; then
            print_error "GitHub owner is required for registry images" >&2
            exit 1
        fi
    fi
    
    echo "$owner"
}

# Function to setup registry images
setup_registry_images() {
    local registry_owner="$1"
    local tag="${2:-latest}"
    
    print_status "Configuring pre-built images from GitHub Container Registry..."
    
    # Set image environment variables (registry names are always lowercase)
    local registry_owner_lower=$(echo "$registry_owner" | tr '[:upper:]' '[:lower:]')
    export SERVER_IMAGE="ghcr.io/${registry_owner_lower}/xaresaicoder-server:${tag}"
    export CODESERVER_IMAGE="ghcr.io/${registry_owner_lower}/xaresaicoder-codeserver:${tag}"
    
    print_status "Server image: $SERVER_IMAGE"
    print_status "Code-server image: $CODESERVER_IMAGE"
    
    # Check if we need to authenticate to pull images
    print_status "Checking image availability..."
    
    # Try to pull the images to verify they exist and we have access
    if ! docker pull "$SERVER_IMAGE" >/dev/null 2>&1; then
        print_warning "Could not pull server image: $SERVER_IMAGE"
        print_warning "Make sure:"
        print_warning "1. The image exists in the registry"
        print_warning "2. You have access to the repository"
        print_warning "3. You are logged in to GitHub Container Registry if the repository is private"
        echo
        read -p "Continue anyway? The build might fail. (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_success "Server image is accessible"
    fi
    
    if ! docker pull "$CODESERVER_IMAGE" >/dev/null 2>&1; then
        print_warning "Could not pull code-server image: $CODESERVER_IMAGE"
        print_warning "Make sure:"
        print_warning "1. The image exists in the registry"
        print_warning "2. You have access to the repository"
        print_warning "3. You are logged in to GitHub Container Registry if the repository is private"
        echo
        read -p "Continue anyway? The build might fail. (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_success "Code-server image is accessible"
    fi
    
    # Update .env file with registry configuration
    if [ -f ".env" ]; then
        # Add or update registry image settings
        if grep -q "^USE_REGISTRY_IMAGES=" .env; then
            sed -i 's/^USE_REGISTRY_IMAGES=.*/USE_REGISTRY_IMAGES=true/' .env
        else
            echo "USE_REGISTRY_IMAGES=true" >> .env
        fi
        
        if grep -q "^SERVER_IMAGE=" .env; then
            sed -i "s|^SERVER_IMAGE=.*|SERVER_IMAGE=$SERVER_IMAGE|" .env
        else
            echo "SERVER_IMAGE=$SERVER_IMAGE" >> .env
        fi
        
        if grep -q "^CODESERVER_IMAGE=" .env; then
            sed -i "s|^CODESERVER_IMAGE=.*|CODESERVER_IMAGE=$CODESERVER_IMAGE|" .env
        else
            echo "CODESERVER_IMAGE=$CODESERVER_IMAGE" >> .env
        fi
        
        print_success "Updated .env with registry image configuration"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo
    echo "Options:"
    echo "  --skip-build          Skip building the code-server image"
    echo "  --skip-env            Skip environment setup (use existing .env)"
    echo "  --skip-network        Skip Docker network setup (use existing network)"
    echo "  --build-only          Only build the code-server image, don't deploy"
    echo "  --git-server          Enable integrated Forgejo Git server"
    echo "  --use-registry        Use pre-built images from GitHub Container Registry"
    echo "  --registry-owner      GitHub username/organization (default: auto-detect from git)"
    echo "  --registry-tag        Image tag to use from registry (default: latest)"
    echo "  --help               Show this help message"
    echo
    echo "Examples:"
    echo "  $0                           # Full deployment (recommended)"
    echo "  $0 --git-server             # Deploy with integrated Git server"
    echo "  $0 --skip-build             # Deploy without rebuilding image"
    echo "  $0 --build-only             # Only build the code-server image"
    echo "  $0 --use-registry           # Use pre-built images from GitHub registry"
    echo "  $0 --use-registry --registry-owner myuser  # Use specific registry owner"
    echo "  $0 --use-registry --registry-tag v1.0.0    # Use specific version tag"
    echo
}

# Main deployment flow
main() {
    local skip_build=false
    local skip_env=false
    local skip_network=false
    local build_only=false
    local enable_git_server=false
    local use_registry=false
    local registry_owner=""
    local registry_tag="latest"
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-build)
                skip_build=true
                shift
                ;;
            --skip-env)
                skip_env=true
                shift
                ;;
            --skip-network)
                skip_network=true
                shift
                ;;
            --build-only)
                build_only=true
                shift
                ;;
            --git-server)
                enable_git_server=true
                shift
                ;;
            --use-registry)
                use_registry=true
                skip_build=true  # Skip building when using registry
                shift
                ;;
            --registry-owner)
                registry_owner="$2"
                shift 2
                ;;
            --registry-tag)
                registry_tag="$2"
                shift 2
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    echo "🚀 XaresAICoder Deployment Script"
    echo "=================================="
    echo
    
    # Check prerequisites
    check_prerequisites
    
    # Handle registry images setup
    if [ "$use_registry" = true ]; then
        if [ -z "$registry_owner" ]; then
            registry_owner=$(detect_registry_owner)
        fi
        setup_registry_images "$registry_owner" "$registry_tag"
    fi
    
    # Build code-server image
    if [ "$skip_build" = false ]; then
        build_code_server_image
    else
        print_status "Skipping code-server image build"
    fi
    
    # If build-only, exit here
    if [ "$build_only" = true ]; then
        print_success "Code-server image build completed"
        exit 0
    fi
    
    # Setup environment
    if [ "$skip_env" = false ]; then
        setup_environment "$enable_git_server"
    else
        print_status "Skipping environment setup"
    fi
    
    # Setup Docker network (required for workspace persistence)
    if [ "$skip_network" = false ]; then
        setup_network
    else
        print_status "Skipping Docker network setup"
    fi
    
    # Deploy application
    deploy_application "$enable_git_server" "$use_registry"
    
    # Show deployment information
    show_deployment_info
    
    print_success "Deployment completed successfully! 🎉"
}

# Run main function with all arguments
main "$@"