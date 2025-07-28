#!/bin/bash
set -e

echo "Installing VS Code extensions..."

# Set environment variables for code-server
export USER=coder
export HOME=/home/coder
export XDG_DATA_HOME=/home/coder/.local/share

# Ensure the user's extension directory exists
mkdir -p /home/coder/.local/share/code-server/extensions

# Create a temporary log file
LOG_FILE="/tmp/extension-install.log"
echo "Extension installation log - $(date)" > "$LOG_FILE"

# Read extensions from file and install each one
while IFS= read -r extension; do
    if [ ! -z "$extension" ] && [ ! "${extension:0:1}" = "#" ]; then
        echo "Installing extension: $extension"
        echo "Installing extension: $extension" >> "$LOG_FILE"
        
        # Try to install the extension with detailed output
        if code-server --install-extension "$extension" --force --verbose >> "$LOG_FILE" 2>&1; then
            echo "✅ Successfully installed: $extension"
            echo "✅ Successfully installed: $extension" >> "$LOG_FILE"
        else
            echo "❌ Failed to install: $extension"
            echo "❌ Failed to install: $extension" >> "$LOG_FILE"
            # Show the error details
            tail -10 "$LOG_FILE"
        fi
        
        # Small delay between installations
        sleep 1
    fi
done < /tmp/extensions.txt

echo "Extension installation log:"
cat "$LOG_FILE"

echo "VS Code extensions installation completed."