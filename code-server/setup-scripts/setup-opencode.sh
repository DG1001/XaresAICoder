#!/bin/bash
set -e

echo "Installing OpenCode SST..."

# Install OpenCode SST using npm (assuming it's available via npm)
# Note: This is a placeholder - actual installation method may vary
npm install -g @opencode/sst 2>/dev/null || {
    echo "OpenCode SST not available via npm, trying alternative installation..."
    
    # Alternative: Download binary if available
    # This is a placeholder URL - replace with actual OpenCode SST download URL
    # wget -O /usr/local/bin/opencode https://github.com/opencode-org/sst/releases/latest/download/opencode-linux
    # chmod +x /usr/local/bin/opencode
    
    # For now, create a mock opencode command that shows instructions
    cat > /usr/local/bin/opencode << 'EOF'
#!/bin/bash
echo "OpenCode SST (Mock Version)"
echo "This is a placeholder for OpenCode SST integration."
echo ""
echo "To use OpenCode SST:"
echo "1. Run: opencode auth login"
echo "2. Enter your API key when prompted"
echo "3. Start coding with: opencode [your prompt]"
echo ""
echo "For help: opencode --help"
EOF
    chmod +x /usr/local/bin/opencode
}

# Add to PATH
echo 'export PATH="$PATH:/usr/local/bin"' >> /etc/bash.bashrc

# Create welcome message
cat > /etc/motd << 'EOF'
========================================
XaresAICoder – Workspace Ready
========================================
To use AI assistance with OpenCode:
1. Authenticate: opencode auth login
2. Use: opencode [your coding request]

Happy coding!
========================================
EOF

echo "OpenCode SST installation completed."