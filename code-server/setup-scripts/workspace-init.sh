#!/bin/bash
set -e

echo "Setting up workspace initialization..."

# Create VS Code settings to reduce port forwarding notifications
mkdir -p /home/coder/.local/share/code-server/User
cat > /home/coder/.local/share/code-server/User/settings.json << 'SETTINGS_EOF'
{
    "remote.autoForwardPorts": false,
    "remote.portsAttributes": {
        "5000": {
            "label": "Flask App - Use subdomain URL instead!",
            "onAutoForward": "ignore"
        },
        "3000": {
            "label": "Node.js App - Use subdomain URL instead!",
            "onAutoForward": "ignore"
        },
        "8000": {
            "label": "Django App - Use subdomain URL instead!",
            "onAutoForward": "ignore"
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
echo "🤖 OpenCode SST AI Assistant Ready"
echo ""
echo "Quick Start:"
echo "1. Configure API: opencode auth login"
echo "2. Initialize project: opencode (then type /init)"
echo "3. Start coding with AI assistance"
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

## AI Assistance with OpenCode SST

Get AI-powered development assistance:

1. **Initialize OpenCode for this project:**
   ```bash
   opencode
   # Then type: /init
   ```

2. **Ask questions about your code:**
   ```bash
   opencode
   # Then ask: "How can I improve this Flask app structure?"
   ```

3. **Request new features:**
   ```bash
   opencode
   # Then type: "Add user authentication with session management"
   ```

4. **Get help with specific files:**
   ```bash
   opencode
   # Then: "Review app.py and suggest improvements"
   ```

**Useful OpenCode Commands:**
- `/init` - Initialize project analysis
- `/share` - Share session for collaboration
- `/help` - Show available commands
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

# Export the function
export -f setup_flask_project
EOF

echo "Workspace initialization setup completed."