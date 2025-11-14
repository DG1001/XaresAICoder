#!/bin/bash
set -e

echo "Setting up workspace initialization..."

# Create VS Code settings with subdomain-based port forwarding
mkdir -p /home/coder/.local/share/code-server/User
cat > /home/coder/.local/share/code-server/User/settings.json << 'SETTINGS_EOF'
{
    "workbench.colorTheme": "Default Dark Modern",
    "remote.autoForwardPorts": true,
    "remote.portsAttributes": {
        "5000": {
            "label": "Flask Application",
            "onAutoForward": "openBrowserOnce"
        },
        "3000": {
            "label": "React Development Server",
            "onAutoForward": "openBrowserOnce"
        },
        "8000": {
            "label": "Django Application",
            "onAutoForward": "openBrowserOnce"
        },
        "8080": {
            "label": "Spring Boot Application",
            "onAutoForward": "openBrowserOnce"
        }
    },
    "workbench.startupEditor": "readme",
    "python.defaultInterpreterPath": "./venv/bin/python",
    "python.terminal.activateEnvironment": true,
    "python.venvPath": ".",
    "python.autoComplete.extraPaths": ["./venv/lib/python3.11/site-packages"]
}
SETTINGS_EOF

# Clone Git repository if specified
if [ -n "$GIT_CLONE_URL" ]; then
    echo "Cloning Git repository: $GIT_CLONE_URL"
    cd /workspace

    # Configure Git credentials if token is provided
    if [ -n "$GIT_ACCESS_TOKEN" ]; then
        # Extract hostname from Git URL for credential configuration
        HOSTNAME=$(echo "$GIT_CLONE_URL" | sed -e 's|^[^/]*//||' -e 's|/.*||')

        # Configure Git credential helper with the provided token
        git config --global credential.helper 'store --file=/tmp/git-credentials'
        echo "https://${GIT_ACCESS_TOKEN}@${HOSTNAME}" > /tmp/git-credentials
        chmod 600 /tmp/git-credentials

        echo "Git credentials configured for ${HOSTNAME}"
    fi

    # Clone the repository directly into the workspace directory
    if git clone "$GIT_CLONE_URL" /tmp/repo-clone; then
        # Move contents from cloned repo to workspace root
        if [ -d "/tmp/repo-clone" ]; then
            mv /tmp/repo-clone/.git /workspace/.git 2>/dev/null || true
            mv /tmp/repo-clone/* /workspace/ 2>/dev/null || true
            mv /tmp/repo-clone/.* /workspace/ 2>/dev/null || true
            rm -rf /tmp/repo-clone

            echo "✅ Repository cloned successfully to /workspace"

            # Configure Git user if not already set
            git config --global user.name "XaresAICoder User" 2>/dev/null || true
            git config --global user.email "user@xaresaicoder.local" 2>/dev/null || true
            git config --global init.defaultBranch main 2>/dev/null || true

            # Show repository status
            cd /workspace
            echo "Repository status:"
            git status --short || true
        fi
    else
        echo "❌ Failed to clone repository: $GIT_CLONE_URL"
        echo "The workspace will start with an empty project instead."

        # Clean up any failed clone attempts
        rm -rf /tmp/repo-clone 2>/dev/null || true
    fi

    # Clean up credentials file for security
    if [ -f "/tmp/git-credentials" ]; then
        rm -f /tmp/git-credentials
    fi
fi

# Create info command
cat > /usr/local/bin/info << 'INFO_EOF'
#!/bin/bash

echo ""
echo "🚀 XaresAICoder - AI-Powered Development Environment"
echo "=========================================="
echo ""
echo "🤖 AI Coding Tools:"
echo "  • Continue - VS Code AI completion & chat (install from marketplace)"
echo "  • Cline (Claude Dev) - AI file editor (install from marketplace)"
echo "  • OpenCode SST - Multi-model AI assistant (pre-installed)"
echo "  • Aider - AI pair programming in terminal (pre-installed)"
echo "  • Gemini CLI - Google's AI coding assistant (pre-installed)"
echo "  • Claude Code - Anthropic's AI coding tool (pre-installed)"
echo "  • Qwen Code - AI workflow automation tool (pre-installed)"
echo "  • OpenAI Codex - OpenAI's coding assistant (pre-installed)"
echo "  • Crush - Multi-model AI coding agent (pre-installed)"
echo ""
echo "⚡ Setup Commands:"
echo "  • setup_ai_tools - See all AI tool setup instructions"
echo "  • setup_opencode, setup_aider, setup_gemini, setup_claude, setup_qwen, setup_codex, setup_crush"
echo ""
echo "📁 Current Directory: $(pwd)"
if [ -d ".git" ]; then
    echo "🌿 Git Status:"
    git status --short --branch 2>/dev/null | head -5
    echo "    Use 'git status' for full status"
    echo ""
    echo "🔗 Git Remotes:"
    REMOTES=$(git remote -v 2>/dev/null | grep fetch)
    if [ -n "$REMOTES" ]; then
        echo "$REMOTES" | sed 's/^/    /'
        # Check if only external remote exists (no 'origin' or only 'github'/'upstream')
        HAS_ORIGIN=$(git remote 2>/dev/null | grep -w "origin")
        HAS_GITHUB=$(git remote 2>/dev/null | grep -w "github")
        if [ -z "$HAS_ORIGIN" ] && [ -n "$HAS_GITHUB" ]; then
            echo ""
            echo "    💡 Tip: Add a local Forgejo remote with 'setup_local_remote'"
        fi
    else
        echo "    No remotes configured"
    fi
fi
echo ""
echo "🔄 Update Commands:"
echo "  • update_aider (pip3)"
echo "  • sudo update_gemini, sudo update_claude, sudo update_qwen, sudo update_codex, sudo update_crush (npm)"
echo "  • update_opencode (downloads and installs latest version)"
echo ""
# Show Git commands only if Git server is enabled
if [ -n "$GIT_SERVER_ENABLED" ] && [ "$GIT_SERVER_ENABLED" = "true" ]; then
    echo "🔧 Git Commands:"
    echo "  • setup_local_remote - Add local Forgejo repository as remote"
    echo ""
fi
echo "💡 Pro Tips:"
echo "  • Type 'info' anytime to see this information"
echo "  • Update individual AI tools with their specific update commands"
echo "  • Ask AI assistants about your codebase and request features"
if [ -n "$GIT_SERVER_ENABLED" ] && [ "$GIT_SERVER_ENABLED" = "true" ]; then
    echo "  • Use 'setup_local_remote' to push Quick Clone repos to local Forgejo"
fi
echo ""
INFO_EOF
chmod +x /usr/local/bin/info

# Create individual update scripts for each AI tool

# Update Aider
cat > /usr/local/bin/update_aider << 'UPDATE_AIDER_EOF'
#!/bin/bash
echo "🔄 Updating Aider AI pair programming tool..."
pip3 install --upgrade --break-system-packages aider-chat
echo "✅ Aider updated successfully!"
UPDATE_AIDER_EOF
chmod +x /usr/local/bin/update_aider

# Update Gemini CLI (requires sudo)
cat > /usr/local/bin/update_gemini << 'UPDATE_GEMINI_EOF'
#!/bin/bash
echo "🔄 Updating Gemini CLI..."
echo "💡 Note: Run with sudo if you get permission errors"
npm update -g @google/gemini-cli
echo "✅ Gemini CLI updated successfully!"
UPDATE_GEMINI_EOF
chmod +x /usr/local/bin/update_gemini

# Update Claude Code (requires sudo)
cat > /usr/local/bin/update_claude << 'UPDATE_CLAUDE_EOF'
#!/bin/bash
echo "🔄 Updating Claude Code..."
echo "💡 Note: Run with sudo if you get permission errors"
npm update -g @anthropic-ai/claude-code
echo "✅ Claude Code updated successfully!"
UPDATE_CLAUDE_EOF
chmod +x /usr/local/bin/update_claude

# Update Qwen Code (requires sudo)
cat > /usr/local/bin/update_qwen << 'UPDATE_QWEN_EOF'
#!/bin/bash
echo "🔄 Updating Qwen Code..."
echo "💡 Note: Run with sudo if you get permission errors"
npm update -g @qwen-code/qwen-code
echo "✅ Qwen Code updated successfully!"
UPDATE_QWEN_EOF
chmod +x /usr/local/bin/update_qwen

# Update OpenAI Codex (requires sudo)
cat > /usr/local/bin/update_codex << 'UPDATE_CODEX_EOF'
#!/bin/bash
echo "🔄 Updating OpenAI Codex CLI..."
echo "💡 Note: Run with sudo if you get permission errors"
npm install -g @openai/codex --force
echo "✅ OpenAI Codex CLI updated successfully!"
UPDATE_CODEX_EOF
chmod +x /usr/local/bin/update_codex

# Update Crush (requires sudo)
cat > /usr/local/bin/update_crush << 'UPDATE_CRUSH_EOF'
#!/bin/bash
echo "🔄 Updating Crush..."
echo "💡 Note: Run with sudo if you get permission errors"
npm update -g @charmland/crush
echo "✅ Crush updated successfully!"
UPDATE_CRUSH_EOF
chmod +x /usr/local/bin/update_crush

# Update OpenCode SST
cat > /usr/local/bin/update_opencode << 'UPDATE_OPENCODE_EOF'
#!/bin/bash
echo "🔄 Updating OpenCode SST..."
echo ""

# Check current version
CURRENT_VERSION=$(opencode --version 2>&1 | grep -oP '\d+\.\d+\.\d+' | head -1)
echo "Current version: ${CURRENT_VERSION:-unknown}"

# Download latest version
echo "Downloading latest version..."
if curl -fsSL https://opencode.ai/install | bash; then
    echo "✅ Download completed"

    # Find the new binary
    NEW_BINARY=""
    if [ -f "$HOME/.opencode/bin/opencode" ]; then
        NEW_BINARY="$HOME/.opencode/bin/opencode"
    elif [ -f "$HOME/bin/opencode" ]; then
        NEW_BINARY="$HOME/bin/opencode"
    elif [ -f "$HOME/.local/bin/opencode" ]; then
        NEW_BINARY="$HOME/.local/bin/opencode"
    fi

    if [ -n "$NEW_BINARY" ]; then
        # Copy to system location
        echo "Installing to /usr/local/bin/opencode..."
        if sudo cp "$NEW_BINARY" /usr/local/bin/opencode && sudo chmod +x /usr/local/bin/opencode; then
            NEW_VERSION=$(opencode --version 2>&1 | grep -oP '\d+\.\d+\.\d+' | head -1)
            echo "✅ OpenCode SST updated successfully!"
            echo "New version: ${NEW_VERSION:-unknown}"
        else
            echo "❌ Failed to copy binary to /usr/local/bin (permission denied)"
            echo "💡 Manual fix: sudo cp $NEW_BINARY /usr/local/bin/opencode"
        fi
    else
        echo "⚠️  Could not find downloaded binary"
        echo "💡 Try manual installation: curl -fsSL https://opencode.ai/install | bash"
    fi
else
    echo "❌ Download failed"
fi
UPDATE_OPENCODE_EOF
chmod +x /usr/local/bin/update_opencode

# Create setup_local_remote script to add Forgejo remote to existing workspaces
cat > /usr/local/bin/setup_local_remote << 'SETUP_LOCAL_REMOTE_EOF'
#!/bin/bash

echo "🔧 Setting up Local Forgejo Remote"
echo "===================================="
echo ""

# Check if we're in a Git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not a Git repository"
    echo "💡 Run 'git init' first to initialize a Git repository"
    exit 1
fi

# Check if Forgejo server is available
if [ -z "$GIT_SERVER_URL" ]; then
    echo "❌ Error: Forgejo Git server is not available"
    echo "💡 This workspace was created without Git server support"
    echo "   Contact your administrator to enable the Git server"
    exit 1
fi

# Try to extract repository name from existing Git remote (GitHub, etc.)
# Check 'origin' first, then 'github', then fall back to directory name
DEFAULT_REPO_NAME=""

# Try to get remote URL (origin or github)
REMOTE_URL=$(git remote get-url origin 2>/dev/null || git remote get-url github 2>/dev/null || echo "")

if [ -n "$REMOTE_URL" ]; then
    # Extract repo name from URL
    # Handles: https://github.com/user/repo.git, git@github.com:user/repo.git, http://domain/user/repo.git
    DEFAULT_REPO_NAME=$(echo "$REMOTE_URL" | sed -E 's|.*/([^/]+)\.git$|\1|' | sed -E 's|.*/([^/]+)$|\1|')
fi

# Fall back to current directory name if extraction failed
if [ -z "$DEFAULT_REPO_NAME" ]; then
    DEFAULT_REPO_NAME=$(basename "$(pwd)")
fi

# Prompt for repository name
echo "Enter repository name (default: $DEFAULT_REPO_NAME):"
read -r REPO_NAME
REPO_NAME=${REPO_NAME:-$DEFAULT_REPO_NAME}

echo ""
echo "📝 Repository configuration:"
echo "   Name: $REPO_NAME"
echo "   Description: Created from workspace"
echo ""

# Call Forgejo API to create repository
echo "🔄 Creating repository on local Forgejo server..."

# Create Basic Auth credentials
AUTH_HEADER=$(echo -n "$GIT_ADMIN_USER:$GIT_ADMIN_PASSWORD" | base64)

# Call Forgejo API to create repository
RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic $AUTH_HEADER" \
    -d "{\"name\":\"$REPO_NAME\",\"description\":\"Workspace repository\",\"private\":false,\"auto_init\":false,\"default_branch\":\"main\"}" \
    "$GIT_SERVER_URL/api/v1/user/repos" 2>/dev/null)

# Check if curl succeeded
if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
    echo "❌ Failed to connect to Forgejo server"
    echo "💡 Manual setup required:"
    echo ""
    echo "1. Visit: $GIT_SERVER_EXTERNAL_URL"
    echo "2. Create a repository manually"
    echo "3. Add the remote: git remote add origin <forgejo-clone-url>"
    echo "4. Push your code: git push -u origin --all"
    exit 1
fi

# Check for errors in response
if echo "$RESPONSE" | grep -q '"message"'; then
    ERROR_MSG=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
    echo "❌ Failed to create repository: $ERROR_MSG"
    echo ""
    echo "💡 The repository might already exist. Try:"
    echo "   1. Use a different repository name"
    echo "   2. Or visit $GIT_SERVER_EXTERNAL_URL to manage repositories"
    exit 1
fi

# Extract clone URL from response
GIT_REMOTE_URL=$(echo "$RESPONSE" | grep -o '"clone_url":"[^"]*"' | cut -d'"' -f4)

if [ -z "$GIT_REMOTE_URL" ]; then
    echo "⚠️  Could not parse repository URL from response"
    echo "💡 Please check Forgejo web interface at: $GIT_SERVER_EXTERNAL_URL"
    exit 1
fi

# Convert external clone URL to internal one
# External: http://localhost/git/developer/repo.git
# Internal: http://user:pass@forgejo:3000/developer/repo.git (no /git/ prefix)
GIT_INTERNAL_URL=$(echo "$GIT_REMOTE_URL" | sed "s|https\?://[^/]*/git/|http://$GIT_ADMIN_USER:$GIT_ADMIN_PASSWORD@forgejo:3000/|")

echo "✅ Repository created successfully!"
echo ""

# Check if 'origin' remote already exists
CURRENT_ORIGIN=$(git remote get-url origin 2>/dev/null)

if [ -n "$CURRENT_ORIGIN" ]; then
    echo "🔀 Current 'origin' remote points to:"
    echo "   $CURRENT_ORIGIN"
    echo ""
    echo "Do you want to:"
    echo "  1) Rename current 'origin' to 'github' and add Forgejo as new 'origin'"
    echo "  2) Add Forgejo as 'forgejo' remote (keep current 'origin')"
    echo "  3) Cancel"
    echo ""
    read -p "Enter choice (1/2/3): " CHOICE

    case $CHOICE in
        1)
            echo "🔄 Renaming 'origin' to 'github'..."
            if git remote rename origin github 2>/dev/null; then
                echo "✅ Renamed to 'github'"
            else
                echo "❌ Failed to rename remote"
                exit 1
            fi

            echo "🔄 Adding Forgejo as 'origin'..."
            if git remote add origin "$GIT_INTERNAL_URL" 2>/dev/null; then
                echo "✅ Added Forgejo as 'origin'"
            else
                echo "❌ Failed to add remote"
                exit 1
            fi

            # Push to new origin
            echo ""
            echo "🔄 Pushing to Forgejo..."
            if git push -u origin --all 2>/dev/null; then
                echo "✅ Pushed all branches"
            fi
            if [ -n "$(git tag)" ]; then
                git push origin --tags 2>/dev/null && echo "✅ Pushed tags"
            fi
            ;;
        2)
            echo "🔄 Adding Forgejo as 'forgejo' remote..."
            if git remote add forgejo "$GIT_INTERNAL_URL" 2>/dev/null; then
                echo "✅ Added Forgejo as 'forgejo'"
                echo ""
                echo "💡 To push to Forgejo: git push forgejo main"
            else
                echo "❌ Failed to add remote"
                exit 1
            fi
            ;;
        *)
            echo "Cancelled"
            exit 0
            ;;
    esac
else
    # No origin exists, simply add Forgejo as origin
    echo "🔄 Adding Forgejo as 'origin'..."
    if git remote add origin "$GIT_INTERNAL_URL" 2>/dev/null; then
        echo "✅ Added Forgejo as 'origin'"

        # Push to origin
        echo ""
        echo "🔄 Pushing to Forgejo..."
        if git push -u origin --all 2>/dev/null; then
            echo "✅ Pushed all branches"
        fi
        if [ -n "$(git tag)" ]; then
            git push origin --tags 2>/dev/null && echo "✅ Pushed tags"
        fi
    else
        echo "❌ Failed to add remote"
        exit 1
    fi
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Current Git remotes:"
git remote -v

SETUP_LOCAL_REMOTE_EOF
chmod +x /usr/local/bin/setup_local_remote

# Create a welcome script that runs when terminal opens
cat > /home/coder/.bashrc << 'EOF'
# Default bashrc content
if [ -f /etc/bash.bashrc ]; then
    . /etc/bash.bashrc
fi

# Short welcome message for XaresAICoder
echo ""
echo "🚀 Welcome to XaresAICoder! Type 'info' for help and AI tool information."
echo ""

# Add aliases for common commands
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# Git configuration helper
git config --global init.defaultBranch main
git config --global user.name "XaresAICoder User" 2>/dev/null || true
git config --global user.email "user@xaresaicoder.local" 2>/dev/null || true

# AI Tool Setup Functions


# Setup OpenCode SST
setup_opencode() {
    echo "🤖 Setting up OpenCode SST..."
    echo ""
    echo "OpenCode SST is already installed!"
    echo ""
    echo "To get started:"
    echo "1. opencode auth login"
    echo "2. opencode (then type /init to analyze your project)"
    echo ""
    echo "📚 Learn more: https://opencode.dev"
}

# Setup Aider AI pair programming
setup_aider() {
    echo "🤖 Setting up Aider AI pair programming..."
    echo ""
    echo "Aider is already installed!"
    echo ""
    echo "To get started:"
    echo "1. Set your API key: export OPENAI_API_KEY=your_key_here"
    echo "   (or use other providers: ANTHROPIC_API_KEY, GEMINI_API_KEY, etc.)"
    echo "2. Run: aider"
    echo "3. Start coding with AI assistance!"
    echo ""
    echo "💡 Pro tip: Aider works with many AI models:"
    echo "   - OpenAI GPT-4, GPT-3.5"
    echo "   - Anthropic Claude"
    echo "   - Google Gemini"
    echo "   - Local models via Ollama"
    echo ""
    echo "📚 Learn more: https://aider.chat"
}

# Setup Gemini CLI
setup_gemini() {
    echo "🤖 Setting up Gemini CLI..."
    echo ""
    echo "Gemini CLI is already installed!"
    echo ""
    echo "To get started:"
    echo "1. Get API key from: https://makersuite.google.com/app/apikey"
    echo "2. Set API key: export GEMINI_API_KEY=your_key_here"
    echo "3. Run: gemini-cli"
    echo ""
    echo "💡 Features:"
    echo "   - Natural language code generation"
    echo "   - Code explanation and debugging"
    echo "   - Project analysis and suggestions"
    echo ""
    echo "📚 Learn more: https://ai.google.dev/gemini-api"
}

# Setup Claude Code
setup_claude() {
    echo "🤖 Setting up Claude Code..."
    echo ""
    echo "Claude Code is already installed!"
    echo ""
    echo "To get started:"
    echo "1. Run: claude"
    echo "2. Follow authentication prompts"
    echo "   (Requires Claude Pro/Max subscription or API billing)"
    echo ""
    echo "💡 Features:"
    echo "   - Agentic coding assistance"
    echo "   - Codebase understanding"
    echo "   - Git workflow automation"
    echo "   - Multi-file editing"
    echo ""
    echo "📚 Learn more: https://docs.anthropic.com/claude-code"
}

# Setup Qwen Code
setup_qwen() {
    echo "🤖 Setting up Qwen Code..."
    echo ""
    echo "Qwen Code is already installed!"
    echo ""
    echo "To get started:"
    echo "1. Run: qwen-code"
    echo "2. Authenticate with Qwen OAuth (2,000 daily free requests)"
    echo "   Or configure OpenAI-compatible API"
    echo ""
    echo "💡 Features:"
    echo "   - Code understanding and exploration"
    echo "   - Workflow automation"
    echo "   - Performance and security analysis"
    echo "   - Documentation and test generation"
    echo "   - Intelligent refactoring"
    echo ""
    echo "📚 Learn more: https://github.com/QwenLM/qwen-code"
}

# Setup OpenAI Codex CLI
setup_codex() {
    echo "🤖 Setting up OpenAI Codex CLI..."
    echo ""
    echo "OpenAI Codex CLI is already installed!"
    echo ""
    echo "⚠️  Authentication for containers:"
    echo "Since we're in a containerized environment, the usual web-based auth won't work."
    echo "Use the 'headless machine' authentication method:"
    echo ""
    echo "📋 Steps to authenticate:"
    echo "1. On your LOCAL machine, run: codex login"
    echo "2. Complete authentication in your browser"
    echo "3. Copy the auth.json file to this container:"
    echo ""
    echo "   # From your local machine:"
    echo "   docker cp ~/.codex/auth.json <container_name>:/home/coder/.codex/auth.json"
    echo ""
    echo "   # Or if you have the file ready:"
    echo "   mkdir -p ~/.codex"
    echo "   # Copy your auth.json file to ~/.codex/auth.json"
    echo ""
    echo "4. Run: codex"
    echo ""
    echo "💡 Features:"
    echo "   - Local AI coding assistant"
    echo "   - Integrates with ChatGPT Plus/Pro/Team/Enterprise"
    echo "   - Model Context Protocol (MCP) support"
    echo "   - Terminal-based coding assistance"
    echo ""
    echo "📚 Learn more:"
    echo "   - GitHub: https://github.com/openai/codex"
    echo "   - Auth docs: https://github.com/openai/codex/blob/main/docs/authentication.md"
}

# Setup Crush
setup_crush() {
    echo "🤖 Setting up Crush..."
    echo ""
    echo "Crush is already installed!"
    echo ""
    echo "To get started:"
    echo "1. Run: crush"
    echo "2. Configure your preferred AI provider via environment variables:"
    echo "   • ANTHROPIC_API_KEY for Anthropic Claude"
    echo "   • OPENAI_API_KEY for OpenAI"
    echo "   • GEMINI_API_KEY for Google Gemini"
    echo "   • GROQ_API_KEY for Groq"
    echo "   • OPENROUTER_API_KEY for OpenRouter"
    echo ""
    echo "💡 Features:"
    echo "   - Multi-model AI support with in-session switching"
    echo "   - Session-based context management"
    echo "   - LSP integration for code understanding"
    echo "   - MCP support for extensibility"
    echo "   - Cross-platform terminal interface"
    echo "   - Permission control for tool execution"
    echo ""
    echo "📚 Learn more:"
    echo "   - GitHub: https://github.com/charmbracelet/crush"
    echo "   - Docs: https://github.com/charmbracelet/crush#readme"
}

# Setup all AI tools
setup_ai_tools() {
    echo "🚀 XaresAICoder AI Tools Setup"
    echo "=============================="
    echo ""
    echo "Available AI coding tools:"
    echo ""
    
    echo "1️⃣  OpenCode SST"
    setup_opencode
    echo ""
    echo "----------------------------------------"
    echo ""
    
    echo "3️⃣  Aider AI"
    setup_aider
    echo ""
    echo "----------------------------------------"
    echo ""
    
    echo "4️⃣  Gemini CLI"
    setup_gemini
    echo ""
    echo "----------------------------------------"
    echo ""
    
    echo "4️⃣  Claude Code"
    setup_claude
    echo ""
    echo "----------------------------------------"
    echo ""
    
    echo "5️⃣  Qwen Code"
    setup_qwen
    echo ""
    echo "----------------------------------------"
    echo ""
    
    echo "6️⃣  OpenAI Codex CLI"
    setup_codex
    echo ""
    echo "----------------------------------------"
    echo ""

    echo "7️⃣  Crush"
    setup_crush
    echo ""
    echo "=============================="
    echo ""
    echo "✅ All AI tools are ready!"
    echo ""
    echo "💡 Choose the tool that best fits your workflow:"
    echo "   • OpenCode SST: Multi-model support, project analysis"
    echo "   • Aider: Interactive pair programming"
    echo "   • Gemini CLI: Google's AI with code generation"
    echo "   • Claude Code: Agentic coding with deep codebase understanding"
    echo "   • Qwen Code: AI workflow automation and code exploration"
    echo "   • OpenAI Codex: OpenAI's terminal-based coding assistant"
    echo "   • Crush: Multi-model AI with session management and LSP integration"
    echo ""
    echo "🔌 VS Code Extensions (install from marketplace):"
    echo "   • Continue: AI code completion and chat"
    echo "   • Cline (Claude Dev): AI file editor and assistant"
    echo ""
    echo "🔑 Don't forget to set up your API keys for the tools you want to use!"
}

# Empty project setup function
setup_empty_project() {
    echo "🏗️  Setting up empty project..."
    cd /workspace
    
    # Create a comprehensive README file
    cat > README.md << 'README_EOF'
# My XaresAICoder Project

Welcome to your new development workspace! This is a clean slate for you to build whatever you want.

## 🚀 Getting Started

This workspace comes with:
- ✅ **Git repository** initialized and ready for commits
- ✅ **VS Code** configured for development
- ✅ **AI coding tools** available in the terminal
- ✅ **Port forwarding** set up for web applications

## 🛠️ What's Next?

1. **Choose your stack**: Install the tools and frameworks you need
2. **Start coding**: Create your project files and structure
3. **Use AI assistance**: Try the available AI tools to boost your productivity
4. **Deploy**: Use port forwarding to test your web applications

## 🤖 Available AI Tools

All AI tools are pre-installed and ready to use:

### Command Line Tools
- `opencode` - Multi-model AI assistant with project analysis
- `aider` - AI pair programming with file editing
- `gemini` - Google's AI for code generation
- `claude` - Anthropic's agentic coding tool
- `qwen-code` - AI workflow automation and code exploration

### VS Code Extensions (install from marketplace)
- **Continue** - AI code completion and chat (`continue.continue`)
- **Cline (Claude Dev)** - AI file editor (`saoudrizwan.claude-dev`)

## 🌐 Port Forwarding

When you start a web server, VS Code will automatically detect it and offer to open it in your browser. Common ports are pre-configured:

- **Port 3000**: Node.js/React applications
- **Port 5000**: Flask/Python applications  
- **Port 8000**: Django applications
- **Port 8080**: Java Spring Boot applications
- **Port 4200**: Angular applications

## 📝 Tips

- Use `git status` to check your repository status
- Run `setup_ai_tools` to see setup instructions for all AI tools
- Install language extensions in VS Code for better development experience
- Use the integrated terminal for all your development commands

## 🔧 Common Setup Commands

### Node.js/JavaScript
```bash
npm init -y
npm install express
```

### Python
```bash
python3 -m venv venv
source venv/bin/activate
pip install flask fastapi django
```

### Java
```bash
# Maven project
mvn archetype:generate -DgroupId=com.example -DartifactId=my-app

# Gradle project  
gradle init --type java-application
```

### Go
```bash
go mod init my-project
```

Happy coding! 🎉
README_EOF

    # Create a basic .gitignore
    cat > .gitignore << 'GITIGNORE_EOF'
# Dependencies
node_modules/
*.egg-info/
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
env/
pip-log.txt
pip-delete-this-directory.txt
.tox/
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
*.log
.git
.mypy_cache
.pytest_cache
.hypothesis

# Build outputs
dist/
build/
*.o
*.so
*.dylib
*.exe
*.dll
*.jar
*.war
*.ear
*.class
target/

# IDE files
.vscode/settings.json
.idea/
*.swp
*.swo
*~

# OS files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
GITIGNORE_EOF

    # Create a simple VS Code workspace configuration
    mkdir -p .vscode
    cat > .vscode/settings.json << 'SETTINGS_EOF'
{
    "files.autoSave": "afterDelay",
    "files.autoSaveDelay": 1000,
    "editor.tabSize": 2,
    "editor.insertSpaces": true,
    "editor.detectIndentation": true,
    "editor.renderWhitespace": "boundary",
    "editor.wordWrap": "on",
    "terminal.integrated.defaultProfile.linux": "bash",
    "git.enableSmartCommit": true,
    "git.confirmSync": false,
    "remote.autoForwardPorts": true,
    "remote.portsAttributes": {
        "3000": {
            "label": "Development Server",
            "onAutoForward": "openBrowserOnce"
        },
        "5000": {
            "label": "Flask/Python Application",
            "onAutoForward": "openBrowserOnce"
        },
        "8000": {
            "label": "Django/FastAPI Application", 
            "onAutoForward": "openBrowserOnce"
        },
        "8080": {
            "label": "Java Spring Boot Application",
            "onAutoForward": "openBrowserOnce"
        },
        "4200": {
            "label": "Angular Application",
            "onAutoForward": "openBrowserOnce"
        }
    }
}
SETTINGS_EOF

    # Create extensions recommendations
    cat > .vscode/extensions.json << 'EXTENSIONS_EOF'
{
    "recommendations": [
        "continue.continue",
        "saoudrizwan.claude-dev",
        "ms-vscode.vscode-json",
        "redhat.vscode-yaml",
        "ms-python.python",
        "ms-vscode.vscode-typescript-next",
        "bradlc.vscode-tailwindcss",
        "esbenp.prettier-vscode",
        "ms-vscode.vscode-eslint",
        "anthropic.claude-code",
        "openai.chatgpt"
    ]
}
EXTENSIONS_EOF

    echo "✅ Empty project created successfully!"
    echo ""
    echo "🎯 Your workspace includes:"
    echo "   • README.md with comprehensive getting started guide"
    echo "   • .gitignore with common patterns for multiple languages"
    echo "   • VS Code settings optimized for development"
    echo "   • Port forwarding configured for common frameworks"
    echo "   • Extension recommendations for enhanced productivity"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Read the README.md for detailed instructions"
    echo "   2. Choose your technology stack and start coding"
    echo "   3. Use 'setup_ai_tools' to explore available AI assistance"
    echo "   4. Install recommended VS Code extensions for better development experience"
}

# Export all functions
export -f setup_empty_project setup_opencode setup_aider setup_gemini setup_claude setup_qwen setup_codex setup_crush setup_ai_tools
EOF

echo "Workspace initialization setup completed."