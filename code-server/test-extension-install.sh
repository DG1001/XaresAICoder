#!/bin/bash

# Test script to debug extension installation
echo "=== Testing VS Code Extension Installation ==="
echo ""

# Test 1: Check if code-server command is available
echo "1. Testing code-server command availability:"
if command -v code-server >/dev/null 2>&1; then
    echo "✅ code-server command found"
    code-server --version
else
    echo "❌ code-server command not found"
fi
echo ""

# Test 2: Check extension directory
echo "2. Checking extension directory:"
EXTENSION_DIR="/home/coder/.local/share/code-server/extensions"
if [ -d "$EXTENSION_DIR" ]; then
    echo "✅ Extension directory exists: $EXTENSION_DIR"
    echo "Current extensions:"
    ls -la "$EXTENSION_DIR" 2>/dev/null || echo "Directory is empty"
else
    echo "❌ Extension directory not found: $EXTENSION_DIR"
    echo "Creating directory..."
    mkdir -p "$EXTENSION_DIR"
    chown -R coder:coder "$EXTENSION_DIR"
fi
echo ""

# Test 3: Try to install an example extension manually
echo "3. Attempting to install ms-python.python extension:"
su - coder << 'EOF'
export HOME=/home/coder
export USER=coder
echo "Installing as user: $(whoami)"
echo "Home directory: $HOME"

# Try installation with verbose output
echo "Running: code-server --install-extension ms-python.python --force --verbose"
code-server --install-extension ms-python.python --force --verbose
echo "Installation command completed."
EOF
echo ""

# Test 4: Verify installation
echo "4. Verifying installation:"
if [ -d "/home/coder/.local/share/code-server/extensions/ms-python.python-"* ] 2>/dev/null; then
    echo "✅ Python extension found!"
    ls -la /home/coder/.local/share/code-server/extensions/ms-python.python-*
else
    echo "❌ Python extension not found after installation"
fi
echo ""

# Test 5: List all installed extensions
echo "5. All installed extensions:"
su - coder -c "code-server --list-extensions" 2>/dev/null || echo "Failed to list extensions"
echo ""

echo "=== Test completed ==="