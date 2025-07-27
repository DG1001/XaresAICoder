# XaresAICoder User Guide

Welcome to XaresAICoder, a browser-based AI coding platform that integrates VS Code with OpenCode SST for AI-powered development.

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
- OpenCode SST CLI installed
- Python Flask project template (if selected)

### 3. Setting Up OpenCode SST

OpenCode SST is your AI coding assistant. To get started:

1. Open the terminal in VS Code (Terminal → New Terminal)
2. Authenticate with OpenCode SST:
   ```bash
   opencode auth login
   ```
3. Enter your OpenCode SST API key when prompted
4. Start using AI assistance:
   ```bash
   opencode "create a REST API endpoint for user registration"
   ```

## OpenCode SST Usage

### Basic Commands

- **Authentication**: `opencode auth login`
- **Get help**: `opencode --help`
- **Code generation**: `opencode "your request"`
- **File-specific help**: `opencode "add error handling to app.py"`

### Example Requests

- `opencode "create a database model for users"`
- `opencode "add unit tests for the login function"`
- `opencode "optimize this function for better performance"`
- `opencode "add input validation to the form"`

### Best Practices

1. **Be specific**: Provide clear, detailed requests
2. **Context matters**: Include relevant file names or function names
3. **Iterate**: Start with basic functionality and refine
4. **Review code**: Always review AI-generated code before using it

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

4. Use OpenCode SST for development:
   ```bash
   opencode "add a database connection to my Flask app"
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

**OpenCode SST not working**
- Ensure you've authenticated: `opencode auth login`
- Check your API key is valid
- Verify OpenCode SST is in your PATH: `which opencode`

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

1. **OpenCode SST**: Use `opencode --help` for AI assistance
2. **VS Code**: Use the built-in help and documentation
3. **Flask**: Refer to the official Flask documentation
4. **Platform issues**: Check the error messages in the browser console

### Performance Tips

1. **Close unused terminals** to save resources
2. **Commit your work regularly** using Git
3. **Use OpenCode SST efficiently** - be specific with requests
4. **Monitor workspace timeout** - save work before 120 minutes

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

### Multiple Files with OpenCode SST

When working with multiple files, provide context:
```bash
opencode "update the user model in models.py to include email validation"
opencode "create a view in views.py that uses the user model"
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