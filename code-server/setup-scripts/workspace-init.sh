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
echo ""
echo "⚡ Setup Commands:"
echo "  • setup_ai_tools - See all AI tool setup instructions"
echo "  • setup_opencode, setup_aider, setup_gemini, setup_claude, setup_qwen, setup_codex"
echo ""
echo "🚀 Quick Start Templates:"
echo "  • setup_flask_project - Create Python Flask application"
echo "  • setup_node_react_project - Create React application"
echo "  • setup_java_spring_project - Create Spring Boot application"
echo ""
echo "📁 Current Directory: $(pwd)"
if [ -d ".git" ]; then
    echo "🌿 Git Status:"
    git status --short --branch 2>/dev/null | head -5
    echo "    Use 'git status' for full status"
fi
echo ""
echo "🔄 Update Commands:"
echo "  • update_aider (pip3)"
echo "  • sudo update_gemini, sudo update_claude, sudo update_qwen, sudo update_codex (npm)"
echo "  • update_opencode (auto-updates)"
echo ""
echo "💡 Pro Tips:"
echo "  • Type 'info' anytime to see this information"
echo "  • Update individual AI tools with their specific update commands"
echo "  • Ask AI assistants about your codebase and request features"
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

# Update OpenCode SST (manual update instructions)
cat > /usr/local/bin/update_opencode << 'UPDATE_OPENCODE_EOF'
#!/bin/bash
echo "🔄 Updating OpenCode SST..."
echo "OpenCode SST updates automatically through its built-in update mechanism."
echo "💡 To check for updates, run: opencode --version"
echo "If an update is available, OpenCode SST will prompt you to update."
echo "✅ OpenCode SST update check completed!"
UPDATE_OPENCODE_EOF
chmod +x /usr/local/bin/update_opencode

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

### 🤖 Qwen Code - AI Workflow Automation
Best for: Code exploration, workflow automation, comprehensive analysis

```bash
# Setup (free tier with 2,000 daily requests)
setup_qwen

# Get started
qwen-code         # Start workflow automation session
```

**Features:**
- Code understanding and exploration
- Workflow automation
- Performance and security analysis
- Documentation and test generation
- Intelligent refactoring assistance

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

# Node.js React project setup function
setup_node_react_project() {
    echo "Setting up Node.js React project structure..."
    cd /workspace
    
    # Check if Node.js is installed, if not install it
    if ! command -v node &> /dev/null; then
        echo "Installing Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    
    # Create package.json
    cat > package.json << 'PACKAGE_EOF'
{
  "name": "xares-react-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint . --ext js,jsx --report-unused-disable-directives --max-warnings 0",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.15.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.15",
    "@types/react-dom": "^18.2.7",
    "@vitejs/plugin-react": "^4.0.3",
    "eslint": "^8.45.0",
    "eslint-plugin-react": "^7.32.2",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.3",
    "vite": "^4.4.5"
  }
}
PACKAGE_EOF

    # Create Vite config
    cat > vite.config.js << 'VITE_EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
})
VITE_EOF

    # Create index.html
    cat > index.html << 'INDEX_EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>XaresAICoder React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
INDEX_EOF

    # Create public directory and favicon
    mkdir -p public
    cat > public/vite.svg << 'VITE_SVG_EOF'
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="31.88" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 257"><defs><linearGradient id="IconifyId1813088fe1fbc01fb466" x1="-.828%" x2="57.636%" y1="7.652%" y2="78.411%"><stop offset="0%" stop-color="#41D1FF"></stop><stop offset="100%" stop-color="#BD34FE"></stop></linearGradient><linearGradient id="IconifyId1813088fe1fbc01fb467" x1="43.376%" x2="50.316%" y1="2.242%" y2="89.03%"><stop offset="0%" stop-color="#FFEA83"></stop><stop offset="8.333%" stop-color="#FFDD35"></stop><stop offset="100%" stop-color="#FFA800"></stop></linearGradient></defs><path fill="url(#IconifyId1813088fe1fbc01fb466)" d="M255.153 37.938L134.897 252.976c-2.483 4.44-8.862 4.466-11.382.048L.875 37.958c-2.746-4.814 1.371-10.646 6.827-9.67l120.385 21.517a6.537 6.537 0 0 0 2.322-.004l117.867-21.483c5.438-.991 9.574 4.796 6.877 9.62Z"></path><path fill="url(#IconifyId1813088fe1fbc01fb467)" d="M185.432.063L96.44 17.501a3.268 3.268 0 0 0-2.634 3.014l-5.474 92.456a3.268 3.268 0 0 0 3.997 3.378l24.777-5.718c2.318-.535 4.413 1.507 3.936 3.838l-7.361 36.047c-.495 2.426 1.782 4.5 4.151 3.78l15.304-4.649c2.372-.72 4.652 1.36 4.15 3.788l-11.698 56.621c-.732 3.542 3.979 5.473 5.943 2.437l1.313-2.028l72.516-144.72c1.215-2.423-.88-5.186-3.54-4.672l-25.505 4.922c-2.396.462-4.435-1.77-3.759-4.114l16.646-57.705c.677-2.35-1.37-4.583-3.769-4.113Z"></path></svg>
VITE_SVG_EOF

    # Create src directory structure
    mkdir -p src/components src/hooks src/utils src/assets

    # Create main.jsx
    cat > src/main.jsx << 'MAIN_EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
MAIN_EOF

    # Create App.jsx
    cat > src/App.jsx << 'APP_EOF'
import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>🎉 Welcome to XaresAICoder!</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Your React application is running successfully with Vite.
        </p>
        <p className="next-steps">
          <strong>Next steps:</strong>
        </p>
        <ul className="steps-list">
          <li>Edit <code>src/App.jsx</code> to build your application</li>
          <li>Use the terminal: <code>npm install package-name</code> to add dependencies</li>
          <li>Run the dev server: <code>npm run dev</code></li>
          <li>Use AI tools for development assistance</li>
        </ul>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
APP_EOF

    # Create App.css
    cat > src/App.css << 'APPCSS_EOF'
#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.react:hover {
  filter: drop-shadow(0 0 2em #61dafbaa);
}

@keyframes logo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: no-preference) {
  a:nth-of-type(2) .logo {
    animation: logo-spin infinite 20s linear;
  }
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: #888;
}

.next-steps {
  margin-top: 1.5em;
  font-size: 1.1em;
}

.steps-list {
  text-align: left;
  max-width: 500px;
  margin: 1em auto;
  line-height: 1.6;
}

.steps-list li {
  margin-bottom: 0.5em;
}

.steps-list code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}
APPCSS_EOF

    # Create index.css
    cat > src/index.css << 'INDEXCSS_EOF'
:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}
INDEXCSS_EOF

    # Create React logo
    cat > src/assets/react.svg << 'REACTSVG_EOF'
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="35.93" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 228"><path fill="#00D8FF" d="M210.483 73.824a171.49 171.49 0 0 0-8.24-2.597c.465-1.9.893-3.777 1.273-5.621c6.238-30.281 2.16-54.676-11.769-62.708c-13.355-7.7-35.196.329-57.254 19.526a171.23 171.23 0 0 0-6.375 5.848a155.866 155.866 0 0 0-4.241-3.917C100.759 3.829 77.587-4.822 63.673 3.233C50.33 10.957 46.379 33.89 51.995 62.588a170.974 170.974 0 0 0 1.892 8.48c-3.28.932-6.445 1.924-9.474 2.98C17.309 83.498 0 98.307 0 113.668c0 15.865 18.582 31.778 46.812 41.427a145.52 145.52 0 0 0 6.921 2.165a167.467 167.467 0 0 0-2.01 9.138c-5.354 28.2-1.173 50.591 12.134 58.266c13.744 7.926 36.812-.22 59.273-19.855a145.567 145.567 0 0 0 5.342-4.923a168.064 168.064 0 0 0 6.92 6.314c21.758 18.722 43.246 26.282 56.54 18.586c13.731-7.949 18.194-32.003 12.4-61.268a145.016 145.016 0 0 0-1.535-6.842c1.62-.48 3.21-.974 4.76-1.488c29.348-9.723 48.443-25.443 48.443-41.52c0-15.417-17.868-30.326-45.517-39.844Zm-6.365 70.984c-1.4.463-2.836.91-4.3 1.345c-3.24-10.257-7.612-21.163-12.963-32.432c5.106-11 9.31-21.767 12.459-31.957c2.619.758 5.16 1.557 7.61 2.4c23.69 8.156 38.14 20.213 38.14 29.504c0 9.896-15.606 22.743-40.946 31.14Zm-10.514 20.834c2.562 12.94 2.927 24.64 1.23 33.787c-1.524 8.219-4.59 13.698-8.382 15.893c-8.067 4.67-25.32-1.4-43.927-17.412a156.726 156.726 0 0 1-6.437-5.87c7.214-7.889 14.423-17.06 21.459-27.246c12.376-1.098 24.068-2.894 34.671-5.345a134.17 134.17 0 0 1 1.386 6.193ZM87.276 214.515c-7.882 2.783-14.16 2.863-17.955.675c-8.075-4.657-11.432-22.636-6.853-46.752a156.923 156.923 0 0 1 1.869-8.499c10.486 2.32 22.093 3.988 34.498 4.994c7.084 9.967 14.501 19.128 21.976 27.15a134.668 134.668 0 0 1-4.877 4.492c-9.933 8.682-19.886 14.842-28.658 17.94ZM50.35 144.747c-12.483-4.267-22.792-9.812-29.858-15.863c-6.35-5.437-9.555-10.836-9.555-15.216c0-9.322 13.897-21.212 37.076-29.293c2.813-.98 5.757-1.905 8.812-2.773c3.204 10.42 7.406 21.315 12.477 32.332c-5.137 11.18-9.399 22.249-12.634 32.792a134.718 134.718 0 0 1-6.318-1.979Zm12.378-84.26c-4.811-24.587-1.616-43.134 6.425-47.789c8.564-4.958 27.502 2.111 47.463 19.835a144.318 144.318 0 0 1 3.841 3.545c-7.438 7.987-14.787 17.08-21.808 26.988c-12.04 1.116-23.565 2.908-34.161 5.309a160.342 160.342 0 0 1-1.76-7.887Zm110.427 27.268a347.8 347.8 0 0 0-7.785-12.803c8.168 1.033 15.994 2.404 23.343 4.08c-2.206 7.072-4.956 14.465-8.193 22.045a381.151 381.151 0 0 0-7.365-13.322Zm-45.032-43.861c5.044 5.465 10.096 11.566 15.065 18.186a322.04 322.04 0 0 0-30.257-.006c4.974-6.559 10.069-12.652 15.192-18.18ZM82.802 87.83a323.167 323.167 0 0 0-7.227 13.238c-3.184-7.553-5.909-14.98-8.134-22.152c7.304-1.634 15.093-2.97 23.209-3.984a321.524 321.524 0 0 0-7.848 12.897Zm8.081 65.352c-8.385-.936-16.291-2.203-23.593-3.793c2.26-7.3 5.045-14.885 8.298-22.6a321.187 321.187 0 0 0 7.257 13.246c2.594 4.48 5.28 8.868 8.038 13.147Zm37.542 31.03c-5.184-5.592-10.354-11.779-15.403-18.433c4.902.192 9.899.29 14.978.29c5.218 0 10.376-.117 15.453-.343c-4.985 6.774-10.018 12.97-15.028 18.486Zm52.198-57.817c3.422 7.8 6.306 15.345 8.596 22.52c-7.422 1.694-15.436 3.058-23.88 4.071a382.417 382.417 0 0 0 7.859-13.026a347.403 347.403 0 0 0 7.425-13.565Zm-16.898 8.101a358.557 358.557 0 0 1-12.281 19.815a329.4 329.4 0 0 1-23.444.823c-7.967 0-15.716-.248-23.178-.732a310.202 310.202 0 0 1-12.513-19.846h.001a307.41 307.41 0 0 1-10.923-20.627a310.278 310.278 0 0 1 10.89-20.637l-.001.001a307.318 307.318 0 0 1 12.413-19.761c7.613-.576 15.42-.876 23.31-.876H128c7.926 0 15.743.303 23.354.883a329.357 329.357 0 0 1 12.335 19.695a358.489 358.489 0 0 1 11.036 20.54a329.472 329.472 0 0 1-11 20.722Zm22.56-122.124c8.572 4.944 11.906 24.881 6.52 51.026c-.344 1.668-.73 3.367-1.15 5.09c-10.622-2.452-22.155-4.275-34.23-5.408c-7.034-10.017-14.323-19.124-21.64-27.008a160.789 160.789 0 0 1 5.888-5.4c18.9-16.447 36.564-22.941 44.612-18.3ZM128 90.808c12.625 0 22.86 10.235 22.86 22.86s-10.235 22.86-22.86 22.86s-22.86-10.235-22.86-22.86s10.235-22.86 22.86-22.86Z"></path></svg>
REACTSVG_EOF

    # Create ESLint config
    cat > .eslintrc.cjs << 'ESLINT_EOF'
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    '@eslint/js/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: '18.2' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}
ESLINT_EOF

    # Create .env file
    cat > .env << 'ENV_EOF'
VITE_APP_TITLE=XaresAICoder React App
VITE_API_URL=http://localhost:3001/api
ENV_EOF

    # Create README.md
    cat > README.md << 'README_EOF'
# React Project

This is a React application created with XaresAICoder using Vite for fast development.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. **Access your app:**
   
   When you start the React dev server, VS Code will automatically detect port 3000
   and provide the correct URL via port forwarding notifications.
   Simply click the provided link to access your application!

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Development

- Edit `src/App.jsx` to add your components and logic
- Add new dependencies with `npm install package-name`
- Use the integrated terminal for package management
- The development server supports hot module replacement (HMR)

## Project Structure

```
src/
├── components/     # Reusable React components
├── hooks/         # Custom React hooks  
├── utils/         # Utility functions
├── assets/        # Static assets (images, icons)
├── App.jsx        # Main App component
├── main.jsx       # Application entry point
├── App.css        # App-specific styles
└── index.css      # Global styles
```

## AI Coding Assistance

XaresAICoder includes powerful AI coding tools. Choose the one that best fits your workflow:

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

### 🤖 Qwen Code - AI Workflow Automation
Best for: Code exploration, workflow automation, comprehensive analysis

```bash
# Setup (free tier with 2,000 daily requests)
setup_qwen

# Get started
qwen-code         # Start workflow automation session
```

**Features:**
- Code understanding and exploration
- Workflow automation
- Performance and security analysis
- Documentation and test generation
- Intelligent refactoring assistance

## Quick Setup for All Tools

Run this command to see setup instructions for all AI tools:
```bash
setup_ai_tools
```

## Tech Stack

- **React 18** - UI library
- **Vite** - Build tool and dev server
- **ESLint** - Code linting
- **CSS3** - Styling

## Next Steps

1. **Install VS Code Extensions** from the marketplace:
   - Continue - AI code completion and chat
   - Cline (Claude Dev) - AI file editor and assistant

2. **Set up AI tools** using the commands above

3. **Start building** your React application with AI assistance!
README_EOF

    # Create VS Code workspace settings for this project
    mkdir -p .vscode
    cat > .vscode/settings.json << 'VSCODE_SETTINGS_EOF'
{
    "typescript.preferences.quoteStyle": "single",
    "javascript.preferences.quoteStyle": "single",
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": true
    },
    "emmet.includeLanguages": {
        "javascript": "javascriptreact"
    },
    "files.associations": {
        "*.jsx": "javascriptreact"
    }
}
VSCODE_SETTINGS_EOF

    # Create .gitignore
    cat > .gitignore << 'GITIGNORE_EOF'
# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Dependencies
node_modules/
dist/
dist-ssr/

# IDE files (keep .vscode for project settings)
.idea/

# OS files
.DS_Store  
*.local

# Environment variables
.env.local
.env.development.local
.env.test.local
.env.production.local

# Temporary files
*.tmp
*.temp

# Build outputs
build/
.vite/
GITIGNORE_EOF
    
    echo "✅ Node.js React project setup complete!"
    echo ""
    echo "📁 Files created:"
    echo "  - package.json (dependencies and scripts)"
    echo "  - vite.config.js (Vite configuration)"
    echo "  - src/App.jsx (main React component)"
    echo "  - src/main.jsx (application entry point)"
    echo "  - index.html (HTML template)"
    echo "  - README.md (project documentation)"
    echo "  - .gitignore (Git ignore rules)"
    echo ""
    echo "🚀 To get started:"
    echo "  1. npm install"
    echo "  2. npm run dev"
    echo ""
    echo "🌐 VS Code will automatically detect port 3000 and provide access URLs!"
}

# Java Spring Boot project setup function
setup_java_spring_project() {
    echo "Setting up Java Spring Boot project structure..."
    cd /workspace
    
    # Check if Java is installed, if not install it
    if ! command -v java &> /dev/null; then
        echo "Installing Java 17..."
        sudo apt-get update
        sudo apt-get install -y openjdk-17-jdk maven
    fi
    
    # Check if Maven is installed
    if ! command -v mvn &> /dev/null; then
        echo "Installing Maven..."
        sudo apt-get install -y maven
    fi
    
    # Create Maven pom.xml
    cat > pom.xml << 'POM_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" 
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.1.5</version>
        <relativePath/>
    </parent>
    
    <groupId>com.xaresaicoder</groupId>
    <artifactId>spring-boot-app</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>XaresAICoder Spring Boot App</name>
    <description>Spring Boot application created with XaresAICoder</description>
    
    <properties>
        <java.version>17</java.version>
    </properties>
    
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>runtime</scope>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-devtools</artifactId>
            <scope>runtime</scope>
            <optional>true</optional>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
POM_EOF

    # Create Maven wrapper
    cat > mvnw << 'MVNW_EOF'
#!/bin/sh
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#    https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# Maven Wrapper script

MAVEN_PROJECTBASEDIR=${MAVEN_BASEDIR:-"$BASE_DIR"}

# OS specific support.  $var _must_ be set to either true or false.
cygwin=false;
darwin=false;
mingw=false
case "`uname`" in
  CYGWIN*) cygwin=true ;;
  MINGW*) mingw=true;;
  Darwin*) darwin=true
    # Use /usr/libexec/java_home if available, otherwise fall back to JAVA_HOME
    if [ -z "$JAVA_HOME" ]; then
      if [ -x "/usr/libexec/java_home" ]; then
        export JAVA_HOME="`/usr/libexec/java_home`"
      else
        export JAVA_HOME="/Library/Java/Home"
      fi
    fi
    ;;
esac

exec mvn "$@"
MVNW_EOF
    chmod +x mvnw

    # Create Maven wrapper for Windows (optional)
    cat > mvnw.cmd << 'MVNW_CMD_EOF'
@REM Licensed to the Apache Software Foundation (ASF) under one
@REM or more contributor license agreements.  See the NOTICE file
@REM distributed with this work for additional information
@REM regarding copyright ownership.  The ASF licenses this file
@REM to you under the Apache License, Version 2.0 (the
@REM "License"); you may not use this file except in compliance
@REM with the License.  You may obtain a copy of the License at
@REM
@REM    https://www.apache.org/licenses/LICENSE-2.0
@REM
@REM Unless required by applicable law or agreed to in writing,
@REM software distributed under the License is distributed on an
@REM "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
@REM KIND, either express or implied.  See the License for the
@REM specific language governing permissions and limitations
@REM under the License.

mvn %*
MVNW_CMD_EOF

    # Create source directory structure
    mkdir -p src/main/java/com/xaresaicoder/springbootapp
    mkdir -p src/main/resources
    mkdir -p src/test/java/com/xaresaicoder/springbootapp

    # Create main application class
    cat > src/main/java/com/xaresaicoder/springbootapp/SpringBootAppApplication.java << 'MAIN_EOF'
package com.xaresaicoder.springbootapp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class SpringBootAppApplication {

    public static void main(String[] args) {
        SpringApplication.run(SpringBootAppApplication.class, args);
    }

}
MAIN_EOF

    # Create a welcome controller
    cat > src/main/java/com/xaresaicoder/springbootapp/controller/WelcomeController.java << 'CONTROLLER_EOF'
package com.xaresaicoder.springbootapp.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/")
public class WelcomeController {

    @GetMapping
    public String welcome() {
        return """
                <html>
                <head>
                    <title>XaresAICoder Spring Boot App</title>
                    <style>
                        body { 
                            font-family: 'Segoe UI', Arial, sans-serif; 
                            max-width: 800px; 
                            margin: 50px auto; 
                            padding: 20px; 
                            background: #f5f5f5; 
                        }
                        .container { 
                            background: white; 
                            padding: 40px; 
                            border-radius: 10px; 
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
                        }
                        h1 { color: #2d5aa0; margin-bottom: 20px; }
                        h2 { color: #5a7ab0; margin-top: 30px; }
                        .next-steps { background: #e8f4fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
                        ul { line-height: 1.8; }
                        code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
                        .status { color: #28a745; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🎉 Welcome to XaresAICoder!</h1>
                        <p class="status">Your Spring Boot application is running successfully.</p>
                        
                        <div class="next-steps">
                            <h2>Next steps:</h2>
                            <ul>
                                <li>Edit <code>src/main/java/com/xaresaicoder/springbootapp/</code> to build your application</li>
                                <li>Check the <a href="/api/status">API Status</a> endpoint</li>
                                <li>Use the terminal: <code>mvn spring-boot:run</code> to restart the app</li>
                                <li>Use AI tools for development assistance</li>
                            </ul>
                        </div>
                        
                        <h2>Tech Stack</h2>
                        <ul>
                            <li><strong>Java 17</strong> - Modern LTS Java version</li>
                            <li><strong>Spring Boot 3.1</strong> - Latest Spring Boot framework</li>
                            <li><strong>Spring Web</strong> - RESTful web services</li>
                            <li><strong>Spring Data JPA</strong> - Database integration</li>
                            <li><strong>H2 Database</strong> - In-memory database for development</li>
                            <li><strong>Maven</strong> - Build and dependency management</li>
                        </ul>
                    </div>
                </body>
                </html>
                """;
    }

    @GetMapping("/api/status")
    public Map<String, Object> apiStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("status", "running");
        status.put("message", "Spring Boot API is working!");
        status.put("framework", "Spring Boot");
        status.put("javaVersion", System.getProperty("java.version"));
        status.put("springBootVersion", "3.1.5");
        return status;
    }
}
CONTROLLER_EOF

    # Create controller directory
    mkdir -p src/main/java/com/xaresaicoder/springbootapp/controller

    # Create application.properties
    cat > src/main/resources/application.properties << 'PROPS_EOF'
# Server Configuration
server.port=8080
server.servlet.context-path=/

# Application Configuration
spring.application.name=xares-spring-boot-app

# Database Configuration (H2 in-memory for development)
spring.datasource.url=jdbc:h2:mem:testdb
spring.datasource.driverClassName=org.h2.Driver
spring.datasource.username=sa
spring.datasource.password=

# H2 Console (for development)
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console

# JPA Configuration
spring.jpa.database-platform=org.hibernate.dialect.H2Dialect
spring.jpa.hibernate.ddl-auto=create-drop
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true

# DevTools
spring.devtools.restart.enabled=true
spring.devtools.livereload.enabled=true

# Logging
logging.level.com.xaresaicoder.springbootapp=DEBUG
logging.level.org.springframework.web=DEBUG
PROPS_EOF

    # Create a simple test
    cat > src/test/java/com/xaresaicoder/springbootapp/SpringBootAppApplicationTests.java << 'TEST_EOF'
package com.xaresaicoder.springbootapp;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class SpringBootAppApplicationTests {

    @Test
    void contextLoads() {
        // This test will pass if the application context loads successfully
    }

}
TEST_EOF

    # Create controller test
    cat > src/test/java/com/xaresaicoder/springbootapp/controller/WelcomeControllerTest.java << 'CONTROLLER_TEST_EOF'
package com.xaresaicoder.springbootapp.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(WelcomeController.class)
class WelcomeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void welcomePage_ShouldReturnHtml() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/html;charset=UTF-8"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("Welcome to XaresAICoder")));
    }

    @Test
    void apiStatus_ShouldReturnJson() throws Exception {
        mockMvc.perform(get("/api/status"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/json"))
                .andExpect(jsonPath("$.status").value("running"))
                .andExpect(jsonPath("$.framework").value("Spring Boot"));
    }
}
CONTROLLER_TEST_EOF

    # Create README.md
    cat > README.md << 'README_EOF'
# Spring Boot Project

This is a Spring Boot application created with XaresAICoder using Java 17 and Spring Boot 3.1.

## Setup

1. Compile the project:
   ```bash
   mvn clean compile
   ```

2. Run the application:
   ```bash
   mvn spring-boot:run
   ```

3. **Access your app:**
   
   When you start the Spring Boot app, VS Code will automatically detect port 8080
   and provide the correct URL via port forwarding notifications.
   Simply click the provided link to access your application!

## Available Commands

- `mvn spring-boot:run` - Start the Spring Boot application
- `mvn clean compile` - Compile the project
- `mvn test` - Run unit tests
- `mvn clean package` - Build JAR file
- `mvn clean install` - Install to local Maven repository

## Development

- Edit `src/main/java/com/xaresaicoder/springbootapp/` to add your controllers and logic
- Add new dependencies to `pom.xml`
- Configure application properties in `src/main/resources/application.properties`
- The application supports hot reload with Spring DevTools

## Project Structure

```
src/
├── main/
│   ├── java/com/xaresaicoder/springbootapp/
│   │   ├── SpringBootAppApplication.java    # Main application class
│   │   └── controller/
│   │       └── WelcomeController.java       # REST controller
│   └── resources/
│       └── application.properties           # Configuration
└── test/
    └── java/com/xaresaicoder/springbootapp/
        ├── SpringBootAppApplicationTests.java       # Main test
        └── controller/
            └── WelcomeControllerTest.java            # Controller tests
```

## Features

- **Spring Boot 3.1** - Latest Spring Boot framework
- **Java 17** - Modern LTS Java version
- **Spring Web** - RESTful web services
- **Spring Data JPA** - Database abstraction layer
- **H2 Database** - In-memory database for development
- **Spring DevTools** - Hot reload and development tools
- **JUnit 5** - Modern testing framework

## Database

The application uses H2 in-memory database for development:
- **Console**: http://localhost:8080/h2-console
- **URL**: `jdbc:h2:mem:testdb`
- **Username**: `sa`
- **Password**: (empty)

## AI Coding Assistance

XaresAICoder includes powerful AI coding tools. Choose the one that best fits your workflow:

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

### 🤖 Qwen Code - AI Workflow Automation
Best for: Code exploration, workflow automation, comprehensive analysis

```bash
# Setup (free tier with 2,000 daily requests)
setup_qwen

# Get started
qwen-code         # Start workflow automation session
```

**Features:**
- Code understanding and exploration
- Workflow automation
- Performance and security analysis
- Documentation and test generation
- Intelligent refactoring assistance

## Quick Setup for All Tools

Run this command to see setup instructions for all AI tools:
```bash
setup_ai_tools
```

## Next Steps

1. **Install VS Code Extensions** for Java development:
   - Extension Pack for Java (Microsoft)
   - Spring Boot Extension Pack
   - Continue - AI code completion and chat
   - Cline (Claude Dev) - AI file editor and assistant

2. **Set up AI tools** using the commands above

3. **Start building** your Spring Boot application with AI assistance!

## API Endpoints

- `GET /` - Welcome page with project information
- `GET /api/status` - API status check (JSON response)
- `GET /h2-console` - H2 database console (development only)

## Testing

Run tests with Maven:
```bash
mvn test
```

Tests include:
- Application context loading test
- Controller unit tests with MockMvc
- JSON response validation
README_EOF

    # Create VS Code workspace settings for Java development
    mkdir -p .vscode
    cat > .vscode/settings.json << 'VSCODE_SETTINGS_EOF'
{
    "java.home": "/usr/lib/jvm/java-17-openjdk-amd64",
    "java.configuration.runtimes": [
        {
            "name": "JavaSE-17",
            "path": "/usr/lib/jvm/java-17-openjdk-amd64"
        }
    ],
    "java.compile.nullAnalysis.mode": "automatic",
    "java.configuration.updateBuildConfiguration": "interactive",
    "java.saveActions.organizeImports": true,
    "java.format.settings.url": "https://raw.githubusercontent.com/google/styleguide/gh-pages/eclipse-java-google-style.xml",
    "maven.executable.path": "/usr/bin/mvn",
    "spring-boot.ls.java.home": "/usr/lib/jvm/java-17-openjdk-amd64",
    "remote.autoForwardPorts": true,
    "remote.portsAttributes": {
        "8080": {
            "label": "Spring Boot Application",
            "onAutoForward": "openBrowserOnce"
        }
    }
}
VSCODE_SETTINGS_EOF

    # Create .gitignore for Java/Maven projects
    cat > .gitignore << 'GITIGNORE_EOF'
# Compiled class files
*.class

# Log files
*.log

# Package Files
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar

# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml
buildNumber.properties
.mvn/timing.properties
.mvn/wrapper/maven-wrapper.jar

# IDE files (keep .vscode for project settings)
.idea/
*.iws
*.iml
*.ipr

# Eclipse
.apt_generated
.classpath
.factorypath
.project
.settings
.springBeans
.sts4-cache

# NetBeans
/nbproject/private/
/nbbuild/
/dist/
/nbdist/
/.nb-gradle/
build/

# VS Code Java extension
.vscode/launch.json
.vscode/tasks.json

# OS files
.DS_Store
*.swp
*.swo
*~

# Application specific
application-local.properties
GITIGNORE_EOF
    
    echo "✅ Java Spring Boot project setup complete!"
    echo ""
    echo "📁 Files created:"
    echo "  - pom.xml (Maven configuration and dependencies)"
    echo "  - src/main/java/ (Java source code)"
    echo "  - SpringBootAppApplication.java (main application class)"
    echo "  - WelcomeController.java (REST controller)"
    echo "  - application.properties (Spring Boot configuration)"
    echo "  - src/test/java/ (unit tests)"
    echo "  - README.md (project documentation)"
    echo "  - .gitignore (Git ignore rules)"
    echo ""
    echo "🚀 To get started:"
    echo "  1. mvn clean compile"
    echo "  2. mvn spring-boot:run"
    echo ""
    echo "🌐 VS Code will automatically detect port 8080 and provide access URLs!"
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
        "anthropic.claude-code"
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
export -f setup_flask_project setup_node_react_project setup_java_spring_project setup_empty_project setup_opencode setup_aider setup_gemini setup_claude setup_qwen setup_codex setup_ai_tools
EOF

echo "Workspace initialization setup completed."