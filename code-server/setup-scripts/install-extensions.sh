#!/bin/bash
set -e

echo "Installing VS Code extensions..."

# Read extensions from file and install each one
while IFS= read -r extension; do
    if [ ! -z "$extension" ] && [ ! "${extension:0:1}" = "#" ]; then
        echo "Installing extension: $extension"
        code-server --install-extension "$extension" || echo "Failed to install $extension"
    fi
done < /tmp/extensions.txt

echo "VS Code extensions installation completed."