# XaresAICoder Credential Management System

## Overview

Enterprise-grade credential management system for XaresAICoder that provides centralized, secure storage and distribution of SSH keys, API tokens, and authentication credentials across all user workspaces.

## Problem Statement

### Current Issues
- **SSH Key Sprawl**: Each `gh auth login` creates new public keys in GitHub
- **Token Duplication**: API keys entered manually in every workspace
- **Security Risk**: Credentials stored in plain text in containers
- **No Centralization**: Each user manages credentials independently
- **Poor UX**: Repetitive authentication setup for each workspace

### Enterprise Requirements
- **Single SSH Key**: One key pair per user, registered once with Git providers
- **Token Management**: Central storage for GitHub, Forgejo, GitLab tokens
- **AI Integration**: Secure API key distribution for LLM providers
- **Audit Trail**: Track credential usage and access
- **Encryption**: All credentials encrypted at rest and in transit

## Architecture Overview

```
┌─ Frontend (React) ────────────────────┐
│  ┌─ Credentials Tab ─────────────────┐ │
│  │ • SSH Key Management             │ │
│  │ • Git Provider Tokens           │ │
│  │ • AI Provider API Keys          │ │
│  │ • Security Settings             │ │
│  └─────────────────────────────────────┘ │
└───────────────────────────────────────────┘
               │ HTTPS/WSS
               ▼
┌─ Backend API (Node.js/Express) ───────┐
│  ┌─ Credential Service ──────────────┐ │
│  │ • Encrypted Storage              │ │
│  │ • User Isolation                 │ │
│  │ • Token Validation               │ │
│  │ • Audit Logging                  │ │
│  └─────────────────────────────────────┘ │
│  ┌─ Workspace Injection ────────────┐ │
│  │ • SSH Key Mounting               │ │
│  │ • Environment Variables          │ │
│  │ • Helper Script Generation       │ │
│  └─────────────────────────────────────┘ │
└───────────────────────────────────────────┘
               │ Docker API
               ▼
┌─ Workspace Containers ────────────────┐
│  ~/.ssh/id_ed25519    (SSH Key)       │
│  ~/.gitconfig         (Git Config)    │
│  ~/.env              (API Keys)       │
│  ~/bin/git-helpers/* (Helper Scripts) │
└───────────────────────────────────────────┘
```

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)

#### Backend Foundation
```javascript
// New service: credential-service.js
class CredentialService {
  // Core encryption/decryption
  async encrypt(data, userKey) { /* AES-256-GCM */ }
  async decrypt(encryptedData, userKey) { /* AES-256-GCM */ }
  
  // User key derivation from session
  async deriveUserKey(userId, sessionToken) { /* PBKDF2 */ }
  
  // Database operations
  async storeCredential(userId, type, name, data) { /* Encrypted storage */ }
  async retrieveCredential(userId, type, name) { /* Decrypted retrieval */ }
}
```

#### Database Schema
```sql
-- credentials table
CREATE TABLE credentials (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  credential_type ENUM('ssh_key', 'git_token', 'ai_token') NOT NULL,
  provider VARCHAR(100), -- github, forgejo, openai, etc.
  name VARCHAR(255) NOT NULL,
  encrypted_data TEXT NOT NULL,
  iv VARCHAR(255) NOT NULL, -- AES initialization vector
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  UNIQUE(user_id, credential_type, provider, name)
);

-- audit log
CREATE TABLE credential_audit (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  credential_id UUID REFERENCES credentials(id),
  action ENUM('create', 'read', 'update', 'delete', 'inject') NOT NULL,
  workspace_id VARCHAR(255), -- if used in workspace
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

#### API Endpoints
```javascript
// Credential CRUD
POST   /api/credentials/ssh-keys
GET    /api/credentials/ssh-keys
PUT    /api/credentials/ssh-keys/:id
DELETE /api/credentials/ssh-keys/:id

POST   /api/credentials/tokens
GET    /api/credentials/tokens
PUT    /api/credentials/tokens/:id  
DELETE /api/credentials/tokens/:id

// Credential testing
POST   /api/credentials/test/github
POST   /api/credentials/test/forgejo
POST   /api/credentials/test/openai

// Workspace injection
GET    /api/credentials/workspace/:workspaceId
POST   /api/credentials/inject/:workspaceId
```

### Phase 2: Frontend Interface (Week 2-3)

#### Credentials Tab Design
```html
<!-- Main Credentials Tab -->
<div class="credentials-container">
  <!-- SSH Keys Section -->
  <div class="credential-section">
    <h3>SSH Keys</h3>
    <div class="ssh-key-manager">
      <div class="key-display">
        <label>Default SSH Key (ED25519)</label>
        <textarea readonly>ssh-ed25519 AAAA...user@xaresaicoder</textarea>
        <div class="key-actions">
          <button class="btn-primary" onclick="generateSSHKey()">Generate New</button>
          <button class="btn-secondary" onclick="exportSSHKey()">Export Public</button>
          <button class="btn-secondary" onclick="copyToClipboard()">Copy</button>
        </div>
      </div>
      <div class="key-providers">
        <h4>Registered with:</h4>
        <div class="provider-status">
          <span class="provider github registered">GitHub ✓</span>
          <span class="provider forgejo pending">Forgejo ⏳</span>
          <span class="provider gitlab error">GitLab ✗</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Git Providers Section -->
  <div class="credential-section">
    <h3>Git Providers</h3>
    <div class="token-list">
      <div class="token-item">
        <img src="/icons/github.svg" alt="GitHub">
        <div class="token-info">
          <label>GitHub Personal Access Token</label>
          <input type="password" placeholder="ghp_xxxxxxxxxxxx" id="github-token">
          <small>Permissions: repo, user, delete_repo</small>
        </div>
        <div class="token-actions">
          <button class="btn-success" onclick="testToken('github')">Test</button>
          <button class="btn-primary" onclick="saveToken('github')">Save</button>
        </div>
      </div>
      
      <div class="token-item">
        <img src="/icons/forgejo.svg" alt="Forgejo">
        <div class="token-info">
          <label>Forgejo Access Token</label>
          <input type="password" placeholder="xxxxxxxxxxxxxxxx" id="forgejo-token">
          <input type="url" placeholder="https://git.company.com" id="forgejo-url">
        </div>
        <div class="token-actions">
          <button class="btn-success" onclick="testToken('forgejo')">Test</button>
          <button class="btn-primary" onclick="saveToken('forgejo')">Save</button>
        </div>
      </div>
    </div>
  </div>

  <!-- AI Providers Section -->
  <div class="credential-section">
    <h3>AI Providers</h3>
    <div class="ai-token-list">
      <div class="token-item">
        <img src="/icons/openai.svg" alt="OpenAI">
        <div class="token-info">
          <label>OpenAI API Key</label>
          <input type="password" placeholder="sk-xxxxxxxxxxxx" id="openai-key">
          <small>Used by: Aider, Continue, Custom tools</small>
        </div>
        <div class="token-actions">
          <button class="btn-success" onclick="testAIToken('openai')">Test</button>
          <button class="btn-primary" onclick="saveAIToken('openai')">Save</button>
        </div>
      </div>
      
      <div class="token-item">
        <img src="/icons/anthropic.svg" alt="Anthropic">
        <div class="token-info">
          <label>Anthropic API Key</label>
          <input type="password" placeholder="sk-ant-xxxxxxxxxxxx" id="anthropic-key">
          <small>Used by: Cline, Claude Code</small>
        </div>
        <div class="token-actions">
          <button class="btn-success" onclick="testAIToken('anthropic')">Test</button>
          <button class="btn-primary" onclick="saveAIToken('anthropic')">Save</button>
        </div>
      </div>
      
      <div class="token-item">
        <img src="/icons/google.svg" alt="Google">
        <div class="token-info">
          <label>Google AI API Key</label>
          <input type="password" placeholder="AIxxxxxxxxxxxxxxxx" id="google-key">
          <small>Used by: Gemini CLI</small>
        </div>
        <div class="token-actions">
          <button class="btn-success" onclick="testAIToken('google')">Test</button>
          <button class="btn-primary" onclick="saveAIToken('google')">Save</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Security Settings -->
  <div class="credential-section">
    <h3>Security Settings</h3>
    <div class="security-options">
      <label class="checkbox-option">
        <input type="checkbox" id="auto-inject-credentials">
        <span>Automatically inject credentials into new workspaces</span>
      </label>
      <label class="checkbox-option">
        <input type="checkbox" id="audit-logging">
        <span>Enable audit logging for credential usage</span>
      </label>
      <label class="checkbox-option">
        <input type="checkbox" id="session-timeout">
        <span>Clear credentials on session timeout</span>
      </label>
      <button class="btn-danger" onclick="clearAllCredentials()">Clear All Credentials</button>
    </div>
  </div>
</div>
```

#### JavaScript Frontend Logic
```javascript
// credentials-manager.js
class CredentialsManager {
  constructor() {
    this.apiBase = '/api/credentials';
  }

  // SSH Key Management
  async generateSSHKey() {
    const response = await fetch(`${this.apiBase}/ssh-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ed25519', name: 'default' })
    });
    const data = await response.json();
    this.displaySSHKey(data.publicKey);
  }

  async exportSSHKey() {
    const response = await fetch(`${this.apiBase}/ssh-keys/default`);
    const data = await response.json();
    this.downloadFile('xaresaicoder_ed25519.pub', data.publicKey);
  }

  // Token Management
  async saveToken(provider) {
    const token = document.getElementById(`${provider}-token`).value;
    const url = document.getElementById(`${provider}-url`)?.value;
    
    const response = await fetch(`${this.apiBase}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, token, url })
    });
    
    if (response.ok) {
      this.showSuccess(`${provider} token saved successfully`);
    }
  }

  async testToken(provider) {
    const response = await fetch(`${this.apiBase}/test/${provider}`, {
      method: 'POST'
    });
    const data = await response.json();
    
    if (data.success) {
      this.showProviderStatus(provider, 'connected');
    } else {
      this.showProviderStatus(provider, 'error', data.error);
    }
  }

  // AI Token Management
  async saveAIToken(provider) {
    const key = document.getElementById(`${provider}-key`).value;
    
    const response = await fetch(`${this.apiBase}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        provider, 
        token: key, 
        type: 'ai_provider' 
      })
    });
    
    if (response.ok) {
      this.showSuccess(`${provider} API key saved successfully`);
    }
  }

  async testAIToken(provider) {
    const response = await fetch(`${this.apiBase}/test/${provider}`, {
      method: 'POST'
    });
    const data = await response.json();
    
    this.updateTokenStatus(provider, data.success ? 'valid' : 'invalid');
  }
}
```

### Phase 3: Workspace Integration (Week 3-4)

#### Credential Injection System
```javascript
// Enhanced docker-service.js
class DockerService {
  async createWorkspaceContainer(projectId, projectType, authOptions = {}) {
    // ... existing code ...
    
    // Inject user credentials
    await this.injectCredentials(container, projectId, authOptions.userId);
    
    return workspace;
  }

  async injectCredentials(container, projectId, userId) {
    const credentialService = require('./credential-service');
    
    // Get user credentials
    const sshKey = await credentialService.getSSHKey(userId);
    const gitTokens = await credentialService.getGitTokens(userId);
    const aiTokens = await credentialService.getAITokens(userId);
    
    // Create temporary credential files
    const tempDir = `/tmp/workspace-creds-${projectId}`;
    await fs.mkdir(tempDir, { recursive: true });
    
    // Write SSH key
    if (sshKey) {
      await fs.writeFile(`${tempDir}/id_ed25519`, sshKey.privateKey, { mode: 0o600 });
      await fs.writeFile(`${tempDir}/id_ed25519.pub`, sshKey.publicKey, { mode: 0o644 });
    }
    
    // Create git config
    const gitConfig = this.generateGitConfig(userId, gitTokens);
    await fs.writeFile(`${tempDir}/gitconfig`, gitConfig);
    
    // Create environment file for AI tokens
    const envFile = this.generateEnvFile(aiTokens);
    await fs.writeFile(`${tempDir}/env`, envFile);
    
    // Create helper scripts
    await this.generateHelperScripts(tempDir, gitTokens);
    
    // Copy files into container
    await this.copyCredentialsToContainer(container, tempDir, projectId);
    
    // Cleanup temporary files
    await fs.rm(tempDir, { recursive: true });
  }

  generateGitConfig(userId, gitTokens) {
    return `[user]
    name = ${userId}
    email = ${userId}@xaresaicoder.local

[core]
    editor = code --wait
    autocrlf = input

[init]
    defaultBranch = main

[pull]
    rebase = false

[credential]
    helper = store
    
${gitTokens.github ? `[credential "https://github.com"]
    username = ${gitTokens.github.username}
    helper = "!f() { echo \\"password=${gitTokens.github.token}\\"; }; f"` : ''}

${gitTokens.forgejo ? `[credential "${gitTokens.forgejo.url}"]
    username = ${gitTokens.forgejo.username}
    helper = "!f() { echo \\"password=${gitTokens.forgejo.token}\\"; }; f"` : ''}`;
  }

  generateEnvFile(aiTokens) {
    let envContent = '# AI Provider API Keys\n';
    
    if (aiTokens.openai) {
      envContent += `export OPENAI_API_KEY="${aiTokens.openai.token}"\n`;
    }
    
    if (aiTokens.anthropic) {
      envContent += `export ANTHROPIC_API_KEY="${aiTokens.anthropic.token}"\n`;
    }
    
    if (aiTokens.google) {
      envContent += `export GOOGLE_API_KEY="${aiTokens.google.token}"\n`;
    }
    
    // Aider configuration
    envContent += `export AIDER_AUTO_COMMITS=false\n`;
    envContent += `export AIDER_DARK_MODE=true\n`;
    
    return envContent;
  }

  async generateHelperScripts(tempDir, gitTokens) {
    // GitHub repository creation script
    if (gitTokens.github) {
      const githubScript = `#!/bin/bash
# GitHub Repository Creation Helper
REPO_NAME="\$1"
DESCRIPTION="\$2"
PRIVATE="\${3:-false}"

if [ -z "\$REPO_NAME" ]; then
  echo "Usage: create-github-repo <name> [description] [private]"
  exit 1
fi

# Create repository via API
curl -X POST \\
  -H "Authorization: token ${gitTokens.github.token}" \\
  -H "Accept: application/vnd.github.v3+json" \\
  https://api.github.com/user/repos \\
  -d "{\\"name\\":\\"\$REPO_NAME\\",\\"description\\":\\"\$DESCRIPTION\\",\\"private\\":\$PRIVATE}"

# Add remote and push if in git repository
if [ -d ".git" ]; then
  git remote add origin git@github.com:${gitTokens.github.username}/\$REPO_NAME.git
  git push -u origin main
  echo "Repository created and pushed: https://github.com/${gitTokens.github.username}/\$REPO_NAME"
fi`;
      
      await fs.writeFile(`${tempDir}/create-github-repo.sh`, githubScript, { mode: 0o755 });
    }

    // Forgejo repository creation script
    if (gitTokens.forgejo) {
      const forgejoScript = `#!/bin/bash
# Forgejo Repository Creation Helper
REPO_NAME="\$1"
DESCRIPTION="\$2"
PRIVATE="\${3:-false}"

if [ -z "\$REPO_NAME" ]; then
  echo "Usage: create-forgejo-repo <name> [description] [private]"
  exit 1
fi

# Create repository via API
curl -X POST \\
  -H "Authorization: token ${gitTokens.forgejo.token}" \\
  -H "Content-Type: application/json" \\
  ${gitTokens.forgejo.url}/api/v1/user/repos \\
  -d "{\\"name\\":\\"\$REPO_NAME\\",\\"description\\":\\"\$DESCRIPTION\\",\\"private\\":\$PRIVATE}"

# Add remote and push if in git repository
if [ -d ".git" ]; then
  git remote add origin ${gitTokens.forgejo.url}/${gitTokens.forgejo.username}/\$REPO_NAME.git
  git push -u origin main
  echo "Repository created and pushed: ${gitTokens.forgejo.url}/${gitTokens.forgejo.username}/\$REPO_NAME"
fi`;
      
      await fs.writeFile(`${tempDir}/create-forgejo-repo.sh`, forgejoScript, { mode: 0o755 });
    }

    // Universal git helper
    const gitHelperScript = `#!/bin/bash
# Universal Git Repository Helper
echo "Available repository creation commands:"
echo "  create-github-repo <name> [description] [private]"
echo "  create-forgejo-repo <name> [description] [private]"
echo ""
echo "Git remotes:"
git remote -v 2>/dev/null || echo "Not in a git repository"`;
    
    await fs.writeFile(`${tempDir}/git-helper.sh`, gitHelperScript, { mode: 0o755 });
  }

  async copyCredentialsToContainer(container, tempDir, projectId) {
    // Create directories in container
    await container.exec({
      Cmd: ['mkdir', '-p', '/home/coder/.ssh', '/home/coder/bin'],
      User: 'coder'
    }).start();

    // Copy SSH keys
    if (await fs.access(`${tempDir}/id_ed25519`).then(() => true).catch(() => false)) {
      await container.putArchive(
        await this.createTarArchive({
          'id_ed25519': await fs.readFile(`${tempDir}/id_ed25519`),
          'id_ed25519.pub': await fs.readFile(`${tempDir}/id_ed25519.pub`)
        }),
        { path: '/home/coder/.ssh' }
      );
    }

    // Copy git config
    if (await fs.access(`${tempDir}/gitconfig`).then(() => true).catch(() => false)) {
      await container.putArchive(
        await this.createTarArchive({
          '.gitconfig': await fs.readFile(`${tempDir}/gitconfig`)
        }),
        { path: '/home/coder' }
      );
    }

    // Copy environment file
    if (await fs.access(`${tempDir}/env`).then(() => true).catch(() => false)) {
      await container.putArchive(
        await this.createTarArchive({
          '.env': await fs.readFile(`${tempDir}/env`)
        }),
        { path: '/workspace' }
      );
    }

    // Copy helper scripts
    const scriptFiles = await fs.readdir(tempDir);
    const scripts = {};
    for (const file of scriptFiles) {
      if (file.endsWith('.sh')) {
        scripts[file] = await fs.readFile(`${tempDir}/${file}`);
      }
    }
    
    if (Object.keys(scripts).length > 0) {
      await container.putArchive(
        await this.createTarArchive(scripts),
        { path: '/home/coder/bin' }
      );
    }

    // Fix permissions
    await container.exec({
      Cmd: ['chown', '-R', 'coder:coder', '/home/coder/.ssh', '/home/coder/bin'],
      User: 'root'
    }).start();

    await container.exec({
      Cmd: ['chmod', '600', '/home/coder/.ssh/id_ed25519'],
      User: 'coder'
    }).start();
  }
}
```

### Phase 4: Security Implementation (Week 4-5)

#### Encryption Service
```javascript
// crypto-service.js
const crypto = require('crypto');

class CryptoService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16;  // 128 bits
    this.tagLength = 16; // 128 bits
  }

  async deriveUserKey(userId, sessionToken) {
    // Derive encryption key from user session
    const salt = crypto.createHash('sha256').update(userId).digest();
    return crypto.pbkdf2Sync(sessionToken, salt, 100000, this.keyLength, 'sha256');
  }

  async encrypt(data, userKey) {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipher(this.algorithm, userKey, { iv });
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  }

  async decrypt(encryptedData, userKey) {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');
    const decipher = crypto.createDecipher(this.algorithm, userKey, { iv });
    
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  async generateSSHKeyPair() {
    return new Promise((resolve, reject) => {
      crypto.generateKeyPair('ed25519', {
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      }, (err, publicKey, privateKey) => {
        if (err) reject(err);
        else resolve({ publicKey, privateKey });
      });
    });
  }

  convertToSSHFormat(publicKeyPem, comment = 'user@xaresaicoder') {
    // Convert PEM to OpenSSH format
    const key = crypto.createPublicKey(publicKeyPem);
    const sshKey = key.export({ type: 'spki', format: 'der' });
    const base64Key = sshKey.toString('base64');
    return `ssh-ed25519 ${base64Key} ${comment}`;
  }
}

module.exports = CryptoService;
```

#### Audit Logging
```javascript
// audit-service.js
class AuditService {
  constructor() {
    this.db = require('./database');
  }

  async logCredentialAccess(userId, credentialId, action, context = {}) {
    await this.db.query(`
      INSERT INTO credential_audit 
      (user_id, credential_id, action, workspace_id, ip_address, user_agent, context)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      userId,
      credentialId,
      action,
      context.workspaceId || null,
      context.ipAddress || null,
      context.userAgent || null,
      JSON.stringify(context)
    ]);
  }

  async getAuditLog(userId, limit = 100) {
    const result = await this.db.query(`
      SELECT ca.*, c.credential_type, c.provider, c.name
      FROM credential_audit ca
      LEFT JOIN credentials c ON ca.credential_id = c.id
      WHERE ca.user_id = $1
      ORDER BY ca.timestamp DESC
      LIMIT $2
    `, [userId, limit]);
    
    return result.rows;
  }

  async detectSuspiciousActivity(userId) {
    // Check for unusual access patterns
    const recentAccess = await this.db.query(`
      SELECT action, ip_address, COUNT(*) as count
      FROM credential_audit
      WHERE user_id = $1 AND timestamp > NOW() - INTERVAL '1 hour'
      GROUP BY action, ip_address
      HAVING COUNT(*) > 50
    `, [userId]);

    return recentAccess.rows.length > 0;
  }
}
```

### Phase 5: Helper Scripts and AI Integration (Week 5-6)

#### AI Tool Configuration
```bash
# Container startup script enhancements
# /usr/local/bin/entrypoint.sh

#!/bin/bash
echo "Starting XaresAICoder code-server..."

# Source environment variables for AI tools
if [ -f "/workspace/.env" ]; then
    source /workspace/.env
fi

# Configure Aider
if [ -n "$OPENAI_API_KEY" ]; then
    echo "Configuring Aider with OpenAI..."
    mkdir -p /home/coder/.config/aider
    cat > /home/coder/.config/aider/config.yml << EOF
# Aider Configuration for XaresAICoder
model: gpt-4
auto-commits: false
dark-mode: true
stream: true
EOF
fi

# Configure OpenCode SST
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Configuring OpenCode SST with Anthropic..."
    mkdir -p /home/coder/.config/opencode
    cat > /home/coder/.config/opencode/config.json << EOF
{
  "api_key": "$ANTHROPIC_API_KEY",
  "model": "claude-3-sonnet-20240229",
  "max_tokens": 4096
}
EOF
fi

# Configure Continue extension
if [ -n "$OPENAI_API_KEY" ] || [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Configuring Continue extension..."
    mkdir -p /home/coder/.continue
    cat > /home/coder/.continue/config.json << EOF
{
  "models": [
$([ -n "$OPENAI_API_KEY" ] && echo '    {
      "title": "GPT-4",
      "provider": "openai",
      "model": "gpt-4",
      "apiKey": "'$OPENAI_API_KEY'"
    },' || echo '')
$([ -n "$ANTHROPIC_API_KEY" ] && echo '    {
      "title": "Claude 3 Sonnet",
      "provider": "anthropic",
      "model": "claude-3-sonnet-20240229",
      "apiKey": "'$ANTHROPIC_API_KEY'"
    }' || echo '')
  ],
  "customCommands": [
    {
      "name": "commit",
      "prompt": "Write a conventional commit message for these changes",
      "description": "Generate commit message"
    }
  ]
}
EOF
fi

# Add helper scripts to PATH
export PATH="/home/coder/bin:$PATH"

# Display available tools
echo ""
echo "🚀 XaresAICoder Workspace Ready!"
echo ""
echo "📁 Available Git Helpers:"
[ -f "/home/coder/bin/create-github-repo.sh" ] && echo "  • create-github-repo <name> [description] [private]"
[ -f "/home/coder/bin/create-forgejo-repo.sh" ] && echo "  • create-forgejo-repo <name> [description] [private]"
echo "  • git-helper (show all commands)"
echo ""
echo "🤖 AI Tools:"
[ -n "$OPENAI_API_KEY" ] && echo "  • Aider: aider --help"
[ -n "$OPENAI_API_KEY" ] && echo "  • Continue: Available in VS Code"
[ -n "$ANTHROPIC_API_KEY" ] && echo "  • Cline: Available in VS Code"
[ -n "$ANTHROPIC_API_KEY" ] && echo "  • OpenCode SST: opencode [prompt]"
[ -n "$GOOGLE_API_KEY" ] && echo "  • Gemini CLI: gemini [prompt]"
echo ""

# Check and install missing extensions
/usr/local/bin/check-extensions.sh

# Start code-server with the provided arguments
exec "$@"
```

#### Enhanced Helper Scripts
```bash
# create-repo-universal.sh
#!/bin/bash
# Universal Repository Creation Tool

show_help() {
    echo "Universal Repository Creator for XaresAICoder"
    echo ""
    echo "Usage: create-repo [OPTIONS] <name>"
    echo ""
    echo "Options:"
    echo "  -p, --provider PROVIDER    Git provider (github, forgejo)"
    echo "  -d, --description DESC     Repository description"
    echo "  --private                  Create private repository"
    echo "  --public                   Create public repository (default)"
    echo "  -h, --help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  create-repo my-awesome-app"
    echo "  create-repo -p github --private my-secret-project"
    echo "  create-repo -p forgejo -d \"Company project\" work-app"
    echo ""
}

# Parse arguments
PROVIDER=""
REPO_NAME=""
DESCRIPTION=""
PRIVATE="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--provider)
            PROVIDER="$2"
            shift 2
            ;;
        -d|--description)
            DESCRIPTION="$2"
            shift 2
            ;;
        --private)
            PRIVATE="true"
            shift
            ;;
        --public)
            PRIVATE="false"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            echo "Unknown option $1"
            exit 1
            ;;
        *)
            REPO_NAME="$1"
            shift
            ;;
    esac
done

# Validate inputs
if [ -z "$REPO_NAME" ]; then
    echo "Error: Repository name is required"
    show_help
    exit 1
fi

# Auto-detect provider if not specified
if [ -z "$PROVIDER" ]; then
    if [ -f "/home/coder/bin/create-github-repo.sh" ]; then
        PROVIDER="github"
    elif [ -f "/home/coder/bin/create-forgejo-repo.sh" ]; then
        PROVIDER="forgejo"
    else
        echo "Error: No git providers configured"
        exit 1
    fi
fi

# Execute provider-specific script
case $PROVIDER in
    github)
        if [ -f "/home/coder/bin/create-github-repo.sh" ]; then
            /home/coder/bin/create-github-repo.sh "$REPO_NAME" "$DESCRIPTION" "$PRIVATE"
        else
            echo "Error: GitHub not configured"
            exit 1
        fi
        ;;
    forgejo)
        if [ -f "/home/coder/bin/create-forgejo-repo.sh" ]; then
            /home/coder/bin/create-forgejo-repo.sh "$REPO_NAME" "$DESCRIPTION" "$PRIVATE"
        else
            echo "Error: Forgejo not configured"
            exit 1
        fi
        ;;
    *)
        echo "Error: Unknown provider '$PROVIDER'"
        echo "Supported providers: github, forgejo"
        exit 1
        ;;
esac
```

### Phase 6: Testing and Documentation (Week 6-7)

#### Integration Tests
```javascript
// tests/credential-integration.test.js
const request = require('supertest');
const app = require('../src/index');
const CryptoService = require('../src/services/crypto-service');

describe('Credential Management Integration', () => {
  let authToken;
  let userId = 'test-user';

  beforeEach(async () => {
    // Setup test user session
    authToken = 'test-session-token';
  });

  describe('SSH Key Management', () => {
    test('should generate SSH key pair', async () => {
      const response = await request(app)
        .post('/api/credentials/ssh-keys')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'ed25519', name: 'default' });

      expect(response.status).toBe(201);
      expect(response.body.publicKey).toMatch(/^ssh-ed25519/);
    });

    test('should retrieve SSH public key', async () => {
      const response = await request(app)
        .get('/api/credentials/ssh-keys/default')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.publicKey).toBeDefined();
    });
  });

  describe('Token Management', () => {
    test('should store GitHub token', async () => {
      const response = await request(app)
        .post('/api/credentials/tokens')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          provider: 'github',
          token: 'ghp_test_token',
          username: 'testuser'
        });

      expect(response.status).toBe(201);
    });

    test('should test GitHub token validity', async () => {
      const response = await request(app)
        .post('/api/credentials/test/github')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBeDefined();
    });
  });

  describe('Workspace Injection', () => {
    test('should inject credentials into workspace', async () => {
      const workspaceId = 'test-workspace-123';
      
      const response = await request(app)
        .post(`/api/credentials/inject/${workspaceId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.injected).toBe(true);
    });
  });
});
```

#### Security Tests
```javascript
// tests/security.test.js
describe('Credential Security', () => {
  test('should encrypt credentials at rest', async () => {
    const cryptoService = new CryptoService();
    const userKey = await cryptoService.deriveUserKey('user123', 'session-token');
    
    const testData = { token: 'secret-token-123' };
    const encrypted = await cryptoService.encrypt(testData, userKey);
    
    expect(encrypted.encrypted).not.toContain('secret-token-123');
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    
    const decrypted = await cryptoService.decrypt(encrypted, userKey);
    expect(decrypted.token).toBe('secret-token-123');
  });

  test('should isolate user credentials', async () => {
    // Test that user A cannot access user B's credentials
    const userAToken = 'user-a-session';
    const userBToken = 'user-b-session';
    
    // Create credential for user A
    await request(app)
      .post('/api/credentials/tokens')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ provider: 'github', token: 'user-a-token' });
    
    // Try to access as user B
    const response = await request(app)
      .get('/api/credentials/tokens')
      .set('Authorization', `Bearer ${userBToken}`);
    
    expect(response.body.tokens).not.toContainEqual(
      expect.objectContaining({ provider: 'github' })
    );
  });
});
```

## Security Considerations

### Encryption Strategy
- **AES-256-GCM**: Authenticated encryption for credentials
- **PBKDF2**: Key derivation from user sessions
- **Unique IVs**: Fresh initialization vector per encryption
- **Auth Tags**: Prevent tampering with encrypted data

### Access Control
- **User Isolation**: Credentials strictly separated by user ID
- **Session Validation**: All requests validated against active sessions
- **Workspace Binding**: Credentials only injected into user's workspaces
- **Time-based Expiry**: Automatic cleanup of expired credentials

### Audit and Monitoring
- **Comprehensive Logging**: All credential operations logged
- **Anomaly Detection**: Unusual access patterns flagged
- **IP Tracking**: Source IP logged for all operations
- **Usage Analytics**: Monitor credential usage patterns

### Data Protection
- **No Plain Text**: Credentials never stored unencrypted
- **Secure Transport**: HTTPS with additional application-layer encryption
- **Memory Protection**: Sensitive data cleared from memory after use
- **Backup Encryption**: Database backups encrypted

## Future Enhancements

### Phase 7: Advanced Features
- **Team Sharing**: Share credentials with team members
- **Credential Templates**: Pre-configured credential sets for teams
- **Integration APIs**: Allow external tools to manage credentials
- **Mobile App**: Mobile credential management app

### Phase 8: Enterprise Features
- **LDAP Integration**: Import user credentials from LDAP
- **SSO Support**: Single sign-on integration
- **Compliance Reports**: Generate compliance reports for audits
- **Backup/Restore**: Credential backup and restoration system

### Phase 9: Automation
- **Auto-Discovery**: Automatically detect and configure Git providers
- **Smart Suggestions**: Suggest missing credentials based on usage
- **Workflow Integration**: Deep integration with CI/CD pipelines
- **API Gateway**: Centralized API key management for all services

## Deployment Guide

### Database Setup
```sql
-- Run these migrations for credential management
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create credentials table (see Phase 1 for full schema)
-- Create audit table (see Phase 1 for full schema)

-- Create indexes for performance
CREATE INDEX idx_credentials_user_type ON credentials(user_id, credential_type);
CREATE INDEX idx_audit_user_timestamp ON credential_audit(user_id, timestamp);
```

### Environment Configuration
```env
# Add to .env file
CREDENTIAL_ENCRYPTION_KEY=your-32-byte-hex-key
CREDENTIAL_SESSION_TIMEOUT=7200
CREDENTIAL_AUDIT_RETENTION_DAYS=90
```

### Docker Volume Setup
```yaml
# Add to docker-compose.yml
volumes:
  credential_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /secure/credential-storage
```

## Conclusion

This credential management system transforms XaresAICoder from a development tool into an enterprise-ready platform. Key benefits:

1. **Security**: Enterprise-grade encryption and audit logging
2. **Productivity**: One-time setup, automatic distribution to all workspaces
3. **Compliance**: Full audit trails and access controls
4. **Scalability**: Supports unlimited users and credential types
5. **Integration**: Seamless integration with existing workflows

The system is designed to be incrementally deployable, with each phase building on the previous one. This allows for gradual rollout and testing while maintaining backward compatibility with existing XaresAICoder installations.