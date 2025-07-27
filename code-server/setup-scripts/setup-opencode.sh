#!/bin/bash

echo "Installing OpenCode SST..."

# Install OpenCode SST to a system-wide location
export OPENCODE_INSTALL_DIR="/usr/local/bin"
if curl -fsSL https://opencode.ai/install | bash; then
    echo "✅ OpenCode installation script completed"
    # Make sure it's executable by all users
    chmod +x /usr/local/bin/opencode 2>/dev/null || true
else
    echo "⚠️  OpenCode installation script failed, trying npm fallback..."
    # Fallback to npm installation
    npm install -g opencode-ai 2>/dev/null || {
        echo "❌ Both installation methods failed"
    }
fi

# Alternative: Install to a shared location and copy for all users
if [ -f "/root/.opencode/bin/opencode" ]; then
    # Copy the binary to a system-wide location instead of symlinking
    cp "/root/.opencode/bin/opencode" /usr/local/bin/opencode
    chmod +x /usr/local/bin/opencode
    
    # Also make sure the coder user has their own copy
    mkdir -p /home/coder/.opencode/bin
    cp "/root/.opencode/bin/opencode" /home/coder/.opencode/bin/opencode
    chown -R coder:coder /home/coder/.opencode
    chmod +x /home/coder/.opencode/bin/opencode
elif [ -f "$HOME/bin/opencode" ]; then
    cp "$HOME/bin/opencode" /usr/local/bin/opencode
    chmod +x /usr/local/bin/opencode
elif [ -f "./opencode" ]; then
    mv ./opencode /usr/local/bin/opencode
    chmod +x /usr/local/bin/opencode
fi

# Verify installation
if command -v opencode >/dev/null 2>&1; then
    echo "✅ OpenCode SST installed successfully"
    opencode --version
else
    echo "❌ OpenCode SST installation failed, falling back to manual installation..."
    
    # Fallback: Try npm installation
    npm install -g opencode-ai 2>/dev/null || {
        echo "⚠️  Both installation methods failed. Creating setup instructions..."
        
        # Create setup instructions for manual installation
        cat > /usr/local/bin/opencode-setup << 'EOF'
#!/bin/bash
echo "🚀 OpenCode SST Setup Instructions"
echo ""
echo "To install OpenCode SST manually:"
echo "1. Run: curl -fsSL https://opencode.ai/install | bash"
echo "2. Or install via npm: npm install -g opencode-ai"
echo "3. Configure authentication: opencode auth login"
echo ""
echo "For more information, visit: https://opencode.ai/docs/"
EOF
        chmod +x /usr/local/bin/opencode-setup
        
        # Create placeholder that directs to setup
        cat > /usr/local/bin/opencode << 'EOF'
#!/bin/bash
echo "⚠️  OpenCode SST is not properly installed."
echo "Run 'opencode-setup' for installation instructions."
echo ""
echo "Quick install: curl -fsSL https://opencode.ai/install | bash"
EOF
        chmod +x /usr/local/bin/opencode
    }
fi

# Add to PATH for all users
echo 'export PATH="$PATH:/usr/local/bin"' >> /etc/bash.bashrc

# Add coder-specific PATH for their OpenCode installation
echo 'export PATH="$PATH:/home/coder/.opencode/bin"' >> /home/coder/.bashrc

# Create welcome message
cat > /etc/motd << 'EOF'
========================================
XaresAICoder – Workspace Ready
========================================
🤖 OpenCode SST AI Assistant Available

To get started:
1. Configure API key: opencode auth login
2. Initialize project: opencode (then type /init)
3. Start coding: Ask questions or request features

📁 Project Templates:
- Flask app: setup_flask_project
- Or create your own project structure

Commands:
- opencode               - Start interactive session
- opencode --help        - Show help
- opencode --version     - Show version

For documentation: https://opencode.ai/docs/
========================================
EOF

echo "OpenCode SST installation completed."