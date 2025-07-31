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
    
    # Show current configuration
    print_status "Current configuration:"
    echo "----------------------------------------"
    grep -E "BASE_DOMAIN|BASE_PORT|PROTOCOL" .env | sed 's/^/  /'
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

# Function to deploy application
deploy_application() {
    print_status "Deploying XaresAICoder application..."
    
    # Stop existing containers
    print_status "Stopping existing containers..."
    $DOCKER_COMPOSE_CMD down --remove-orphans
    
    # Build and start services
    print_status "Building and starting services..."
    if $DOCKER_COMPOSE_CMD up --build -d; then
        print_success "Services started successfully"
    else
        print_error "Failed to start services"
        exit 1
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
}

# Function to show deployment information
show_deployment_info() {
    # Get configuration
    BASE_DOMAIN=$(grep "^BASE_DOMAIN=" .env | cut -d'=' -f2)
    BASE_PORT=$(grep "^BASE_PORT=" .env | cut -d'=' -f2)
    PROTOCOL=$(grep "^PROTOCOL=" .env | cut -d'=' -f2)
    
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

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo
    echo "Options:"
    echo "  --skip-build          Skip building the code-server image"
    echo "  --skip-env            Skip environment setup (use existing .env)"
    echo "  --skip-network        Skip Docker network setup (use existing network)"
    echo "  --build-only          Only build the code-server image, don't deploy"
    echo "  --help               Show this help message"
    echo
    echo "Examples:"
    echo "  $0                           # Full deployment (recommended)"
    echo "  $0 --skip-build             # Deploy without rebuilding image"
    echo "  $0 --build-only             # Only build the code-server image"
    echo
}

# Main deployment flow
main() {
    local skip_build=false
    local skip_env=false
    local skip_network=false
    local build_only=false
    
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
        setup_environment
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
    deploy_application
    
    # Show deployment information
    show_deployment_info
    
    print_success "Deployment completed successfully! 🎉"
}

# Run main function with all arguments
main "$@"