#!/bin/bash

# XaresAICoder Forgejo Automated Setup Script

set -e  # Exit on any error

# Configuration from environment variables
FORGEJO_CONTAINER_NAME="${FORGEJO_CONTAINER_NAME:-xaresaicoder-forgejo}"
BASE_URL="${PROTOCOL:-http}://${BASE_DOMAIN:-localhost}:${BASE_PORT:-80}/git"
FORGEJO_INTERNAL_URL="http://${FORGEJO_CONTAINER_NAME}:3000"

# Git server admin configuration
ADMIN_USER="${GIT_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${GIT_ADMIN_PASSWORD:-admin123!}"
ADMIN_EMAIL="${GIT_ADMIN_EMAIL:-admin@xaresaicoder.local}"
SITE_NAME="${GIT_SITE_NAME:-XaresAICoder Git Server}"
SITE_DESCRIPTION="${GIT_SITE_DESCRIPTION:-Integrated Git server for XaresAICoder development environment}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to wait for Forgejo to be ready
wait_for_forgejo() {
    log_info "Waiting for Forgejo to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker exec "$FORGEJO_CONTAINER_NAME" curl -f -s http://localhost:3000/ > /dev/null 2>&1; then
            log_success "Forgejo is ready!"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts - Forgejo not ready yet, waiting..."
        sleep 3
        ((attempt++))
    done
    
    log_error "Forgejo failed to start within expected time"
    return 1
}

# Function to check if Forgejo is already configured
is_forgejo_configured() {
    # Try to access the login page - if we get redirected to install, it's not configured
    local response=$(docker exec "$FORGEJO_CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/user/login 2>/dev/null || echo "000")
    
    if [ "$response" = "200" ]; then
        return 0  # Already configured
    else
        return 1  # Not configured
    fi
}

# Function to perform Forgejo initial setup
setup_forgejo() {
    log_info "Configuring Forgejo initial setup..."
    
    # Submit the installation form with all required fields
    log_info "Submitting Forgejo installation configuration..."
    local install_response=$(docker exec "$FORGEJO_CONTAINER_NAME" curl -s -X POST \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "db_type=sqlite3" \
        -d "db_host=" \
        -d "db_user=" \
        -d "db_passwd=" \
        -d "db_name=" \
        -d "ssl_mode=disable" \
        -d "db_schema=" \
        -d "charset=utf8" \
        -d "db_path=/data/gitea/gitea.db" \
        -d "app_name=$SITE_NAME" \
        -d "app_slogan=Beyond coding. We Forge." \
        -d "repo_root_path=/data/git/repositories" \
        -d "lfs_root_path=/data/git/lfs" \
        -d "run_user=git" \
        -d "domain=${BASE_DOMAIN:-localhost}" \
        -d "ssh_port=2222" \
        -d "http_port=3000" \
        -d "app_url=$BASE_URL/" \
        -d "log_root_path=/data/gitea/log" \
        -d "smtp_addr=" \
        -d "smtp_port=" \
        -d "smtp_from=" \
        -d "smtp_user=" \
        -d "smtp_passwd=" \
        -d "register_confirm=" \
        -d "mail_notify=" \
        -d "offline_mode=on" \
        -d "disable_gravatar=on" \
        -d "enable_federated_avatar=" \
        -d "enable_open_id_sign_in=" \
        -d "enable_open_id_sign_up=" \
        -d "default_keep_email_private=on" \
        -d "default_allow_create_organization=on" \
        -d "default_enable_timetracking=on" \
        -d "no_reply_address=noreply.${BASE_DOMAIN:-localhost}" \
        -d "password_algorithm=pbkdf2" \
        -d "admin_name=$ADMIN_USER" \
        -d "admin_passwd=$ADMIN_PASSWORD" \
        -d "admin_confirm_passwd=$ADMIN_PASSWORD" \
        -d "admin_email=$ADMIN_EMAIL" \
        http://localhost:3000/ \
        -w "%{http_code}" \
        -L -o /tmp/install_response.txt 2>/dev/null || echo "000")
    
    log_info "Installation response: $install_response"
    
    # Wait a moment for the installation to complete
    sleep 5
    
    # Check if installation completed by testing if login page is accessible
    local login_test=$(docker exec "$FORGEJO_CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/user/login 2>/dev/null || echo "000")
    
    if [ "$login_test" = "200" ]; then
        log_success "Forgejo installation completed successfully!"
        return 0
    else
        log_warning "Installation may not be complete, checking configuration..."
        
        # Check if INSTALL_LOCK is set
        local install_lock=$(docker exec "$FORGEJO_CONTAINER_NAME" grep "INSTALL_LOCK" /data/gitea/conf/app.ini 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
        
        if [ "$install_lock" = "true" ]; then
            log_success "Forgejo is configured (INSTALL_LOCK=true)"
            return 0
        else
            log_error "Forgejo installation failed - INSTALL_LOCK not set"
            docker exec "$FORGEJO_CONTAINER_NAME" cat /tmp/install_response.txt 2>/dev/null || true
            return 1
        fi
    fi
}

# Function to enable Actions if not already enabled
enable_actions() {
    log_info "Configuring Forgejo Actions..."
    
    # Actions should already be enabled via environment variables, but let's verify
    # We can check this by trying to access the actions configuration
    local actions_check=$(docker exec "$FORGEJO_CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" \
        -u "$ADMIN_USER:$ADMIN_PASSWORD" \
        http://localhost:3000/admin/config 2>/dev/null || echo "000")
    
    if [ "$actions_check" = "200" ]; then
        log_success "Forgejo Actions are configured and accessible"
    else
        log_warning "Could not verify Actions configuration (this may be normal)"
    fi
}

# Function to create initial repository (optional)
create_sample_repo() {
    log_info "Creating sample repository..."
    
    local repo_data=$(cat <<EOF
{
    "name": "sample-project",
    "description": "Sample repository created by XaresAICoder",
    "private": false,
    "auto_init": true,
    "gitignores": "Global/Archives,Global/Backup,Global/macOS,Global/Linux,Global/Windows",
    "license": "MIT",
    "readme": "Default"
}
EOF
)

    local repo_response=$(docker exec "$FORGEJO_CONTAINER_NAME" curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Basic $(echo -n "$ADMIN_USER:$ADMIN_PASSWORD" | base64)" \
        -d "$repo_data" \
        http://localhost:3000/api/v1/user/repos \
        -w "%{http_code}" \
        -o /tmp/repo_response.txt 2>/dev/null || echo "000")
    
    if [ "$repo_response" = "201" ]; then
        log_success "Sample repository 'sample-project' created successfully!"
    else
        log_warning "Could not create sample repository (HTTP: $repo_response)"
    fi
}

# Main setup function
main() {
    log_info "Starting Forgejo automated setup..."
    log_info "Base URL: $BASE_URL"
    log_info "Admin User: $ADMIN_USER"
    log_info "Admin Email: $ADMIN_EMAIL"
    echo
    
    # Check if container exists
    if ! docker ps --format "table {{.Names}}" | grep -q "^$FORGEJO_CONTAINER_NAME\$"; then
        log_error "Forgejo container '$FORGEJO_CONTAINER_NAME' is not running"
        exit 1
    fi
    
    # Wait for Forgejo to be ready
    if ! wait_for_forgejo; then
        exit 1
    fi
    
    # Check if already configured
    if is_forgejo_configured; then
        log_success "Forgejo is already configured!"
        log_info "You can access it at: $BASE_URL"
        log_info "Admin credentials: $ADMIN_USER / $ADMIN_PASSWORD"
        exit 0
    fi
    
    # Perform initial setup
    if setup_forgejo; then
        log_success "Forgejo setup completed successfully!"
        
        # Wait a moment for the setup to fully complete
        sleep 5
        
        # Enable actions configuration
        enable_actions
        
        # Create sample repository
        create_sample_repo
        
        echo
        log_success "🎉 Forgejo Git Server is ready!"
        log_info "🌐 Access URL: $BASE_URL"
        log_info "👤 Admin User: $ADMIN_USER"
        log_info "🔑 Admin Password: $ADMIN_PASSWORD"
        log_info "📧 Admin Email: $ADMIN_EMAIL"
        echo
        log_info "You can now:"
        log_info "  • Create repositories through the web interface"
        log_info "  • Clone repositories: git clone ${BASE_URL}/admin/sample-project.git"
        log_info "  • Set up CI/CD workflows with Forgejo Actions"
        log_info "  • Manage users and organizations"
        echo
    else
        log_error "Forgejo setup failed!"
        exit 1
    fi
}

# Run main function
main "$@"