# GitHub Integration in XaresAICoder

XaresAICoder workspaces include GitHub CLI (`gh`) for seamless repository management directly from VS Code.

## Quick Start

### 1. Authentication
```bash
# In VS Code Terminal
gh auth login
```

Follow the prompts to authenticate with GitHub.

### 2. Create New Repository
```bash
# Create and push new project
gh repo create my-awesome-project --public
git remote add origin https://github.com/username/my-awesome-project.git
git add .
git commit -m "Initial commit from XaresAICoder"
git push -u origin main
```

### 3. Clone Existing Repository
```bash
# Clone and open in VS Code
gh repo clone username/existing-repo
cd existing-repo
code .
```

## Common Workflows

### Creating a New Project Repository

**For Flask Projects:**
```bash
# Your project is already initialized with git
# Just create the GitHub repo and push
gh repo create my-flask-app --public --description "Flask app built with XaresAICoder"
git remote add origin https://github.com/username/my-flask-app.git
git push -u origin main
```

### Working with Existing Projects

**Clone and Start Development:**
```bash
# Clone your repository
gh repo clone username/my-project
cd my-project

# Install dependencies (if Python/Flask)
pip install -r requirements.txt

# Start developing
code .
```

### Branch Management
```bash
# Create and switch to feature branch
git checkout -b feature/new-feature

# Push branch to GitHub
git push -u origin feature/new-feature

# Create pull request
gh pr create --title "Add new feature" --body "Description of changes"
```

### Issue Management
```bash
# View issues
gh issue list

# Create new issue
gh issue create --title "Bug report" --body "Description of the bug"

# View specific issue
gh issue view 123
```

## Advanced Features

### Repository Management
```bash
# Fork a repository
gh repo fork username/repo-name

# View repository info
gh repo view

# Set repository visibility
gh repo edit --visibility private
```

### Release Management
```bash
# Create a release
gh release create v1.0.0 --title "First Release" --notes "Initial release"

# List releases
gh release list

# Download release assets
gh release download v1.0.0
```

### Collaboration
```bash
# Add collaborators
gh api repos/:owner/:repo/collaborators/username -X PUT

# View repository contributors
gh api repos/:owner/:repo/contributors
```

## SSH Keys (Alternative Authentication)

For enhanced security, you can use SSH keys instead of HTTPS:

### 1. Generate SSH Key in Workspace
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub
```

### 2. Add to GitHub
- Copy the public key output
- Go to GitHub → Settings → SSH and GPG keys
- Add the new SSH key

### 3. Clone with SSH
```bash
gh repo clone git@github.com:username/repo-name.git
```

## Integration with AI Tools

XaresAICoder includes several AI coding assistants that work great with GitHub:

### Cline (Claude Dev)
- Can read your repository structure
- Helps write commit messages
- Suggests code improvements

### Aider
- Direct integration with git
- Automatically commits changes
- Works with GitHub issues

### Continue
- Code completion with GitHub context
- README generation
- Documentation updates

## Best Practices

### 1. Commit Messages
```bash
# Use conventional commits
git commit -m "feat: add user authentication"
git commit -m "fix: resolve login bug"
git commit -m "docs: update API documentation"
```

### 2. Branch Protection
```bash
# Enable branch protection via GitHub CLI
gh api repos/:owner/:repo/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":[]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":1}'
```

### 3. Automated Workflows
Create `.github/workflows/` in your repository for CI/CD:

```yaml
# .github/workflows/python-app.yml
name: Python application

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Set up Python
      uses: actions/setup-python@v3
      with:
        python-version: '3.9'
    - name: Install dependencies
      run: |
        pip install -r requirements.txt
    - name: Run tests
      run: |
        python -m pytest
```

## Troubleshooting

### Authentication Issues
```bash
# Re-authenticate
gh auth logout
gh auth login

# Check current authentication
gh auth status
```

### Repository Access
```bash
# Check repository permissions
gh repo view --json permissions

# Verify SSH connection
ssh -T git@github.com
```

### Network Issues
```bash
# Test GitHub API connectivity
gh api user

# Check git configuration
git config --list
```

## Tips for XaresAICoder

1. **Use the integrated terminal** - All `gh` commands work directly in VS Code terminal
2. **Leverage AI assistants** - Ask Cline or Aider to help with git workflows
3. **Keep workspaces organized** - Use meaningful repository names and descriptions
4. **Regular commits** - Commit frequently to avoid losing work
5. **Branch protection** - Use GitHub's branch protection features for important repositories

Happy coding with XaresAICoder and GitHub! 🚀