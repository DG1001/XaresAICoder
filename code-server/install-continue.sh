#!/bin/bash
set -e

echo "Installing Continue AI extension..."

# Set environment variables for code-server
export USER=coder
export HOME=/home/coder
export XDG_DATA_HOME=/home/coder/.local/share

# Function to install Continue extension with retries
install_continue() {
    local max_attempts=3
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        echo "Attempt $attempt to install Continue.continue..."
        
        if code-server --install-extension Continue.continue --force --verbose; then
            echo "✅ Continue extension installed successfully!"
            return 0
        else
            echo "❌ Attempt $attempt failed"
            attempt=$((attempt + 1))
            if [ $attempt -le $max_attempts ]; then
                echo "Retrying in 5 seconds..."
                sleep 5
            fi
        fi
    done
    
    echo "❌ Failed to install Continue extension after $max_attempts attempts"
    return 1
}

# Ensure proper permissions and directories
mkdir -p /home/coder/.local/share/code-server/extensions

# Install Continue extension
install_continue

# Verify installation
echo "Verifying installation..."
if code-server --list-extensions | grep -q "Continue.continue"; then
    echo "✅ Continue extension verified in extension list"
else
    echo "❌ Continue extension not found in extension list"
fi

# Check if extension files exist
if [ -d "/home/coder/.local/share/code-server/extensions/continue.continue-"* ] 2>/dev/null; then
    echo "✅ Continue extension files found on disk"
    ls -la /home/coder/.local/share/code-server/extensions/continue.continue-*
else
    echo "❌ Continue extension files not found on disk"
fi

echo "Continue AI extension installation completed."