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

# Cross-platform sed -i wrapper (GNU-sed on Linux, BSD-sed on macOS)
# BSD-sed requires an explicit backup suffix after -i (empty '' = no backup);
# GNU-sed treats anything after -i as the script unless given a suffix.
if sed --version 2>/dev/null | grep -q GNU; then
    sed_inplace() { command sed -i "$@"; }
else
    sed_inplace() { command sed -i '' "$@"; }
fi

# Prompts read with '|| REPLY=""': without a terminal (CI, cron, </dev/null)
# read fails at EOF, which would end the script silently under set -e; the
# empty answer picks each prompt's default instead.

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
    
    # Ensure squid CA placeholder exists so the Dockerfile COPY succeeds on clean checkouts
    # (the real cert is written by generate_proxy_cert when --enable-proxy is used)
    if [ ! -f "./code-server/squid-ca-cert.crt" ]; then
        print_status "Creating empty Squid CA placeholder for code-server build context..."
        : > ./code-server/squid-ca-cert.crt
    fi

    cd code-server

    # Check if image already exists
    if docker images | grep -q "xares-aicoder-codeserver.*latest"; then
        print_warning "xares-aicoder-codeserver:latest already exists"
        read -p "Do you want to rebuild it? (y/N): " -n 1 -r || REPLY=""
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
    # true = enable, false = disable, empty = keep the value in .env
    local enable_git_server=$1
    local enable_proxy=$2
    
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
        read -p "Choose an option (1-3): " -n 1 -r || REPLY=""
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
    
    apply_env_settings "$enable_git_server" "$enable_proxy"

    # Show current configuration
    print_status "Current configuration:"
    echo "----------------------------------------"
    grep -E "BASE_DOMAIN|BASE_PORT|PROTOCOL|ENABLE_GIT_SERVER" .env | sed 's/^/  /'
    echo "----------------------------------------"
    
    # Ask if user wants to edit
    read -p "Do you want to edit the configuration? (y/N): " -n 1 -r || REPLY=""
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
    fi
}

# The non-interactive part of the environment setup; also runs with
# --skip-env, so explicit feature flags and the checks always apply.
#   $1/$2: true = enable, false = disable, empty = keep the value in .env
apply_env_settings() {
    local enable_git_server=$1
    local enable_proxy=$2

    # Feature flags are sticky: --git-server / --enable-proxy switch a feature
    # on, --disable-git-server / --disable-proxy off, and without a flag the
    # value in .env stays (a forgotten flag no longer turns a feature off).
    set_feature_flag ENABLE_GIT_SERVER "$enable_git_server" "Git server"
    set_feature_flag ENABLE_PROXY "$enable_proxy" "proxy"

    if [ "$(grep "^ENABLE_PROXY=" .env | cut -d'=' -f2)" = "true" ]; then
        # Check the subnets of both proxy networks for conflicts (with
        # existing Docker networks and with each other)
        local security_subnet=$(grep "^SECURITY_NETWORK_SUBNET=" .env | cut -d'=' -f2)
        configure_proxy_subnet INTERNAL_NETWORK_SUBNET 172.30.0.0/16 xares-internal \
            DNSMASQ_IP 0.2 "${security_subnet:-172.31.0.0/16}" \
            "172.28.0.0/16 172.25.0.0/16 10.100.0.0/16"
        local internal_subnet=$(grep "^INTERNAL_NETWORK_SUBNET=" .env | cut -d'=' -f2)
        configure_proxy_subnet SECURITY_NETWORK_SUBNET 172.31.0.0/16 xares-security \
            SECURITY_DNSMASQ_IP 255.254 "${internal_subnet:-172.30.0.0/16}" \
            "172.29.0.0/16 172.26.0.0/16 10.101.0.0/16"
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
}

# Writes a random value for an .env key that is missing or empty (also with
# --skip-env). Prints the new value, nothing if the key was already set.
#   $1 key   $2 length   $3 comment line for a newly appended key
ensure_generated_secret() {
    local key="$1" length="$2" comment="$3"
    [ -f .env ] || return 0
    local current=$(grep "^${key}=" .env | cut -d'=' -f2-)
    [ -n "$current" ] && return 0

    local value=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c "$length")
    if grep -q "^${key}=" .env; then
        sed_inplace "s|^${key}=.*|${key}=$value|" .env
    else
        printf '\n# %s\n%s=%s\n' "$comment" "$key" "$value" >> .env
    fi
    echo "$value"
}

# The platform API requires an admin login (locked without ADMIN_PASSWORD).
# Forgejo needs its own SECRET_KEY; the old compose file shipped a public
# placeholder, which is replaced here as well.
GENERATED_ADMIN_PASSWORD=""
ensure_admin_password() {
    GENERATED_ADMIN_PASSWORD=$(ensure_generated_secret ADMIN_PASSWORD 24 "Admin login for the dashboard/API (generated by deploy.sh)")
    [ -n "$GENERATED_ADMIN_PASSWORD" ] && print_success "Generated an admin password (ADMIN_PASSWORD in .env)"
    if [ -n "$(ensure_generated_secret FORGEJO_SECRET_KEY 64 "Forgejo SECRET_KEY (generated by deploy.sh; changing it invalidates Forgejo sessions and encrypted secrets)")" ]; then
        print_success "Generated a Forgejo secret key (FORGEJO_SECRET_KEY in .env)"
    fi
    # .env holds these secrets and the Forgejo admin password: owner only
    # (it was created from .env.example with the umask, mostly 644)
    if [ -f .env ]; then
        chmod 600 .env
    fi
    return 0
}

# Workspaces created before per-workspace Forgejo users received the admin
# password. Replace the well-known default once, so the copies left in old
# containers stop working (--rotate-git-password forces a new one). The API
# server is recreated afterwards to pick it up.
ROTATE_GIT_PASSWORD=false
GIT_PASSWORD_ROTATED=false
rotate_git_admin_password() {
    local compose_files="$1" profiles="$2"
    local user=$(grep "^GIT_ADMIN_USER=" .env | cut -d'=' -f2)
    local current=$(grep "^GIT_ADMIN_PASSWORD=" .env | cut -d'=' -f2-)
    user=${user:-developer}
    if [ "$ROTATE_GIT_PASSWORD" != true ] && [ -n "$current" ] && [ "$current" != "admin123!" ]; then
        return 0
    fi

    local new_password=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 24)
    if ! docker exec -u git xaresaicoder-forgejo forgejo admin user change-password \
            --username "$user" --password "$new_password" --must-change-password=false >/dev/null 2>&1; then
        print_warning "Could not change the Forgejo admin password - keeping the current one"
        return 0
    fi
    local key
    for key in GIT_ADMIN_PASSWORD GIT_ADMIN_BOOTSTRAP_PASSWORD; do
        if grep -q "^${key}=" .env; then
            sed_inplace "s|^${key}=.*|${key}=$new_password|" .env
        else
            echo "${key}=$new_password" >> .env
        fi
    done
    GIT_PASSWORD_ROTATED=true
    print_success "Rotated the Forgejo admin password (GIT_ADMIN_PASSWORD in .env)"
    $DOCKER_COMPOSE_CMD $compose_files $profiles up -d --no-deps server
}

# Sets an ENABLE_* key in .env: $2 is true, false, or empty to keep the
# current value (false if the key is missing). $3 names it in the output.
set_feature_flag() {
    local key="$1" wanted="$2" label="$3"
    local current=$(grep "^${key}=" .env | cut -d'=' -f2)
    if [ -z "$wanted" ]; then
        wanted=${current:-false}
        print_status "Keeping $label setting from .env: $key=$wanted"
    else
        print_status "Setting $key=$wanted"
    fi
    if grep -q "^${key}=" .env; then
        sed_inplace "s|^${key}=.*|${key}=$wanted|" .env
    else
        echo "${key}=$wanted" >> .env
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

# Checks one proxy network subnet and writes an alternative (plus the
# matching dnsmasq address) to .env if it conflicts.
#   $1 .env key of the subnet          $2 default subnet
#   $3 Docker network name to skip     $4 .env key of the dnsmasq address
#   $5 host part of the dnsmasq address within the /16 (e.g. 0.2)
#   $6 subnet of the other proxy network   $7 alternatives (space separated)
configure_proxy_subnet() {
    local key="$1" default_subnet="$2" own_network="$3" dns_key="$4" dns_host="$5"
    local current_subnet=$(grep "^${key}=" .env | cut -d'=' -f2)
    current_subnet=${current_subnet:-$default_subnet}

    # `|| rc=$?` keeps set -e from aborting the deploy when no subnet is found
    local suggested_subnet subnet_check_rc=0
    suggested_subnet=$(check_internal_network_subnet "$current_subnet" "$own_network" "$6" "$7") || subnet_check_rc=$?

    if [ $subnet_check_rc -ne 0 ] || [ -z "$suggested_subnet" ]; then
        # No usable subnet determined — keep the existing configuration
        # rather than writing an empty value into .env.
        print_warning "Keeping configured subnet $key=$current_subnet"
    elif [ "$suggested_subnet" != "$current_subnet" ]; then
        print_warning "Using alternative subnet: $key=$suggested_subnet"
        if grep -q "^${key}=" .env; then
            sed_inplace "s|^${key}=.*|${key}=$suggested_subnet|" .env
        else
            echo "${key}=$suggested_subnet" >> .env
        fi

        local new_dns_ip=$(echo "$suggested_subnet" | sed "s|0\.0/16|${dns_host}|")
        if grep -q "^${dns_key}=" .env; then
            sed_inplace "s|^${dns_key}=.*|${dns_key}=$new_dns_ip|" .env
        else
            echo "${dns_key}=$new_dns_ip" >> .env
        fi

        if [ "$key" = "INTERNAL_NETWORK_SUBNET" ]; then
            print_warning "IMPORTANT: docker-compose.yml pins nginx and mitmproxy to 172.30.0.4/172.30.0.5 on xares-internal; adjust them to $suggested_subnet"
        fi
    fi
}

# Function to check a proxy network subnet for conflicts. Prints the subnet
# to use (the requested one or a free alternative).
#   $1 requested subnet   $2 own network name (skipped on re-deploy)
#   $3 further reserved subnets   $4 alternatives (space separated)
check_internal_network_subnet() {
    local requested_subnet="${1:-172.30.0.0/16}"
    local own_network="${2:-xares-internal}"
    local reserved="$3"
    local alternatives_list="${4:-172.28.0.0/16 172.25.0.0/16 10.100.0.0/16}"

    print_status "Checking subnet for $own_network: $requested_subnet" >&2

    # Get all existing network subnets, excluding our own network: on a
    # re-deploy it already exists with exactly the requested subnet and would
    # otherwise be reported as a conflict with itself.
    local existing_subnets=$(docker network ls --format "{{.Name}}" | grep -v -- "$own_network" | while read network; do
        docker network inspect "$network" --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | grep -v ": $" || true
    done)
    # The other proxy network may not exist yet, but must not overlap either
    for subnet in $reserved; do
        existing_subnets="$existing_subnets
(reserved for the other proxy network): $subnet"
    done

    if [ -n "$existing_subnets" ]; then
        # Check for overlaps using Python if available
        if command -v python3 >/dev/null 2>&1; then
            local conflicts=$(echo "$existing_subnets" | python3 -c "
import sys
import ipaddress

requested = ipaddress.IPv4Network('$requested_subnet', strict=False)
conflicts = []

for line in sys.stdin:
    if ':' in line:
        network_name = line.split(':')[0].strip()
        subnets = line.split(':')[1].strip().split()
        for subnet in subnets:
            if subnet and '/' in subnet:
                try:
                    existing = ipaddress.IPv4Network(subnet.strip(), strict=False)
                    if requested.overlaps(existing):
                        conflicts.append(f'{network_name} ({subnet})')
                except:
                    pass

if conflicts:
    print('\\n'.join(conflicts))
" 2>/dev/null || true)

            if [ -n "$conflicts" ]; then
                print_warning "Subnet $requested_subnet for $own_network conflicts with:" >&2
                echo "$conflicts" | sed 's/^/  - /' >&2
                echo >&2

                # Suggest alternative
                local alt
                for alt in $alternatives_list; do
                    # The snippet exits 1 on overlap, 0 when the candidate is
                    # free — so a zero status is what qualifies an alternative.
                    if echo "$existing_subnets" | python3 -c "
import sys
import ipaddress
requested = ipaddress.IPv4Network('$alt', strict=False)
for line in sys.stdin:
    if ':' in line:
        subnets = line.split(':')[1].strip().split()
        for subnet in subnets:
            if subnet and '/' in subnet:
                try:
                    existing = ipaddress.IPv4Network(subnet.strip(), strict=False)
                except ValueError:
                    continue
                if requested.overlaps(existing):
                    sys.exit(1)
" 2>/dev/null; then
                        print_success "Suggested alternative subnet: $alt" >&2
                        echo "$alt"
                        return 0
                    fi
                done

                print_warning "No automatic alternative found. Please configure manually." >&2
                return 1
            fi
        fi
    fi

    print_success "No conflicts detected for $own_network subnet" >&2
    echo "$requested_subnet"
    return 0
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
        # Password used only to CREATE the Forgejo account. Kept separate because
        # GIT_ADMIN_PASSWORD is shipped into every workspace and may hold a token.
        local GIT_ADMIN_BOOTSTRAP_PASSWORD=$(grep "^GIT_ADMIN_BOOTSTRAP_PASSWORD=" .env | cut -d'=' -f2)
        local GIT_ADMIN_EMAIL=$(grep "^GIT_ADMIN_EMAIL=" .env | cut -d'=' -f2)
        local GIT_SITE_NAME=$(grep "^GIT_SITE_NAME=" .env | cut -d'=' -f2)
        
        # Set defaults if not found
        BASE_DOMAIN=${BASE_DOMAIN:-localhost}
        BASE_PORT=${BASE_PORT:-80}
        PROTOCOL=${PROTOCOL:-http}
        GIT_ADMIN_USER=${GIT_ADMIN_USER:-developer}
        GIT_ADMIN_PASSWORD=${GIT_ADMIN_PASSWORD:-admin123!}
        GIT_ADMIN_BOOTSTRAP_PASSWORD=${GIT_ADMIN_BOOTSTRAP_PASSWORD:-$GIT_ADMIN_PASSWORD}
        GIT_ADMIN_EMAIL=${GIT_ADMIN_EMAIL:-gitadmin@xaresaicoder.local}
        GIT_SITE_NAME=${GIT_SITE_NAME:-XaresAICoder Git Server}
        
        # Export variables for the setup script
        export BASE_DOMAIN BASE_PORT PROTOCOL GIT_ADMIN_USER GIT_ADMIN_PASSWORD GIT_ADMIN_BOOTSTRAP_PASSWORD GIT_ADMIN_EMAIL GIT_SITE_NAME
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
            --password "$GIT_ADMIN_BOOTSTRAP_PASSWORD" \
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
    
    # Generate service worker from template. The cache version changes on
    # every deploy (tag + commit + build time), so browsers always pick up the
    # new service worker and drop the old caches – also for untagged deploys.
    local safe_version=$(echo "${version}-${git_hash}-${build_date}" | sed 's/[^a-zA-Z0-9]/_/g')
    
    print_status "Generating service worker from template..."
    
    if [ ! -f "frontend/sw.js.template" ]; then
        print_error "Service worker template not found: frontend/sw.js.template"
        exit 1
    fi
    
    # Generate sw.js from template
    cp frontend/sw.js.template frontend/sw.js
    
    # Replace placeholders
    sed_inplace "s/{{CACHE_VERSION}}/$safe_version/g" frontend/sw.js
    sed_inplace "s|{{STATIC_ASSETS_EXTRA}}|  '/version.js',\\n|g" frontend/sw.js
    
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
        sed_inplace '/# GIT_SERVER_PLACEHOLDER/r nginx-git.conf.template' build/nginx.conf.template
        sed_inplace '/# GIT_SERVER_PLACEHOLDER/d' build/nginx.conf.template
    else
        print_status "Excluding Git server configuration from nginx"
        # Remove placeholder line
        sed_inplace '/# GIT_SERVER_PLACEHOLDER/d' build/nginx.conf.template
    fi
    
    print_status "Nginx configuration generated at build/nginx.conf.template"
}

# Function to deploy application
deploy_application() {
    local enable_git_server=${1:-false}
    local enable_proxy=${2:-false}
    local use_registry=${3:-false}
    
    print_status "Deploying XaresAICoder application..."
    
    # Build frontend with version information
    build_frontend_version
    
    # Generate appropriate nginx configuration
    generate_nginx_config
    
    # Read enabled features from .env
    local git_server_enabled=$(grep "^ENABLE_GIT_SERVER=" .env | cut -d'=' -f2)
    local proxy_enabled=$(grep "^ENABLE_PROXY=" .env | cut -d'=' -f2)

    # Build profiles string based on enabled features
    local profiles=""
    if [ "$git_server_enabled" = "true" ]; then
        profiles="--profile git-server"
        print_status "Git server enabled - including Forgejo service"
    fi
    if [ "$proxy_enabled" = "true" ]; then
        profiles="$profiles --profile proxy"
        print_status "Proxy enabled - including Squid service"
    fi

    # Stop existing containers (include profiles so profiled services are also removed)
    print_status "Stopping existing containers..."
    $DOCKER_COMPOSE_CMD $profiles down --remove-orphans

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

    # Start services with appropriate profiles
    if [ -n "$profiles" ]; then
        print_status "Starting services with profiles:$profiles"
        if $DOCKER_COMPOSE_CMD $compose_files $profiles up $build_flag -d; then
            print_success "Services started successfully"
        else
            print_error "Failed to start services"
            exit 1
        fi
    else
        # Start only core services (no profiles)
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
    HOST_PORT=$(grep "^HOST_PORT=" .env | cut -d'=' -f2)
    HOST_PORT=${HOST_PORT:-80}
    HOST_PORT=${HOST_PORT##*:}  # port of a loopback binding like 127.0.0.1:8080

    # Construct health check URL.
    # nginx routes by Host header and its default_server returns 404 for unknown
    # hosts (incl. "localhost"), so when hitting localhost we must override the
    # Host header to BASE_DOMAIN.
    CURL_HOST_HEADER=""
    if [ "$BASE_PORT" = "443" ] && [ "$PROTOCOL" = "https" ] && [ "$HOST_PORT" != "443" ]; then
        HEALTH_URL="http://localhost:${HOST_PORT}/api/health"
        CURL_HOST_HEADER="Host: ${BASE_DOMAIN}"
        print_status "External SSL proxy detected - checking internal service"
    elif [ "$BASE_PORT" = "80" ] && [ "$PROTOCOL" = "http" ]; then
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
        if [ -n "$CURL_HOST_HEADER" ]; then
            curl_ok=$(curl -s -f -H "$CURL_HOST_HEADER" "$HEALTH_URL" >/dev/null 2>&1 && echo yes || echo no)
        else
            curl_ok=$(curl -s -f "$HEALTH_URL" >/dev/null 2>&1 && echo yes || echo no)
        fi
        if [ "$curl_ok" = "yes" ]; then
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
            rotate_git_admin_password "$compose_files" "$profiles"
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
    if [ "$GIT_PASSWORD_ROTATED" = true ]; then
        echo "  🗂️  Forgejo admin password was rotated:"
        echo "     log in to /git/ with GIT_ADMIN_USER / GIT_ADMIN_PASSWORD from .env"
        echo
    fi
    echo "  🔑 Admin login:"
    if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
        echo "     $GENERATED_ADMIN_PASSWORD   (new, stored in .env as ADMIN_PASSWORD)"
    else
        echo "     password from .env (ADMIN_PASSWORD)"
    fi
    echo
    
    # Show Git server info if enabled
    if [ "$GIT_SERVER_ENABLED" = "true" ]; then
        echo "  🗂️  Git Server (Forgejo):"
        echo "     $MAIN_URL/git/"
        # Prefer the bootstrap password here: GIT_ADMIN_PASSWORD may hold a token.
        echo "     Admin: $(grep "^GIT_ADMIN_USER=" .env | cut -d'=' -f2) / $(grep -m1 -E "^GIT_ADMIN_(BOOTSTRAP_)?PASSWORD=" .env | cut -d'=' -f2-)"
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

# Global variable set by detect_registry_owner() as a side effect
DETECTED_REPO_NAME=""

# Function to detect GitHub repository owner (also sets DETECTED_REPO_NAME)
detect_registry_owner() {
    local owner=""

    # Try to detect from git remote
    if command_exists git && git rev-parse --git-dir >/dev/null 2>&1; then
        local remote_url=$(git remote get-url origin 2>/dev/null || echo "")
        if [[ $remote_url =~ github\.com[:/]([^/]+)/([^/]+) ]]; then
            owner="${BASH_REMATCH[1]}"
            DETECTED_REPO_NAME="${BASH_REMATCH[2]}"
            DETECTED_REPO_NAME="${DETECTED_REPO_NAME%.git}"
            # Convert to lowercase for consistency with GitHub Container Registry
            owner=$(echo "$owner" | tr '[:upper:]' '[:lower:]')
            # Use stderr for status messages to avoid mixing with return value
            print_status "Auto-detected GitHub owner: $owner" >&2
            print_status "Auto-detected repository: $DETECTED_REPO_NAME" >&2
        fi
    fi

    # If we couldn't detect, ask user
    if [ -z "$owner" ]; then
        print_warning "Could not auto-detect GitHub repository owner" >&2
        read -p "Enter your GitHub username/organization: " owner >&2 || owner=""
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
    local repo_name="${3:-xaresaicoder}"

    print_status "Configuring pre-built images from GitHub Container Registry..."

    # Set image environment variables (registry names are always lowercase)
    local registry_owner_lower=$(echo "$registry_owner" | tr '[:upper:]' '[:lower:]')
    local repo_lower=$(echo "$repo_name" | tr '[:upper:]' '[:lower:]')
    export SERVER_IMAGE="ghcr.io/${registry_owner_lower}/${repo_lower}-server:${tag}"
    export CODESERVER_IMAGE="ghcr.io/${registry_owner_lower}/${repo_lower}-codeserver:${tag}"
    
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
        read -p "Continue anyway? The build might fail. (y/N): " -n 1 -r || REPLY=""
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
        read -p "Continue anyway? The build might fail. (y/N): " -n 1 -r || REPLY=""
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
            sed_inplace 's/^USE_REGISTRY_IMAGES=.*/USE_REGISTRY_IMAGES=true/' .env
        else
            echo "USE_REGISTRY_IMAGES=true" >> .env
        fi
        
        if grep -q "^SERVER_IMAGE=" .env; then
            sed_inplace "s|^SERVER_IMAGE=.*|SERVER_IMAGE=$SERVER_IMAGE|" .env
        else
            echo "SERVER_IMAGE=$SERVER_IMAGE" >> .env
        fi
        
        if grep -q "^CODESERVER_IMAGE=" .env; then
            sed_inplace "s|^CODESERVER_IMAGE=.*|CODESERVER_IMAGE=$CODESERVER_IMAGE|" .env
        else
            echo "CODESERVER_IMAGE=$CODESERVER_IMAGE" >> .env
        fi
        
        print_success "Updated .env with registry image configuration"
    fi
}

# Function to generate Squid SSL CA certificate
generate_proxy_cert() {
    print_status "Checking Squid SSL CA certificate..."

    if [ -f "./squid/certs/squid-ca-cert.pem" ]; then
        print_success "SSL CA certificate already exists"
    else
        print_status "Generating SSL CA certificate for HTTPS interception..."
        chmod +x ./squid/generate-ca-cert.sh

        if ./squid/generate-ca-cert.sh; then
            print_success "SSL CA certificate generated successfully"
        else
            print_error "Failed to generate SSL CA certificate"
            exit 1
        fi
    fi

    # Copy certificate to code-server directory for Docker build
    if [ -f "./squid/certs/squid-ca-cert.crt" ]; then
        print_status "Copying CA certificate to code-server build context..."
        cp ./squid/certs/squid-ca-cert.crt ./code-server/squid-ca-cert.crt
        print_success "CA certificate ready for code-server image build"
    fi

    # Generate mitmproxy-compatible CA from squid CA (combined cert+key PEM)
    # mitmproxy expects mitmproxy-ca.pem in its confdir; without it, it auto-generates a different CA
    if [ -f "./squid/certs/squid-ca-cert.pem" ] && [ -f "./squid/certs/squid-ca-key.pem" ]; then
        print_status "Generating mitmproxy-compatible CA from squid CA..."
        # mitmproxy-ca.pem contains the CA private key: create it owner-only
        # (mitmproxy runs as root and can still read it). Every workspace
        # trusts this CA, so a readable key would allow intercepting their TLS.
        (umask 077 && cat ./squid/certs/squid-ca-key.pem ./squid/certs/squid-ca-cert.pem > ./squid/certs/mitmproxy-ca.pem)
        cp ./squid/certs/squid-ca-cert.pem ./squid/certs/mitmproxy-ca-cert.pem
        print_success "mitmproxy CA generated from squid CA"
    fi

    # Also tighten keys created by earlier versions of this script
    for key_file in ./squid/certs/squid-ca-key.pem ./squid/certs/mitmproxy-ca.pem; do
        if [ -f "$key_file" ]; then
            chmod 600 "$key_file"
        fi
    done
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [options]"
    echo
    echo "Options:"
    echo "  --skip-build          Skip building the code-server image"
    echo "  --skip-env            Skip the interactive environment setup (use existing .env; flags still apply)"
    echo "  --skip-network        Skip Docker network setup (use existing network)"
    echo "  --rotate-git-password Set a new random Forgejo admin password (done automatically while it is the default)"
    echo "  --build-only          Only build the code-server image, don't deploy"
    echo "  --git-server          Enable integrated Forgejo Git server"
    echo "  --enable-proxy        Enable Squid transparent proxy for network access control"
    echo "  --disable-git-server  Turn the Git server off (without a flag the .env setting is kept)"
    echo "  --disable-proxy       Turn the proxy off (without a flag the .env setting is kept)"
    echo "  --use-registry        Use pre-built images from GitHub Container Registry"
    echo "  --registry-owner      GitHub username/organization (default: auto-detect from git)"
    echo "  --registry-tag        Image tag to use from registry (default: latest)"
    echo "  --help               Show this help message"
    echo
    echo "Examples:"
    echo "  $0                           # Full deployment (recommended)"
    echo "  $0 --git-server             # Deploy with integrated Git server"
    echo "  $0 --enable-proxy           # Deploy with network access proxy"
    echo "  $0 --git-server --enable-proxy  # Deploy with both Git server and proxy"
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
    local enable_git_server=""   # true / false / empty = keep .env
    local enable_proxy=""
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
            --rotate-git-password)
                ROTATE_GIT_PASSWORD=true
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
            --disable-git-server)
                enable_git_server=false
                shift
                ;;
            --disable-proxy)
                enable_proxy=false
                shift
                ;;
            --enable-proxy)
                enable_proxy=true
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
        # Detect repo name from git if not already detected (e.g. when --registry-owner was used)
        if [ -z "$DETECTED_REPO_NAME" ] && command_exists git && git rev-parse --git-dir >/dev/null 2>&1; then
            local remote_url=$(git remote get-url origin 2>/dev/null || echo "")
            if [[ $remote_url =~ github\.com[:/]([^/]+)/([^/]+) ]]; then
                DETECTED_REPO_NAME="${BASH_REMATCH[2]}"
                DETECTED_REPO_NAME="${DETECTED_REPO_NAME%.git}"
            fi
        fi
        local repo_name="${DETECTED_REPO_NAME:-xaresaicoder}"
        setup_registry_images "$registry_owner" "$registry_tag" "$repo_name"
    fi

    # Generate proxy CA certificate if proxy is enabled (by flag or in .env)
    if [ "$enable_proxy" = true ] || { [ -z "$enable_proxy" ] && grep -q "^ENABLE_PROXY=true" .env 2>/dev/null; }; then
        generate_proxy_cert
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
        setup_environment "$enable_git_server" "$enable_proxy"
    else
        if [ ! -f .env ]; then
            print_error "--skip-env needs an existing .env (run without it to create one)"
            exit 1
        fi
        print_status "Skipping the interactive environment setup"
        apply_env_settings "$enable_git_server" "$enable_proxy"
    fi
    ensure_admin_password

    # Setup Docker network (required for workspace persistence)
    if [ "$skip_network" = false ]; then
        setup_network
    else
        print_status "Skipping Docker network setup"
    fi

    # Deploy application
    deploy_application "$enable_git_server" "$enable_proxy" "$use_registry"
    
    # Show deployment information
    show_deployment_info
    
    print_success "Deployment completed successfully! 🎉"
}

# Run main function with all arguments
main "$@"