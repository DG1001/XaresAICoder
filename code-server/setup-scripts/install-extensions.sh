#!/bin/bash
set -e

echo "Installing VS Code extensions..."

# Switch to coder user for extension installation
su - coder << 'EOF'
# Read extensions from file and install each one
while IFS= read -r extension; do
    if [ ! -z "$extension" ] && [ ! "${extension:0:1}" = "#" ]; then
        echo "Installing extension: $extension"
        code-server --install-extension "$extension" --force || echo "Failed to install $extension"
    fi
done < /tmp/extensions.txt
EOF

echo "VS Code extensions installation completed."