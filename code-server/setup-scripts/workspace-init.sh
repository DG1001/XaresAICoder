#!/bin/bash
set -e

echo "Setting up workspace initialization..."

# Create VS Code settings with subdomain-based port forwarding
mkdir -p /home/coder/.local/share/code-server/User
cat > /home/coder/.local/share/code-server/User/settings.json << 'SETTINGS_EOF'
{
    "remote.autoForwardPorts": true,
    "remote.portsAttributes": {
        "5000": {
            "label": "Flask Application",
            "onAutoForward": "openBrowserOnce"
        },
        "3000": {
            "label": "Node.js Application", 
            "onAutoForward": "openBrowserOnce"
        },
        "8000": {
            "label": "Django Application",
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

# Create a welcome script that runs when terminal opens
cat > /home/coder/.bashrc << 'EOF'
# Default bashrc content
if [ -f /etc/bash.bashrc ]; then
    . /etc/bash.bashrc
fi

# Custom welcome message for XaresAICoder
echo ""
echo "🚀 Welcome to XaresAICoder!"
echo ""
echo "🤖 Recommended AI Coding Tools:"
echo "  • Continue - VS Code AI completion & chat (install from marketplace)"
echo "  • Cline (Claude Dev) - AI file editor (install from marketplace)"
echo "  • OpenCode SST - Multi-model AI assistant (pre-installed)"
echo "  • Aider - AI pair programming in terminal (pre-installed)"
echo "  • Gemini CLI - Google's AI coding assistant (pre-installed)"
echo "  • Claude Code - Anthropic's AI coding tool (pre-installed)"
echo ""
echo "⚡ Quick Setup:"
echo "  • Command line tools: setup_ai_tools"
echo "  • Individual setup: setup_opencode, setup_aider, setup_gemini, setup_claude"
echo ""
echo "🚀 Quick Start:"
echo "1. Install AI extensions from VS Code marketplace (Continue, Cline)"
echo "2. Run setup_ai_tools to configure command line AI tools"
echo "3. Start coding with AI assistance!"
echo ""
echo "📁 Project Templates:"
echo "- Flask app: setup_flask_project"
echo "- Or create your own project structure"
echo ""
echo "💡 Pro Tips:"
echo "- Ask questions about your codebase"
echo "- Request new features in Plan/Build mode"
echo "- Share sessions with /share command"
echo ""

# Add aliases for common commands
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# Git configuration helper
git config --global init.defaultBranch main
git config --global user.name "XaresAICoder User" 2>/dev/null || true
git config --global user.email "user@xaresaicoder.local" 2>/dev/null || true

# Python virtual environment setup function
setup_flask_project() {
    echo "Setting up Flask project structure..."
    cd /workspace
    
    # Create virtual environment with clean isolation
    python3 -m venv venv --clear
    
    # Create Flask application
    cat > app.py << 'FLASK_EOF'
from flask import Flask, render_template, jsonify
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key')

@app.route('/')
def index():
    return '''
    <h1>🎉 Welcome to XaresAICoder!</h1>
    <p>Your Flask application is running successfully.</p>
    <p><a href="/api/status">Check API Status</a></p>
    <p><strong>Next steps:</strong></p>
    <ul>
        <li>Edit this file (app.py) to build your application</li>
        <li>Use the terminal to install additional packages: <code>pip install package-name</code></li>
        <li>Run the app: <code>python app.py</code></li>
    </ul>
    '''

@app.route('/api/status')
def api_status():
    return jsonify({
        'status': 'running',
        'message': 'Flask API is working!',
        'framework': 'Flask',
        'python_version': '3.11+'
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
FLASK_EOF
    
    # Create requirements.txt
    cat > requirements.txt << 'REQ_EOF'
Flask==3.1.1
python-dotenv==1.1.1
requests==2.32.4
REQ_EOF

    # Create .env file
    cat > .env << 'ENV_EOF'
SECRET_KEY=your-secret-key-here
FLASK_ENV=development
FLASK_DEBUG=True
ENV_EOF

    # Create a simple README
    cat > README.md << 'README_EOF'
# Flask Project

This is a Flask application created with XaresAICoder.

## Setup

1. Activate the virtual environment:
   ```bash
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the application:
   ```bash
   python app.py
   ```

4. **Access your app:**
   
   When you start the Flask app, VS Code will automatically detect port 5000
   and provide the correct URL via port forwarding notifications.
   Simply click the provided link to access your application!

## Development

- Edit `app.py` to add your routes and logic
- Add new dependencies to `requirements.txt`
- Use the integrated terminal for package management

## AI Coding Assistance

XaresAICoder includes four powerful AI coding tools. Choose the one that best fits your workflow:

### 🤖 OpenCode SST - Multi-model AI Assistant
Best for: Project analysis, multi-model support, collaborative development

```bash
# Quick setup
setup_opencode

# Get started
opencode          # Start interactive session
# Then type: /init  # Initialize project analysis
```

**Key Commands:**
- `/init` - Analyze your project
- `/share` - Share session for collaboration
- `/help` - Show available commands

### 🤖 Aider - AI Pair Programming
Best for: Interactive coding, file editing, git integration

```bash
# Setup (requires API key)
export OPENAI_API_KEY=your_key_here  # or ANTHROPIC_API_KEY, GEMINI_API_KEY
setup_aider

# Get started
aider             # Start interactive pair programming
```

**Features:**
- Direct file editing with AI
- Automatic git commits
- Supports multiple AI models
- Works with your existing codebase

### 🤖 Gemini CLI - Google's AI Assistant  
Best for: Code generation, debugging, Google ecosystem integration

```bash
# Setup (requires API key from https://makersuite.google.com/app/apikey)
export GEMINI_API_KEY=your_key_here
setup_gemini

# Get started
gemini            # Start interactive session
```

**Features:**
- Natural language code generation
- Code explanation and debugging
- Project analysis and suggestions

### 🤖 Claude Code - Anthropic's Agentic Tool
Best for: Deep codebase understanding, multi-file editing, advanced workflows

```bash
# Setup (requires Claude Pro/Max or API billing)
setup_claude

# Get started
claude            # Start agentic coding session
```

**Features:**
- Understands entire codebase
- Multi-file editing capabilities
- Git workflow automation
- Advanced reasoning and planning

## Quick Setup for All Tools

Run this command to see setup instructions for all AI tools:
```bash
setup_ai_tools
```
README_EOF

    # Create VS Code workspace settings for this project
    mkdir -p .vscode
    cat > .vscode/settings.json << 'VSCODE_SETTINGS_EOF'
{
    "python.defaultInterpreterPath": "./venv/bin/python",
    "python.terminal.activateEnvironment": true,
    "python.linting.enabled": true,
    "python.linting.pylintEnabled": true,
    "python.formatting.provider": "black",
    "python.envFile": "${workspaceFolder}/.env"
}
VSCODE_SETTINGS_EOF

    # Create .gitignore
    cat > .gitignore << 'GITIGNORE_EOF'
# Virtual environment
venv/
env/

# Python cache
__pycache__/
*.pyc
*.pyo
*.pyd
.Python

# Environment variables
.env.local
.env.production

# IDE files (keep .vscode for project settings)
.idea/

# Logs
*.log

# Database
*.db
*.sqlite

# OS files
.DS_Store
Thumbs.db
GITIGNORE_EOF
    
    echo "✅ Flask project setup complete!"
    echo ""
    echo "📁 Files created:"
    echo "  - app.py (main Flask application)"
    echo "  - requirements.txt (dependencies)"
    echo "  - .env (environment variables)"
    echo "  - README.md (project documentation)"
    echo "  - .gitignore (Git ignore rules)"
    echo ""
    echo "🚀 To get started:"
    echo "  1. source venv/bin/activate"
    echo "  2. pip install -r requirements.txt"
    echo "  3. python app.py"
    echo ""
    echo "🌐 VS Code will automatically detect port 5000 and provide access URLs!"
}

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
    echo "=============================="
    echo ""
    echo "✅ All AI tools are ready!"
    echo ""
    echo "💡 Choose the tool that best fits your workflow:"
    echo "   • OpenCode SST: Multi-model support, project analysis"
    echo "   • Aider: Interactive pair programming"
    echo "   • Gemini CLI: Google's AI with code generation"
    echo "   • Claude Code: Agentic coding with deep codebase understanding"
    echo ""
    echo "🔌 VS Code Extensions (install from marketplace):"
    echo "   • Continue: AI code completion and chat"
    echo "   • Cline (Claude Dev): AI file editor and assistant"
    echo ""
    echo "🔑 Don't forget to set up your API keys for the tools you want to use!"
}

# Export all functions
export -f setup_flask_project setup_opencode setup_aider setup_gemini setup_claude setup_ai_tools
EOF

echo "Workspace initialization setup completed."