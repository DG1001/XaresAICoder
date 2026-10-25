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

#### Quick Reference
```bash
info              # Lists all pre-installed AI tools with login hints and the update command
update_ai_agents  # Updates all CLI AI tools (no sudo needed)
```

#### OpenCode - Multi-model AI Assistant
Best for project analysis and collaborative development (75+ providers, or sign in with a GitHub Copilot or ChatGPT account):
```bash
opencode auth login # Authenticate
opencode            # Start interactive session
# Then type: /init  # Initialize project analysis
```

#### Claude Code - Anthropic's Agentic Tool
Best for deep codebase understanding and advanced workflows:
```bash
export ANTHROPIC_API_KEY=your_key_here  # Or sign in with Claude Pro/Max
claude  # Start agentic coding session
# Pro/Max login in the browser workspace: open the URL shown, then paste the code into the terminal
```

#### OpenAI Codex CLI - Terminal-Based Coding Assistant
Best for terminal-based ChatGPT integration with MCP support:
```bash
codex login --device-auth  # Sign in with your ChatGPT account
# or with an API key: printenv OPENAI_API_KEY | codex login --with-api-key
codex  # Start interactive coding session
```

#### GitHub Copilot CLI - GitHub Copilot in the Terminal
Included in every GitHub Copilot plan, including Free and Student:
```bash
copilot  # Start interactive session, then type /login
# Headless: export GH_TOKEN=<fine-grained token with the "Copilot Requests" permission>
```

#### Crush - Multi-Model AI Coding Agent
Best for multi-model flexibility and session-based workflows:
```bash
export ANTHROPIC_API_KEY=your_key_here  # or OPENAI/GEMINI/GROQ/OPENROUTER
crush  # Start interactive session
crush --session feature-name  # Named session management
```

#### Pi - Minimal Multi-Provider Coding Harness
Best for provider-agnostic terminal coding with 15+ providers:
```bash
export ANTHROPIC_API_KEY=your_key_here  # or OPENAI/GEMINI/GROQ/MISTRAL/...
pi  # Start interactive session
pi -p "your question"  # One-shot print mode
# OAuth login instead of an API key: type /login inside pi
```

#### Updating the Tools
Nothing updates automatically, so all participants of a workshop keep the same versions. Update when you want to:
```bash
update_ai_agents             # Update all six CLI tools
update_ai_agents claude pi   # Update only the named tools (claude, codex, copilot, crush, opencode, pi)
```
No sudo is needed; if a tool could not be updated, the command prints an error list and exits with status 1. The tools' own update commands work too (`claude update`, `codex update`, `opencode upgrade`). Update the VS Code extensions manually in the Extensions view. Behind the Security Proxy, updates need `registry.npmjs.org` and `github.com` (both in the default whitelist).

Workspaces created before the current tool set keep their old tools and old update scripts; create a new workspace to get the tools described here.

## AI Coding Tools Usage

### OpenCode Commands

- **Authentication**: `opencode auth login`
- **Interactive mode**: `opencode` (then use `/init`, `/share`, `/help`)
- **Direct requests**: `opencode "your request"`
- **Project analysis**: Use `/init` command in interactive mode
- **Documentation**: https://opencode.ai/docs

### Claude Code Commands

- **Agentic session**: `claude`
- **Multi-file editing**: Understands entire codebase context
- **Git workflows**: Advanced repository operations
- **Complex reasoning**: Handles multi-step development tasks
- **Manual update**: `claude update`

### OpenAI Codex CLI Commands

- **Interactive session**: `codex`
- **Terminal integration**: ChatGPT-like experience in terminal
- **MCP support**: Model Context Protocol for enhanced capabilities
- **Direct code assistance**: Quick coding help without leaving terminal

### GitHub Copilot CLI Commands

- **Interactive session**: `copilot`
- **Login**: `/login` inside the CLI, or headless with `GH_TOKEN` (fine-grained personal access token with the "Copilot Requests" permission)
- **Documentation**: https://github.com/github/copilot-cli

### Crush Commands

- **Start session**: `crush`
- **Named sessions**: `crush --session feature-name` (project-specific contexts)
- **List sessions**: `crush --list-sessions`
- **Model switching**: `/model claude-3-5-sonnet` or `/model gpt-4` (during session)
- **Multi-model support**: Switch between OpenAI, Anthropic, Google, Groq, OpenRouter
- **LSP integration**: Enhanced code understanding via Language Server Protocol

### VS Code AI Extensions

These extensions are pre-installed. Automatic extension updates are disabled, so update them manually in the Extensions view.

#### Cline Extension
Pre-installed: `saoudrizwan.claude-dev`
- Autonomous agent for multi-file edits and terminal commands
- You approve each step
- Bring your own API key (Anthropic, OpenAI, OpenRouter, local models, ...) or use a Cline account

#### Kilo Code Extension
Pre-installed: `kilocode.kilo-code`
- Open source (MIT) agent with chat and autocomplete
- Modes for planning, coding and debugging
- Kilo account (gateway to many models) or your own API keys for 30+ providers

#### Claude Code for VS Code Extension
Pre-installed: `anthropic.claude-code`
- Claude Code panel next to the editor
- Chat, inline diffs and plan review
- Uses the same login as the `claude` CLI

### Best Practices for All AI Tools

1. **Be specific**: Provide clear, detailed requests
2. **Context matters**: Include relevant file names or function names
3. **Choose the right tool**: 
   - **OpenCode**: Project analysis, collaboration
   - **Claude Code**: Complex multi-file tasks
   - **GitHub Copilot CLI**: Terminal agent with your GitHub Copilot plan
   - **Kilo Code**: Inline completions
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

### Sharing Apps with a Custom Subdomain (Aliases)

Each running app inside your workspace is reachable at a long URL like `http://<uuid>-8000.<domain>/`. If you want a short, readable URL for sharing or demoing, use the **Aliases** button on the project card (the chain-link icon next to Notes).

1. Click the **Aliases** icon on a running workspace's card.
2. The form auto-fills a dropdown of **listening ports** the workspace currently has open (e.g. `3000`, `8000`). Pick one, or choose *Custom…* and type any port.
3. Enter a subdomain name — letters/digits/hyphens, 3–32 chars. The preview shows the full URL live.
4. *Optional:* tick **Protect with Basic Auth** and provide a username + password. Recommended whenever the alias is reachable from the public internet.
5. Click **Add Alias**. The URL is immediately usable; copy it from the table to share.

Notes:
- Aliases survive workspace stop/restart. While the workspace is stopped you'll get `502 Bad Gateway`; once it's running again the alias works.
- Reserved names (`git`, `api`, `admin`, …) and already-taken names are rejected with a clear error.
- Deleting an alias frees the name immediately. Visitors to a deleted alias get a clean `404 "Unknown subdomain..."` page rather than landing on your password-protected platform frontend.
- Aliases are **per-workspace** but **globally unique** — `myapp.<domain>` can only point at one workspace at a time.
- The Aliases icon shows a small counter badge with the number of active aliases on each card.

## Group Users (Restricted Dashboard Access)

The admin can give people their own dashboard login that only shows the projects
of certain groups — for example a teacher who looks after the workspaces of one
class.

### For the Admin

1. Put the projects into a group (drag the cards onto a group in the sidebar;
   **Add Group** creates a new one).
2. Open the **Users** tab and click **Add User**: enter a user name, keep or
   replace the generated password, tick one or more groups, **Save**.
3. Pass the user name and password on.

**Edit** changes the groups or sets a new password (this signs the user out);
**Delete** removes the user and signs them out right away. Renaming or deleting
a group in the sidebar carries the users along.

### For Group Users

Sign in with your user name and password (leave the user name empty only for
the admin login). You see the projects of your groups and can:

- open, start, stop and restart workspaces (password-protected workspaces still
  ask for their password),
- rename projects and edit their notes,
- set, change or remove a workspace password.

Creating, deleting and cloning workspaces, moving them to other groups, aliases,
proxy logs and AI conversation logs stay with the admin. "Signed in as …" at
the top shows which account is active; the button next to it logs you out.

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
   # OpenCode for project analysis
   opencode
   # Then: /init
   
   # Claude Code for interactive development
   claude
   
   # Kilo Code extension for inline completions (in VS Code)
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

For OpenCode:
- Ensure you've authenticated: `opencode auth login`
- Check your API key is valid
- Verify OpenCode is in your PATH: `which opencode`

For Claude Code:
- Requires Claude Pro/Max subscription or API billing
- Set `ANTHROPIC_API_KEY` or sign in interactively
- Follow authentication prompts: open the URL shown and paste the code into the terminal

For Codex CLI:
- Sign in with `codex login --device-auth` (ChatGPT account) or `printenv OPENAI_API_KEY | codex login --with-api-key`

For GitHub Copilot CLI:
- Type `/login` in `copilot`, or set `GH_TOKEN` to a fine-grained token with the "Copilot Requests" permission

For all CLI tools:
- They live in `/opt/ai-tools/bin`, which is on your PATH
- Reinstall or update with `update_ai_agents <name>` (no sudo needed)
- Behind the Security Proxy, Copilot CLI needs `.githubcopilot.com`; on installations upgraded from older versions, ask your admin to add it to the whitelist

For VS Code Extensions (Cline, Kilo Code, Claude Code):
- Pre-installed; open the extension and sign in or enter an API key
- Claude Code for VS Code uses the login of the `claude` CLI
- Behind the Security Proxy, Kilo accounts need `.kilo.ai` and Cline accounts `.cline.bot`; on installations upgraded from older versions, ask your admin to add them to the whitelist

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
   - OpenCode: `opencode --help` or use `/help` in interactive mode; docs at https://opencode.ai/docs
   - Claude Code: Comprehensive built-in guidance
   - GitHub Copilot CLI: https://github.com/github/copilot-cli
   - Pi: https://pi.dev
2. **VS Code**: Use the built-in help and documentation
3. **Flask**: Refer to the official Flask documentation
4. **Platform issues**: Check the error messages in the browser console
5. **Setup issues**: Run `info` to see binary names, required env vars, and docs links per tool

### Performance Tips

1. **Close unused terminals** to save resources
2. **Commit your work regularly** using Git
3. **Use AI tools efficiently** - choose the right tool for each task
4. **Monitor workspace timeout** - save work before 120 minutes
5. **Leverage GitHub CLI** - use `gh` commands for repository management

## Cloning Workspaces for Workshops

Teachers can prepare a fully-configured base workspace and then clone it into multiple identical copies for students.

### How to Clone

1. Create and configure a base workspace (install packages, set up files, clone repos, etc.)
2. On the project card, click the **Clone** button (copy icon)
3. In the clone modal:
   - Review the source workspace settings (memory, CPU, proxy mode, group)
   - Set the **number of clones** (1–50)
   - Optionally set a **password** for all cloned workspaces
   - Preview the clone names (`Base Workshop 1`, `Base Workshop 2`, etc.)
4. Click **Clone** — clones appear immediately as "Creating" and become available as each one finishes

### What Gets Cloned

- The entire container filesystem: installed packages, project files, configs, git repos
- Workspace metadata: proxy mode, group, memory/CPU limits, git URL reference

### What Does NOT Get Cloned

- Running processes (each clone starts fresh)
- The source workspace's password (you set a new one or leave clones unprotected)
- AI tool logins and histories of Claude Code, Codex, Copilot CLI, OpenCode, Crush, Pi, Cline and Kilo Code, unless you tick **Copy AI tool logins** in the clone modal

### Technical Details

- Uses `docker commit` to snapshot the source container's filesystem
- Each clone is an independent container with its own Docker copy-on-write layer
- The snapshot image is temporary and cleaned up automatically after all clones are created
- Source workspace can be running or stopped during cloning (briefly paused for consistency)

### Workshop Workflow Example

> The API needs the admin login. Log in once with curl and reuse the cookie:
> `curl -c cookies.txt -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD from .env>"}' http://localhost/api/auth/login`
> (see [API.md → Authentication](API.md#authentication)).

```bash
# 1. Teacher creates and sets up the base workspace via UI

# 2. Clone via API (alternative to UI)
curl -b cookies.txt -X POST http://localhost/api/projects/<source-id>/clone \
  -H "Content-Type: application/json" \
  -d '{"count": 20, "password": "student2026"}'

# 3. Students receive their individual workspace URLs
# Each clone has its own independent environment
```

## Workshop Landing Page

After cloning workspaces for a workshop, use the built-in landing page to distribute them to participants automatically.

### How It Works

1. Participants scan a QR code or open `http://<server>/workshop/`
2. They enter their **name** and **email address**
3. The system assigns the next free running workspace from the configured group
4. The workspace URL is shown immediately with a copy button and a direct link

Each email address can only be registered once. The landing page keeps a secret claim token in the participant's browser and asks the server for the workspace on reload, so reopening the page on the same device shows it again — until the admin releases the claim ("Not your workspace?" lets the next person on a shared computer register); registering the same email from another device is rejected (the server never reveals a workspace URL by email) — participants who lost their link ask the workshop lead, who sees all assignments on the admin page.

### Setup (Admin)

1. Configure `.env`:
   ```
   WORKSHOP_GROUP=JavaLand        # projectName prefix of workshop workspaces
   WORKSHOP_ADMIN_PASSWORD=...    # password for the admin page (required – admin page is disabled without it)
   ```
2. Restart the server container: `docker-compose up -d --build server`
3. Clone your base workspace into N copies (see section above) — the landing page picks them up automatically

### Admin Page

Open `http://<server>/workshop/admin.html` to:

- See all active claims (name, email, assigned workspace, timestamp)
- **Release** a workspace — moves the claim to the history log and makes the workspace available again
- View the **release history** (collapsible, newest first)
- **Export CSV** of all active claims for email distribution

The history is never deleted — released claims are preserved in `/app/workspaces/workshop-claims-history.json`.

### API Summary

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/workshop/status` | — | Available / total / claimed counts |
| `POST /api/workshop/claim` | — | Claim a workspace `{ name, email }` |
| `GET /api/workshop/claims` | ✅ `X-Admin-Password` header | All claims + history (admin) |
| `POST /api/workshop/claims/:id/release` | ✅ `X-Admin-Password` header | Release a claim to history |

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

**Cline** - Multi-file edits from VS Code:
```bash
# Open Cline in VS Code and describe the change across models.py and views.py
# Cline asks for your approval before each step
```

**Claude Code** - Best for complex multi-file projects:
```bash
claude  # Understands entire codebase context
# Can handle complex refactoring across multiple files
```

**OpenCode** - Good for project-wide analysis:
```bash
opencode
# Use /init to analyze entire project structure
```

**Traditional single-file requests**:
```bash
codex "update the user model in models.py to include email validation"
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
2. Use OpenCode for coding questions
3. Report platform issues through the appropriate channels

---

Happy coding with XaresAICoder! 🚀