# XaresAICoder User Guide

Welcome to XaresAICoder, a browser-based AI coding platform that integrates VS Code with multiple AI coding assistants for enhanced development productivity.

## Getting Started

### 1. Creating Your First Project

1. Open XaresAICoder in your browser
2. Enter a project name in the "Project Name" field
3. Select "Python Flask" as the project type
4. Click "Create Workspace"
5. Wait for the workspace to be created (this may take a few moments)
6. Your VS Code workspace will open in a new tab

### 2. Using Your Workspace

Your workspace comes pre-configured with:
- VS Code extensions for Python development
- Git repository initialized
- Multiple AI coding tools available
- Python Flask project template (if selected)
- GitHub CLI (gh) for repository management

### 3. AI Coding Tools Setup

XaresAICoder provides multiple AI coding assistants. Here's how to get started with each:

#### Quick Setup for All Tools
```bash
setup_ai_tools  # Shows setup instructions for all available AI tools
```

#### OpenCode SST - Multi-model AI Assistant
Best for project analysis and collaborative development:
```bash
setup_opencode      # Quick setup
opencode auth login # Authenticate
opencode            # Start interactive session
# Then type: /init  # Initialize project analysis
```

#### Aider - AI Pair Programming
Best for interactive coding with direct file editing:
```bash
export OPENAI_API_KEY=your_key_here  # or ANTHROPIC_API_KEY, GEMINI_API_KEY
setup_aider
aider  # Start pair programming session
```

#### Gemini CLI - Google's AI Assistant
Best for code generation and debugging:
```bash
export GEMINI_API_KEY=your_key_here  # Get from https://makersuite.google.com/app/apikey
setup_gemini
gemini  # Start interactive session
```

#### Claude Code - Anthropic's Agentic Tool
Best for deep codebase understanding and advanced workflows:
```bash
setup_claude
claude  # Start agentic coding session
```

#### Qwen Code - AI Workflow Automation
Best for comprehensive code analysis and workflow automation:
```bash
setup_qwen
qwen  # Start interactive session
```

#### OpenAI Codex CLI - Terminal-Based Coding Assistant
Best for terminal-based ChatGPT integration with MCP support:
```bash
setup_codex
codex  # Start interactive coding session
```

#### Crush - Multi-Model AI Coding Agent
Best for multi-model flexibility and session-based workflows:
```bash
setup_crush
crush  # Start interactive session
crush --session feature-name  # Named session management
```

## AI Coding Tools Usage

### OpenCode SST Commands

- **Authentication**: `opencode auth login`
- **Interactive mode**: `opencode` (then use `/init`, `/share`, `/help`)
- **Direct requests**: `opencode "your request"`
- **Project analysis**: Use `/init` command in interactive mode

### Aider Commands

- **Start session**: `aider`
- **Add files**: `aider file1.py file2.py` (edit specific files)
- **Git integration**: Aider automatically commits changes
- **Model selection**: Supports OpenAI, Anthropic, Google, and local models

### Gemini CLI Commands

- **Interactive mode**: `gemini`
- **Direct requests**: `gemini "explain this code"`
- **Code generation**: Natural language to code conversion
- **Debugging help**: Error analysis and solutions

### Claude Code Commands

- **Agentic session**: `claude`
- **Multi-file editing**: Understands entire codebase context
- **Git workflows**: Advanced repository operations
- **Complex reasoning**: Handles multi-step development tasks

### Qwen Code Commands

- **Interactive mode**: `qwen`
- **Workflow automation**: Automated code analysis and generation
- **Comprehensive analysis**: Deep understanding of project structure
- **Multi-language support**: Works with various programming languages

### OpenAI Codex CLI Commands

- **Interactive session**: `codex`
- **Terminal integration**: ChatGPT-like experience in terminal
- **MCP support**: Model Context Protocol for enhanced capabilities
- **Direct code assistance**: Quick coding help without leaving terminal

### Crush Commands

- **Start session**: `crush`
- **Named sessions**: `crush --session feature-name` (project-specific contexts)
- **List sessions**: `crush --list-sessions`
- **Model switching**: `/model claude-3-5-sonnet` or `/model gpt-4` (during session)
- **Multi-model support**: Switch between OpenAI, Anthropic, Google, Groq, OpenRouter
- **LSP integration**: Enhanced code understanding via Language Server Protocol

### VS Code AI Extensions

#### Continue Extension
Install from marketplace: `continue.continue`
- Inline code completion
- Sidebar chat interface
- Multiple AI provider support

#### Cline (Claude Dev) Extension
Install from marketplace: `saoudrizwan.claude-dev`
- Direct file editing with Claude AI
- Multi-file operations
- Terminal integration

### Best Practices for All AI Tools

1. **Be specific**: Provide clear, detailed requests
2. **Context matters**: Include relevant file names or function names
3. **Choose the right tool**: 
   - **OpenCode SST**: Project analysis, collaboration
   - **Aider**: Interactive pair programming
   - **Gemini**: Quick code generation
   - **Claude Code**: Complex multi-file tasks
   - **Continue**: Inline completions
   - **Cline**: VS Code integrated editing
4. **Review code**: Always review AI-generated code before using it
5. **Combine tools**: Use different tools for different tasks

## Project Management

### Managing Your Projects

- **View projects**: All your projects are listed on the main dashboard
- **Open workspace**: Click "Open Workspace" to access your project
- **Delete project**: Use the "Delete" button to remove a project permanently

### Project Status Indicators

- 🟢 **Running**: Workspace is active and accessible
- 🔴 **Stopped**: Workspace has been stopped (due to inactivity or manual stop)

### Workspace Lifecycle

- Workspaces automatically stop after 120 minutes of inactivity
- Maximum 5 workspaces per user
- Files are preserved when workspaces restart

## Python Flask Development

### Pre-installed Tools

Your Python Flask workspace includes:
- Python 3 with pip
- Flask and python-dotenv packages
- Virtual environment setup function
- Sample Flask application

### Quick Start for Flask

1. Activate the virtual environment:
   ```bash
   source venv/bin/activate
   ```

2. Install additional packages:
   ```bash
   pip install package-name
   ```

3. Run your Flask app:
   ```bash
   python app.py
   ```

4. Use AI tools for development:
   ```bash
   # OpenCode SST for project analysis
   opencode
   # Then: /init
   
   # Aider for interactive development
   aider app.py
   
   # Gemini for quick code generation
   gemini "add a database connection to my Flask app"
   
   # Continue extension for inline completions (in VS Code)
   ```

### Helper Function

Use the pre-configured `setup_flask_project` function to create a new Flask project structure:
```bash
setup_flask_project
```

## File Persistence

### What's Saved
- All files in your workspace directory
- Git repository history
- Installed packages and configurations

### What's Not Saved
- Running processes (you'll need to restart your apps)
- Terminal sessions
- VS Code layout preferences

## Troubleshooting

### Common Issues

**Workspace won't open**
- Check if the workspace is still running (status indicator)
- Try refreshing the project list
- The workspace may have timed out - create a new one

**AI Tools not working**

For OpenCode SST:
- Ensure you've authenticated: `opencode auth login`
- Check your API key is valid
- Verify OpenCode SST is in your PATH: `which opencode`

For Aider:
- Set your API key: `export OPENAI_API_KEY=your_key` (or ANTHROPIC_API_KEY, GEMINI_API_KEY)
- Run setup: `setup_aider`
- Check installation: `which aider`

For Gemini CLI:
- Set your API key: `export GEMINI_API_KEY=your_key`
- Get API key from: https://makersuite.google.com/app/apikey
- Run setup: `setup_gemini`

For Claude Code:
- Requires Claude Pro/Max subscription or API billing
- Run setup: `setup_claude`
- Follow authentication prompts

For VS Code Extensions (Continue, Cline):
- Install from Extensions marketplace
- Configure API keys in extension settings

**Git issues**
- Git is pre-configured with default user settings
- Update with your details:
  ```bash
  git config user.name "Your Name"
  git config user.email "your.email@example.com"
  ```

**Python/Flask issues**
- Activate virtual environment: `source venv/bin/activate`
- Install missing packages: `pip install package-name`
- Check Python version: `python --version`

### Getting Help

1. **AI Tools**: 
   - OpenCode SST: `opencode --help` or use `/help` in interactive mode
   - Aider: Built-in help and documentation
   - Gemini: Interactive help within the tool
   - Claude Code: Comprehensive built-in guidance
2. **VS Code**: Use the built-in help and documentation
3. **Flask**: Refer to the official Flask documentation
4. **Platform issues**: Check the error messages in the browser console
5. **Setup issues**: Run `setup_ai_tools` for tool-specific guidance

### Performance Tips

1. **Close unused terminals** to save resources
2. **Commit your work regularly** using Git
3. **Use AI tools efficiently** - choose the right tool for each task
4. **Monitor workspace timeout** - save work before 120 minutes
5. **Leverage GitHub CLI** - use `gh` commands for repository management

## Advanced Usage

### Custom Extensions

You can install additional VS Code extensions:
1. Open the Extensions panel (Ctrl+Shift+X)
2. Search for and install extensions
3. Extensions will be available for the session

### Environment Variables

Create a `.env` file for environment-specific settings:
```bash
# .env
DEBUG=True
DATABASE_URL=sqlite:///app.db
SECRET_KEY=your-secret-key
```

### Multi-File Development with AI Tools

**Aider** - Best for multi-file editing:
```bash
aider models.py views.py  # Edit multiple files together
# Aider understands relationships between files
```

**Claude Code** - Best for complex multi-file projects:
```bash
claude  # Understands entire codebase context
# Can handle complex refactoring across multiple files
```

**OpenCode SST** - Good for project-wide analysis:
```bash
opencode
# Use /init to analyze entire project structure
```

**Traditional single-file requests**:
```bash
gemini "update the user model in models.py to include email validation"
```

### GitHub Integration

Use GitHub CLI for seamless Git workflows:
```bash
# Authenticate with GitHub
gh auth login

# Create repository
gh repo create my-project --public

# Push to GitHub
git push -u origin main

# Create pull request
gh pr create --title "Feature: User authentication"
```

## Security Notes

- Your API keys are stored locally in your workspace
- Workspaces are isolated from each other
- No root access is provided in containers
- Regular security updates are applied to base images

## Feedback and Support

If you encounter issues or have suggestions:
1. Check this user guide first
2. Use OpenCode SST for coding questions
3. Report platform issues through the appropriate channels

---

Happy coding with XaresAICoder! 🚀