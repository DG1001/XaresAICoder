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
    
    # Create a more helpful mock opencode command
    cat > /usr/local/bin/opencode << 'EOF'
#!/bin/bash

case "$1" in
    "auth")
        echo "🔐 OpenCode SST Authentication (Mock)"
        echo "This is a placeholder for OpenCode SST integration."
        echo ""
        echo "In a real implementation, this would:"
        echo "  - Authenticate with OpenCode SST service"
        echo "  - Store API credentials securely"
        echo "  - Enable AI-powered coding assistance"
        ;;
    "--help"|"-h")
        echo "🤖 OpenCode SST - AI Coding Assistant (Mock Version)"
        echo ""
        echo "USAGE:"
        echo "  opencode auth login          - Authenticate with OpenCode SST"
        echo "  opencode [prompt]           - Get AI coding assistance"
        echo "  opencode --help             - Show this help"
        echo ""
        echo "EXAMPLES:"
        echo "  opencode \"create a REST API endpoint\""
        echo "  opencode \"add error handling to this function\""
        echo "  opencode \"write unit tests for user authentication\""
        echo ""
        echo "NOTE: This is currently a mock implementation."
        echo "      Replace with actual OpenCode SST integration for production use."
        ;;
    "")
        echo "❌ OpenCode SST: No prompt provided"
        echo "Usage: opencode [your coding request]"
        echo "Example: opencode \"create a Flask route for user login\""
        echo "Run 'opencode --help' for more information"
        ;;
    *)
        echo "🤖 OpenCode SST (Mock Response)"
        echo "Prompt: $*"
        echo ""
        echo "This is a mock response. In a real implementation, this would:"
        echo "  - Send your prompt to OpenCode SST AI service"
        echo "  - Generate relevant code suggestions"
        echo "  - Provide explanations and best practices"
        echo "  - Integrate with your current codebase context"
        echo ""
        echo "💡 Consider integrating with:"
        echo "  - GitHub Copilot"
        echo "  - ChatGPT API"
        echo "  - Claude API"
        echo "  - Other AI coding assistants"
        ;;
esac
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