#!/bin/bash

# Frontend Version Builder Script
# Generates version.js from template with git information

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[BUILD]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to get git tag version
get_git_version() {
    local git_tag=""
    local git_hash=""
    local version=""
    
    # Try to get the latest git tag
    if git describe --tags --exact-match HEAD 2>/dev/null >/dev/null; then
        git_tag=$(git describe --tags --exact-match HEAD 2>/dev/null)
        version="$git_tag"
    elif git describe --tags --abbrev=0 2>/dev/null >/dev/null; then
        # Get latest tag and current commit hash
        local latest_tag=$(git describe --tags --abbrev=0 2>/dev/null)
        local commit_count=$(git rev-list ${latest_tag}..HEAD --count 2>/dev/null || echo "0")
        git_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        
        if [ "$commit_count" -gt 0 ]; then
            git_tag="${latest_tag}+${commit_count}"
            version="${latest_tag}+${commit_count}-${git_hash}"
        else
            git_tag="$latest_tag"
            version="$latest_tag"
        fi
    else
        # No tags found, use commit hash
        git_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
        git_tag="v0.0.0-dev"
        version="v0.0.0-dev-${git_hash}"
    fi
    
    # Fallback if git is not available
    if [ -z "$git_hash" ]; then
        git_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    fi
    
    echo "$version|$git_tag|$git_hash"
}

# Function to generate version file
generate_version_file() {
    local frontend_dir="${1:-./frontend}"
    local template_file="$frontend_dir/version.js.template"
    local output_file="$frontend_dir/version.js"
    
    print_status "Generating version file..."
    
    # Check if template exists
    if [ ! -f "$template_file" ]; then
        print_warning "Template file not found: $template_file"
        print_status "Creating default template..."
        
        mkdir -p "$(dirname "$template_file")"
        cat > "$template_file" << 'EOF'
// Version information - automatically generated during deployment
window.APP_VERSION = {
    version: '{{VERSION}}',
    gitTag: '{{GIT_TAG}}',
    gitHash: '{{GIT_HASH}}',
    buildDate: '{{BUILD_DATE}}',
    buildEnv: '{{BUILD_ENV}}'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.APP_VERSION;
}
EOF
    fi
    
    # Get version information
    local version_info=$(get_git_version)
    local version=$(echo "$version_info" | cut -d'|' -f1)
    local git_tag=$(echo "$version_info" | cut -d'|' -f2)
    local git_hash=$(echo "$version_info" | cut -d'|' -f3)
    local build_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local build_env="${BUILD_ENV:-production}"
    
    print_status "Version: $version"
    print_status "Git Tag: $git_tag"
    print_status "Git Hash: $git_hash"
    print_status "Build Date: $build_date"
    print_status "Build Environment: $build_env"
    
    # Generate version file from template
    cp "$template_file" "$output_file"
    
    # Replace placeholders using a safer method
    if command -v perl >/dev/null 2>&1; then
        perl -i -pe "s/\{\{VERSION\}\}/\Q$version\E/g" "$output_file"
        perl -i -pe "s/\{\{GIT_TAG\}\}/\Q$git_tag\E/g" "$output_file"
        perl -i -pe "s/\{\{GIT_HASH\}\}/\Q$git_hash\E/g" "$output_file"
        perl -i -pe "s/\{\{BUILD_DATE\}\}/\Q$build_date\E/g" "$output_file"
        perl -i -pe "s/\{\{BUILD_ENV\}\}/\Q$build_env\E/g" "$output_file"
    else
        # Create the version file directly without template to avoid escaping issues
        {
            echo "// Version information - automatically generated during deployment"
            echo "window.APP_VERSION = {"
            printf "    version: '%s',\n" "$version"
            printf "    gitTag: '%s',\n" "$git_tag"
            printf "    gitHash: '%s',\n" "$git_hash"
            printf "    buildDate: '%s',\n" "$build_date"
            printf "    buildEnv: '%s'\n" "$build_env"
            echo "};"
            echo ""
            echo "// Export for use in other modules"
            echo "if (typeof module !== 'undefined' && module.exports) {"
            echo "    module.exports = window.APP_VERSION;"
            echo "}"
        } > "$output_file"
    fi
    
    print_success "Version file generated: $output_file"
    
    # Show generated content
    print_status "Generated version information:"
    echo "----------------------------------------"
    cat "$output_file"
    echo "----------------------------------------"
}

# Function to update service worker with version
update_service_worker_version() {
    local frontend_dir="${1:-./frontend}"
    local sw_file="$frontend_dir/sw.js"
    
    if [ ! -f "$sw_file" ]; then
        print_warning "Service worker not found: $sw_file"
        return 0
    fi
    
    # Get version information
    local version_info=$(get_git_version)
    local version=$(echo "$version_info" | cut -d'|' -f1)
    
    print_status "Updating service worker cache version..."
    
    # Update cache name with version using a safer approach
    # Create a backup and then recreate the first few lines with proper version
    local temp_file=$(mktemp)
    local safe_version=$(echo "$version" | tr '+' '_' | tr '-' '_' | tr '.' '_')
    
    # Replace the cache name lines
    sed "s/const CACHE_NAME = 'xaresaicoder-v[^']*';/const CACHE_NAME = 'xaresaicoder-${safe_version}';/" "$sw_file" > "$temp_file"
    sed -i "s/const STATIC_CACHE_NAME = 'xaresaicoder-static-v[^']*';/const STATIC_CACHE_NAME = 'xaresaicoder-static-${safe_version}';/" "$temp_file"
    sed -i "s/const DYNAMIC_CACHE_NAME = 'xaresaicoder-dynamic-v[^']*';/const DYNAMIC_CACHE_NAME = 'xaresaicoder-dynamic-${safe_version}';/" "$temp_file"
    
    # Replace the original file
    mv "$temp_file" "$sw_file"
    
    print_success "Service worker updated with version: $version"
}

# Main function
main() {
    local frontend_dir="${1:-./frontend}"
    
    print_status "Building frontend version information..."
    print_status "Frontend directory: $frontend_dir"
    
    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        print_warning "Not in a git repository, using fallback version info"
    fi
    
    # Generate version file
    generate_version_file "$frontend_dir"
    
    # Update service worker version
    update_service_worker_version "$frontend_dir"
    
    print_success "Frontend version build completed!"
}

# Run main function
main "$@"