#!/usr/bin/env bash
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
echo "🤖 AI Coding Tools (CLI, pre-installed):"
echo "  • Claude Code   | claude      | ANTHROPIC_API_KEY or Claude login"
echo "                  | docs: code.claude.com/docs"
echo "  • OpenAI Codex  | codex       | OPENAI_API_KEY or codex login --device-auth"
echo "                  | docs: github.com/openai/codex"
echo "  • Copilot CLI   | copilot     | GitHub login, or GH_TOKEN (PAT with Copilot Requests)"
echo "                  | docs: github.com/github/copilot-cli"
echo "  • OpenCode      | opencode    | OPENAI / ANTHROPIC / GEMINI_API_KEY, many providers"
echo "                  | docs: opencode.ai/docs"
echo "  • Crush         | crush       | ANTHROPIC / OPENAI / GEMINI / GROQ / OPENROUTER_API_KEY"
echo "                  | docs: github.com/charmbracelet/crush"
echo "  • Pi            | pi          | ANTHROPIC / OPENAI / GEMINI_API_KEY (15+ providers)"
echo "                  | docs: pi.dev/docs/latest"
echo ""
echo "📦 VS Code Extensions (pre-installed):"
echo "  • Cline       - agent for multi-file edits (own API keys)"
echo "  • Claude Code - VS Code panel for the claude CLI"
echo "  Optional: Kilo Code (~550 MB, ~350 MB RAM even when idle):"
echo "    code-server --install-extension kilocode.kilo-code"
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
        # Without the credentials (Forgejo token) in the URLs: screens get shared
        echo "$REMOTES" | sed -E 's#(://)[^/@[:space:]]+@#\1***@#; s/^/    /'
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
echo "🔄 Updates (no sudo needed, nothing updates automatically):"
echo "  • update_ai_agents           - all CLI tools to their latest release"
echo "  • update_ai_agents claude pi - only the named tools"
echo "  • VS Code extensions: Extensions view → Update"
echo ""
# Show Git commands only if Git server is enabled
if [ -n "$GIT_SERVER_ENABLED" ] && [ "$GIT_SERVER_ENABLED" = "true" ]; then
    echo "🔧 Git Commands:"
    echo "  • setup_local_remote - Add local Forgejo repository as remote"
    echo ""
fi
echo "💡 Pro Tips:"
echo "  • Type 'info' anytime to see this information"
echo "  • Ask AI assistants about your codebase and request features"
if [ -n "$GIT_SERVER_ENABLED" ] && [ "$GIT_SERVER_ENABLED" = "true" ]; then
    echo "  • Use 'setup_local_remote' to push Quick Clone repos to local Forgejo"
fi
echo ""
INFO_EOF
chmod +x /usr/local/bin/info

# Update command for the AI CLI tools. They live in /opt/ai-tools (npm prefix,
# owned by coder), so no sudo is needed.
cat > /usr/local/bin/update_ai_agents << 'UPDATE_AI_AGENTS_EOF'
#!/bin/bash
# Usage: update_ai_agents [tool ...]   (default: all)
declare -A PACKAGES=(
    [claude]=@anthropic-ai/claude-code
    [codex]=@openai/codex
    [copilot]=@github/copilot
    [crush]=@charmland/crush
    [opencode]=@opencode/cli
    [pi]=@earendil-works/pi-coding-agent
)
TOOLS=("$@")
[ ${#TOOLS[@]} -gt 0 ] || TOOLS=(claude codex copilot crush opencode pi)

FAILED=()
for tool in "${TOOLS[@]}"; do
    package=${PACKAGES[$tool]:-}
    if [ -z "$package" ]; then
        echo "❌ Unknown tool: $tool (known: ${!PACKAGES[*]})"
        FAILED+=("$tool")
        continue
    fi
    echo "🔄 Updating $tool ($package)..."
    if npm install -g "$package@latest" --no-fund --no-audit --loglevel=error; then
        # OpenCode installs all four Linux builds; bin/ keeps the one it uses
        [ "$tool" != opencode ] || rm -rf "$(npm root -g)/@opencode/cli/node_modules/@opencode"
        echo "✅ $tool: $("$tool" --version 2>/dev/null | head -1)"
    else
        echo "❌ $tool could not be updated"
        FAILED+=("$tool")
    fi
done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo ""
    echo "❌ Not updated: ${FAILED[*]}"
    echo "   Behind the Security Proxy, registry.npmjs.org and github.com must be whitelisted."
    exit 1
fi
UPDATE_AI_AGENTS_EOF
chmod +x /usr/local/bin/update_ai_agents

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

# The workspace's own Forgejo account (token). GIT_ADMIN_* only exist in
# containers created before per-workspace accounts.
FORGEJO_USER="${FORGEJO_USER:-$GIT_ADMIN_USER}"
FORGEJO_TOKEN="${FORGEJO_TOKEN:-$GIT_ADMIN_PASSWORD}"
if [ -z "$FORGEJO_USER" ] || [ -z "$FORGEJO_TOKEN" ]; then
    echo "❌ Error: this workspace has no Forgejo account"
    echo "💡 Recreate the workspace, or create the repository at $GIT_SERVER_EXTERNAL_URL"
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

# Create Basic Auth credentials (the token works as password)
AUTH_HEADER=$(echo -n "$FORGEJO_USER:$FORGEJO_TOKEN" | base64 -w0)

# Call Forgejo API to create repository
RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Basic $AUTH_HEADER" \
    -d "{\"name\":\"$REPO_NAME\",\"description\":\"Workspace repository\",\"private\":true,\"auto_init\":false,\"default_branch\":\"main\"}" \
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
# Internal: http://user:token@forgejo:3000/user/repo.git (no /git/ prefix)
GIT_INTERNAL_URL=$(echo "$GIT_REMOTE_URL" | sed "s|https\?://[^/]*/git/|http://$FORGEJO_USER:$FORGEJO_TOKEN@forgejo:3000/|")

echo "✅ Repository created successfully!"
echo ""

# Remote URLs carry the Forgejo token: print them without credentials
hide_credentials() {
    sed -E 's#(://)[^/@[:space:]]+@#\1***@#'
}

# Check if 'origin' remote already exists
CURRENT_ORIGIN=$(git remote get-url origin 2>/dev/null)

if [ -n "$CURRENT_ORIGIN" ]; then
    echo "🔀 Current 'origin' remote points to:"
    echo "   $CURRENT_ORIGIN" | hide_credentials
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
git remote -v | hide_credentials

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

# Empty project setup function
setup_empty_project() {
    echo "🏗️  Setting up empty project..."
    cd /workspace
    
    # Create a comprehensive README file
    cat > README_coder.md << 'README_EOF'
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
- `claude` - Claude Code, Anthropic's agentic coding tool
- `codex` - OpenAI Codex CLI
- `copilot` - GitHub Copilot CLI
- `opencode` - OpenCode, multi-provider coding agent
- `crush` - Multi-model AI agent with in-session model switching
- `pi` - Minimal multi-provider coding agent

Update them with `update_ai_agents` (all) or `update_ai_agents <tool>`.

### VS Code Extensions (pre-installed)
- **Cline** - agent for multi-file edits (`saoudrizwan.claude-dev`)
- **Claude Code** - VS Code panel for the `claude` CLI (`anthropic.claude-code`)

Optional, not pre-installed (about 550 MB, uses about 350 MB RAM even when idle):
**Kilo Code**, agent with chat and autocomplete - `code-server --install-extension kilocode.kilo-code`

## 🌐 Port Forwarding

When you start a web server, VS Code will automatically detect it and offer to open it in your browser. Common ports are pre-configured:

- **Port 3000**: Node.js/React applications
- **Port 5000**: Flask/Python applications  
- **Port 8000**: Django applications
- **Port 8080**: Java Spring Boot applications
- **Port 4200**: Angular applications

## 📝 Tips

- Use `git status` to check your repository status
- Run `info` to see all pre-installed AI tools and their setup hints
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
    echo "   • README_coder.md with comprehensive getting started guide"
    echo "   • .gitignore with common patterns for multiple languages"
    echo "   • VS Code settings optimized for development"
    echo "   • Port forwarding configured for common frameworks"
    echo "   • Extension recommendations for enhanced productivity"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Read the README_coder.md for detailed instructions"
    echo "   2. Choose your technology stack and start coding"
    echo "   3. Run 'info' to see pre-installed AI tools and how to authenticate"
    echo "   4. Install recommended VS Code extensions for better development experience"
}

# Export all functions
export -f setup_empty_project
EOF

echo "Workspace initialization setup completed."