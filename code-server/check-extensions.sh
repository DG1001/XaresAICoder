#!/usr/bin/env bash

# Script to check and install missing VS Code extensions on startup
echo "Checking VS Code extensions..."

EXTENSIONS_FILE="/tmp/extensions.txt"
MISSING_EXTENSIONS=()

# Critical extensions that should definitely be present
CRITICAL_EXTENSIONS=("ms-python.python")

# Every code-server call starts Node (1.5-3 s), and the workspace only
# becomes reachable after this script: list the extensions once and check
# against that list, refreshed only after an installation.
list_extensions() {
    if [ "$(whoami)" = "coder" ]; then
        code-server --list-extensions 2>/dev/null
    else
        su - coder -c "code-server --list-extensions 2>/dev/null"
    fi
}
INSTALLED_EXTENSIONS=$(list_extensions)

# Strips any "@<version>" pin so 'publisher.name@1.2.3' matches the
# 'publisher.name' that --list-extensions reports without the version.
is_extension_installed() {
    grep -qixF -- "${1%%@*}" <<< "$INSTALLED_EXTENSIONS"
}

# Read extensions from file and check if they're installed
while IFS= read -r extension; do
    if [ ! -z "$extension" ] && [ ! "${extension:0:1}" = "#" ]; then
        if is_extension_installed "$extension"; then
            echo "✅ Found extension: $extension"
        else
            echo "❌ Missing extension: $extension"
            MISSING_EXTENSIONS+=("$extension")
        fi
    fi
done < "$EXTENSIONS_FILE"

# Install missing extensions
if [ ${#MISSING_EXTENSIONS[@]} -gt 0 ]; then
    echo "Installing ${#MISSING_EXTENSIONS[@]} missing extensions..."
    for extension in "${MISSING_EXTENSIONS[@]}"; do
        echo "Installing: $extension"
        
        # Try installation with timeout
        timeout 60s su - coder -c "code-server --install-extension '$extension' --force --verbose" || {
            echo "⚠️  Installation timed out or failed for $extension"
            
            # Special handling for Python extension
            if [ "$extension" = "ms-python.python" ]; then
                echo "Attempting alternative installation method for Python..."
                su - coder -c "code-server --install-extension '$extension' --force" &>/dev/null || true
            fi
        }

        # Verify installation
        INSTALLED_EXTENSIONS=$(list_extensions)
        if is_extension_installed "$extension"; then
            echo "✅ Successfully installed: $extension"
        else
            echo "❌ Failed to install: $extension"
        fi
        
        sleep 2  # Brief pause between installations
    done
else
    echo "All extensions are installed!"
fi

# Special check for critical extensions
echo ""
echo "Verifying critical extensions..."
for extension in "${CRITICAL_EXTENSIONS[@]}"; do
    if is_extension_installed "$extension"; then
        echo "✅ Critical extension verified: $extension"
    else
        echo "⚠️  Critical extension missing: $extension"
    fi
done

echo "Extension check completed."