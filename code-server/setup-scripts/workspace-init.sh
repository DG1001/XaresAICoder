#!/bin/bash
set -e

echo "Setting up workspace initialization..."

# Create a welcome script that runs when terminal opens
cat > /home/coder/.bashrc << 'EOF'
# Default bashrc content
if [ -f /etc/bash.bashrc ]; then
    . /etc/bash.bashrc
fi

# Custom welcome message for XaresAICoder
echo ""
echo "Welcome to XaresAICoder!"
echo ""
echo "To use OpenCode SST:"
echo "1. Run: opencode auth login"
echo "2. Enter your API key when prompted"
echo "3. Start coding with: opencode [your prompt]"
echo ""
echo "For help: opencode --help"
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
    python3 -m venv venv
    source venv/bin/activate
    pip install flask python-dotenv
    
    cat > app.py << 'FLASK_EOF'
from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello_world():
    return 'Hello from XaresAICoder!'

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
FLASK_EOF
    
    cat > requirements.txt << 'REQ_EOF'
Flask==2.3.3
python-dotenv==1.0.0
REQ_EOF
    
    echo "Flask project setup complete!"
    echo "To run: source venv/bin/activate && python app.py"
}

# Export the function
export -f setup_flask_project
EOF

echo "Workspace initialization setup completed."