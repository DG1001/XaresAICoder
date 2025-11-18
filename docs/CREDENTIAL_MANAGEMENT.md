# XaresAICoder Credential Management System

## Overview

Enterprise-grade credential management system for XaresAICoder that provides centralized, secure storage and distribution of access tokens and API credentials across all user workspaces. **Emphasizes HTTP-based authentication with access tokens over SSH key management for simplicity and ease of use.**

## Problem Statement

### Current Issues
- **Token Duplication**: API keys entered manually in every workspace
- **Security Risk**: Credentials stored in plain text in containers
- **No Centralization**: Each user manages credentials independently
- **Poor UX**: Repetitive authentication setup for each workspace
- **Complex SSH Management**: Public key management adds unnecessary complexity

### Enterprise Requirements
- **Access Token Management**: Central storage for GitHub, Forgejo, GitLab access tokens
- **HTTP Auth Simplicity**: Use tokens + username for HTTP authentication (easier than SSH keys)
- **AI Integration**: Secure API key distribution for LLM providers
- **Audit Trail**: Track credential usage and access
- **Encryption**: All credentials encrypted at rest and in transit
- **UI-Based Storage**: User-friendly interface for managing access tokens

## Architecture Overview

```
┌─ Frontend (React) ────────────────────┐
│  ┌─ Credentials Tab ─────────────────┐ │
│  │ • Git Access Tokens             │ │
│  │ • Repository Management         │ │
│  │ • AI Provider API Keys          │ │
│  │ • HTTP Auth Configuration       │ │
│  │ • Security Settings             │ │
│  └─────────────────────────────────────┘ │
└───────────────────────────────────────────┘
               │ HTTPS/WSS
               ▼
┌─ Backend API (Node.js/Express) ───────┐
│  ┌─ Credential Service ──────────────┐ │
│  │ • Encrypted Token Storage        │ │
│  │ • User Isolation                 │ │
│  │ • Token Validation               │ │
│  │ • OAuth Integration (future)     │ │
│  │ • Audit Logging                  │ │
│  └─────────────────────────────────────┘ │
│  ┌─ Workspace Injection ────────────┐ │
│  │ • Git Credential Helper Setup    │ │
│  │ • HTTP Auth Configuration        │ │
│  │ • Environment Variables          │ │
│  │ • Repository Helper Scripts      │ │
│  └─────────────────────────────────────┘ │
└───────────────────────────────────────────┘
               │ Docker API
               ▼
┌─ Workspace Containers ────────────────┐
│  ~/.git-credentials  (HTTP Auth)      │
│  ~/.gitconfig        (Git Config)     │
│  ~/.env             (API Keys)        │
│  ~/bin/git-helpers/*                  │
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
-- credentials table (prioritizes access tokens over SSH keys)
CREATE TABLE credentials (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  credential_type ENUM('git_access_token', 'ai_token', 'ssh_key') NOT NULL,
  provider VARCHAR(100), -- github, forgejo, gitlab, openai, etc.
  provider_url VARCHAR(500), -- for self-hosted Git servers
  username VARCHAR(255), -- Git username for HTTP auth
  name VARCHAR(255) NOT NULL,
  encrypted_data TEXT NOT NULL,
  iv VARCHAR(255) NOT NULL, -- AES initialization vector
  permissions TEXT, -- JSON array of token permissions
  expires_at TIMESTAMP, -- token expiration (if applicable)
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
// Git Access Token Management (Primary approach)
POST   /api/credentials/git-tokens           // Create Git access token
GET    /api/credentials/git-tokens           // List user's Git tokens
PUT    /api/credentials/git-tokens/:id       // Update Git token
DELETE /api/credentials/git-tokens/:id       // Delete Git token

// AI Token Management
POST   /api/credentials/ai-tokens            // Store AI provider tokens
GET    /api/credentials/ai-tokens            // List AI tokens
PUT    /api/credentials/ai-tokens/:id        // Update AI token
DELETE /api/credentials/ai-tokens/:id        // Delete AI token

// Credential Testing & Validation
POST   /api/credentials/test/github          // Test GitHub token
POST   /api/credentials/test/forgejo         // Test Forgejo token
POST   /api/credentials/test/gitlab          // Test GitLab token
POST   /api/credentials/test/openai          // Test OpenAI key

// Repository Management (using access tokens)
POST   /api/repositories/create              // Create repo using stored tokens
GET    /api/repositories                     // List accessible repositories
POST   /api/repositories/clone               // Clone repo to workspace

// Workspace Injection
GET    /api/credentials/workspace/:workspaceId
POST   /api/credentials/inject/:workspaceId

// Future: OAuth Integration
POST   /api/credentials/oauth/github/start   // Start GitHub OAuth flow
GET    /api/credentials/oauth/github/callback // Handle OAuth callback
```

## Access Token Authentication Strategy

### Why Access Tokens Over SSH Keys?

#### ✅ **Advantages of Access Tokens**
- **🚀 **Simplicity**: No key pair generation or public key management
- **🔐 **Granular Permissions**: Scope tokens to specific repositories and operations
- **⏰ **Expiration Control**: Built-in token expiration for enhanced security
- **🔄 **Easy Rotation**: Simple token regeneration without Git configuration changes
- **🌐 **Universal Support**: Works with all Git providers (GitHub, GitLab, Forgejo)
- **📱 **User-Friendly**: Familiar token-based approach like API keys
- **🛠️ **HTTP/HTTPS**: Uses standard web protocols (no SSH complexity)

#### ❌ **SSH Key Drawbacks**
- **Complex Setup**: Key generation, public key registration, SSH agent management
- **Binary Permissions**: All-or-nothing access (no granular control)
- **No Expiration**: Keys remain valid indefinitely unless manually revoked
- **Provider Lock-in**: Different key formats and configurations per provider
- **Poor UX**: Technical complexity barriers for non-technical users

### Implementation Approach

#### Primary: HTTP Authentication with Access Tokens
```bash
# Git operations use HTTPS with embedded credentials
git clone https://username:token@github.com/user/repo.git
git remote add origin https://username:token@git.company.com/user/repo.git

# Credentials stored securely in Git credential helper
git config credential.helper 'store --file=~/.git-credentials'
```

#### Secondary: SSH Keys (Optional)
```bash
# Available for users who prefer SSH (not the default)
git clone git@github.com:user/repo.git
```

### Token Creation Guide

#### GitHub Access Token
1. **Permissions Required**: `repo`, `user`, `delete_repo` (for Forgejo creation support)
2. **Scope**: Fine-grained or classic personal access token
3. **Storage**: Encrypted in XaresAICoder credential store
4. **Usage**: HTTP authentication for all Git operations

#### Forgejo Access Token  
1. **Permissions Required**: `write:repository`, `write:user`, `write:issue`
2. **Creation Support**: Forgejo supports repo creation via push (no API needed)
3. **Self-Hosted**: Full URL configuration (https://git.company.com)
4. **Integration**: Direct integration with XaresAICoder workspaces

### Future Enhancement: OAuth Integration

#### Automatic Token Retrieval (Phase 3+)
```javascript
// OAuth flow for automatic token management
const oauthFlow = {
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    scopes: ['repo', 'user', 'delete_repo'],
    clientId: process.env.GITHUB_CLIENT_ID
  },
  gitlab: {
    authUrl: 'https://gitlab.com/oauth/authorize', 
    scopes: ['api', 'read_user', 'write_repository'],
    clientId: process.env.GITLAB_CLIENT_ID
  }
};

// User clicks "Connect GitHub" -> OAuth flow -> Token stored automatically
```

This eliminates manual token entry while maintaining the HTTP authentication approach.

### Phase 2: Frontend Interface (Week 2-3)

#### Credentials Tab Design
```html
<!-- Main Credentials Tab (Access Token Focus) -->
<div class="credentials-container">
  <!-- Quick Setup Banner -->
  <div class="setup-banner">
    <div class="banner-content">
      <h3>🚀 Quick Setup: Git Access Tokens</h3>
      <p>Manage your Git repositories with secure access tokens. No SSH key complexity required!</p>
      <div class="setup-actions">
        <button class="btn-primary" onclick="addGitToken('github')">+ Add GitHub Token</button>
        <button class="btn-primary" onclick="addGitToken('forgejo')">+ Add Forgejo Token</button>
        <button class="btn-secondary" onclick="showSetupGuide()">📖 Setup Guide</button>
      </div>
    </div>
  </div>

  <!-- Git Access Tokens Section (Primary) -->
  <div class="credential-section">
    <h3>🔑 Git Access Tokens</h3>
    <div class="section-description">
      <p>Store your Git provider access tokens for seamless repository access. These tokens enable repository creation, cloning, and push/pull operations via HTTPS.</p>
    </div>
    
    <div class="token-list">
      <!-- GitHub Token -->
      <div class="token-item">
        <div class="token-header">
          <img src="/icons/github.svg" alt="GitHub" class="provider-icon">
          <div class="token-title">
            <h4>GitHub Personal Access Token</h4>
            <span class="token-status" id="github-status">Not configured</span>
          </div>
          <div class="token-actions-header">
            <button class="btn-link" onclick="showTokenHelp('github')">❓ How to create</button>
          </div>
        </div>
        
        <div class="token-form">
          <div class="form-row">
            <div class="form-group">
              <label for="github-username">GitHub Username</label>
              <input type="text" id="github-username" placeholder="your-username" required>
            </div>
            <div class="form-group">
              <label for="github-token">Access Token</label>
              <input type="password" id="github-token" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" required>
              <small class="form-hint">Required permissions: repo, user, delete_repo</small>
            </div>
          </div>
          
          <div class="token-actions">
            <button class="btn-success" onclick="testGitToken('github')">🧪 Test Connection</button>
            <button class="btn-primary" onclick="saveGitToken('github')">💾 Save Token</button>
            <button class="btn-secondary" onclick="clearGitToken('github')">🗑️ Remove</button>
          </div>
          
          <div class="token-capabilities" id="github-capabilities" style="display: none;">
            <h5>Available Operations:</h5>
            <ul class="capability-list">
              <li>✅ Clone repositories via HTTPS</li>
              <li>✅ Create new repositories</li>
              <li>✅ Push/pull to existing repositories</li>
              <li>✅ Access private repositories</li>
            </ul>
          </div>
        </div>
      </div>
      
      <!-- Forgejo Token -->
      <div class="token-item">
        <div class="token-header">
          <img src="/icons/forgejo.svg" alt="Forgejo" class="provider-icon">
          <div class="token-title">
            <h4>Forgejo Access Token</h4>
            <span class="token-status" id="forgejo-status">Not configured</span>
          </div>
          <div class="token-actions-header">
            <button class="btn-link" onclick="showTokenHelp('forgejo')">❓ How to create</button>
          </div>
        </div>
        
        <div class="token-form">
          <div class="form-row">
            <div class="form-group">
              <label for="forgejo-url">Forgejo Server URL</label>
              <input type="url" id="forgejo-url" placeholder="https://git.company.com" required>
            </div>
            <div class="form-group">
              <label for="forgejo-username">Username</label>
              <input type="text" id="forgejo-username" placeholder="your-username" required>
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group full-width">
              <label for="forgejo-token">Access Token</label>
              <input type="password" id="forgejo-token" placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" required>
              <small class="form-hint">Required permissions: write:repository, write:user, write:issue</small>
            </div>
          </div>
          
          <div class="token-actions">
            <button class="btn-success" onclick="testGitToken('forgejo')">🧪 Test Connection</button>
            <button class="btn-primary" onclick="saveGitToken('forgejo')">💾 Save Token</button>
            <button class="btn-secondary" onclick="clearGitToken('forgejo')">🗑️ Remove</button>
          </div>
          
          <div class="token-capabilities" id="forgejo-capabilities" style="display: none;">
            <h5>Available Operations:</h5>
            <ul class="capability-list">
              <li>✅ Clone repositories via HTTPS</li>
              <li>✅ Push-to-create repositories (no API needed!)</li>
              <li>✅ Push/pull to existing repositories</li>
              <li>✅ Access private repositories</li>
              <li>✅ Integrated CI/CD with Forgejo Actions</li>
            </ul>
          </div>
        </div>
      </div>
      
      <!-- Add More Providers -->
      <div class="add-provider-section">
        <button class="btn-outline add-provider-btn" onclick="showAddProviderModal()">
          ➕ Add Another Git Provider
        </button>
        <small>Support for GitLab, Bitbucket, and custom Git servers</small>
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

## Integrated Git Server Extension

### Overview: Complete On-Premise Git Solution

Building on the credential management system, XaresAICoder can be extended with an integrated Git server (Gitea or Forgejo) to create a **completely self-contained development platform**. This eliminates dependencies on external Git providers and enables advanced features like CI/CD pipelines directly within the platform.

## Gitea vs Forgejo: Comprehensive Comparison

### Technical Overview

Both Gitea and Forgejo are lightweight, self-hosted Git services written in Go. Forgejo is a **hard fork** of Gitea that emerged in late 2022 due to governance concerns about Gitea's direction.

#### Gitea
```yaml
# Strengths
- Mature and stable (since 2016)
- Large community and ecosystem
- Well-documented APIs
- Proven enterprise deployments
- Regular security updates

# Weaknesses  
- Limited CI/CD capabilities
- Governance concerns in community
- Less GitHub Actions compatibility
```

#### Forgejo
```yaml
# Strengths
- Community-driven governance
- Forgejo Actions (GitHub Actions compatible)
- Enhanced privacy features
- Active development on CI/CD
- Better federation support planned

# Weaknesses
- Newer project (less mature)
- Smaller ecosystem
- Breaking changes possible
```

### Feature Comparison Matrix

| Feature | Gitea | Forgejo | Recommendation |
|---------|-------|---------|---------------|
| **Stability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Gitea (more mature) |
| **CI/CD Pipelines** | ⭐⭐ | ⭐⭐⭐⭐⭐ | **Forgejo** (Actions) |
| **GitHub Actions Compat** | ❌ | ✅ | **Forgejo** |
| **API Completeness** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Gitea |
| **Docker Integration** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Tie |
| **Security Features** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Forgejo |
| **Community Support** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Gitea |
| **Future Development** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **Forgejo** |

### **Recommendation: Forgejo**

For XaresAICoder integration, **Forgejo is the clear winner** due to:

1. **🚀 Forgejo Actions**: GitHub Actions compatible CI/CD
2. **🔒 Enhanced Privacy**: Better data protection features  
3. **🎯 Active CI/CD Development**: Focused on automation features
4. **🌟 Community Governance**: Transparent, developer-friendly governance
5. **📈 Forward Compatibility**: Better alignment with modern DevOps needs

## Architecture: XaresAICoder + Forgejo Integration

```
┌─ XaresAICoder Platform ─────────────────────────────────┐
│                                                         │
│  ┌─ Frontend ──────────┐  ┌─ Forgejo Web UI ─────────┐  │
│  │ • Project Mgmt     │  │ • Repository Browser     │  │
│  │ • Credentials      │  │ • Issue Tracking         │  │
│  │ • Workspace Mgmt   │  │ • Pull Requests          │  │
│  └────────────────────────┘  │ • CI/CD Pipelines       │  │
│                              └─────────────────────────┘  │
│  ┌─ Backend API ──────────────────────────────────────┐  │
│  │ • Credential Service                              │  │
│  │ • Workspace Management                            │  │
│  │ • Forgejo Integration API                         │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Container Layer ──────────────────────────────────┐  │
│  │ nginx │ workspace │ workspace │ forgejo │ runners │  │
│  │       │     1     │     2     │         │         │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Forgejo Integration

#### Docker Compose Configuration
```yaml
# Enhanced docker-compose.yml
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:1.21
    container_name: xaresaicoder-forgejo
    environment:
      - USER_UID=1000
      - USER_GID=1000
      - FORGEJO__database__DB_TYPE=sqlite3
      - FORGEJO__server__DOMAIN=git.${BASE_DOMAIN}
      - FORGEJO__server__HTTP_PORT=3000
      - FORGEJO__server__ROOT_URL=${PROTOCOL}://git.${BASE_DOMAIN}:${BASE_PORT}/
      - FORGEJO__repository__ENABLE_PUSH_CREATE_USER=true
      - FORGEJO__repository__ENABLE_PUSH_CREATE_ORG=true
      - FORGEJO__repository__DEFAULT_PUSH_CREATE_PRIVATE=false
      - FORGEJO__actions__ENABLED=true
      - FORGEJO__actions__DEFAULT_ACTIONS_URL=https://code.forgejo.org
      # Security settings
      - FORGEJO__security__INSTALL_LOCK=true
      - FORGEJO__security__SECRET_KEY=${FORGEJO_SECRET_KEY}
      # Integration settings
      - FORGEJO__webhook__ALLOWED_HOST_LIST=*
      - FORGEJO__api__ENABLE_SWAGGER=true
    restart: unless-stopped
    networks:
      - xares-aicoder-network
    volumes:
      - forgejo_data:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    ports:
      - "2222:22"  # SSH for Git operations
    depends_on:
      - nginx

  # Forgejo Actions Runner
  forgejo-runner:
    image: code.gitea.io/actions/act_runner:latest
    container_name: xaresaicoder-forgejo-runner
    environment:
      - GITEA_INSTANCE_URL=${PROTOCOL}://git.${BASE_DOMAIN}:${BASE_PORT}/
      - GITEA_RUNNER_REGISTRATION_TOKEN=${FORGEJO_RUNNER_TOKEN}
      - GITEA_RUNNER_NAME=xaresaicoder-runner-1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - forgejo_runner_data:/data
    restart: unless-stopped
    networks:
      - xares-aicoder-network
    depends_on:
      - forgejo

volumes:
  forgejo_data:
  forgejo_runner_data:
```

#### Environment Configuration
```env
# .env additions for Forgejo
FORGEJO_SECRET_KEY=generate-a-64-char-hex-key
FORGEJO_ADMIN_USER=admin
FORGEJO_ADMIN_PASSWORD=secure-admin-password
FORGEJO_ADMIN_EMAIL=admin@your-domain.com
FORGEJO_RUNNER_TOKEN=generate-runner-registration-token
```

### Phase 2: Nginx Routing Integration

#### Enhanced nginx.conf.template
```nginx
# Forgejo Git Server
location /git/ {
    proxy_pass http://forgejo:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host:$server_port;
    
    # Support for Git LFS
    client_max_body_size 512M;
}

# Git API endpoints
location /api/v1/ {
    proxy_pass http://forgejo:3000/api/v1/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Git raw content
location ~ ^/git/([^/]+)/([^/]+)/raw/(.+)$ {
    proxy_pass http://forgejo:3000/$1/$2/raw/$3;
    proxy_set_header Host $host;
}
```

### Phase 3: Credential Service Integration

#### Enhanced Credential Service
```javascript
// Enhanced credential-service.js
class CredentialService {
  // ... existing methods ...

  async initializeForgejoIntegration(userId) {
    try {
      // 1. Create user in Forgejo if not exists
      await this.createForgejoUser(userId);
      
      // 2. Register SSH key with Forgejo
      const sshKey = await this.getSSHKey(userId);
      if (sshKey) {
        await this.registerSSHKeyWithForgejo(userId, sshKey.publicKey);
      }
      
      // 3. Generate Forgejo access token for API operations
      const accessToken = await this.generateForgejoAccessToken(userId);
      await this.storeCredential(userId, 'git_token', 'forgejo', {
        token: accessToken,
        url: `${process.env.PROTOCOL}://git.${process.env.BASE_DOMAIN}:${process.env.BASE_PORT}`,
        username: userId
      });
      
      return true;
    } catch (error) {
      console.error('Forgejo integration failed:', error);
      return false;
    }
  }

  async createForgejoUser(userId) {
    const forgejoApiUrl = `http://forgejo:3000/api/v1`;
    const response = await fetch(`${forgejoApiUrl}/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.FORGEJO_ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: userId,
        email: `${userId}@xaresaicoder.local`,
        password: this.generateSecurePassword(),
        must_change_password: false,
        send_notify: false,
        visibility: 'public'
      })
    });
    
    if (!response.ok && response.status !== 422) { // 422 = user already exists
      throw new Error(`Failed to create Forgejo user: ${response.statusText}`);
    }
    
    return response.status === 201;
  }

  async registerSSHKeyWithForgejo(userId, publicKey) {
    const forgejoApiUrl = `http://forgejo:3000/api/v1`;
    const response = await fetch(`${forgejoApiUrl}/admin/users/${userId}/keys`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.FORGEJO_ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: `XaresAICoder-${userId}-${Date.now()}`,
        key: publicKey,
        read_only: false
      })
    });
    
    return response.ok;
  }

  async generateForgejoAccessToken(userId) {
    const forgejoApiUrl = `http://forgejo:3000/api/v1`;
    const response = await fetch(`${forgejoApiUrl}/users/${userId}/tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.FORGEJO_ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `xaresaicoder-integration-${Date.now()}`,
        scopes: ['write:repository', 'write:user', 'write:issue']
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to generate Forgejo token: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.sha1;
  }
}
```

### Phase 4: Workspace Integration

#### Enhanced Helper Scripts
```bash
#!/bin/bash
# create-repo.sh - Universal repository creation
REPO_NAME="$1"
DESCRIPTION="$2"
PRIVATE="${3:-false}"
PROVIDER="${4:-forgejo}" # Default to local Forgejo

if [ -z "$REPO_NAME" ]; then
    echo "Usage: create-repo <name> [description] [private] [provider]"
    echo "Providers: forgejo (default), github"
    exit 1
fi

case $PROVIDER in
    forgejo)
        create_forgejo_repo "$REPO_NAME" "$DESCRIPTION" "$PRIVATE"
        ;;
    github)
        create_github_repo "$REPO_NAME" "$DESCRIPTION" "$PRIVATE"
        ;;
    *)
        echo "Unknown provider: $PROVIDER"
        exit 1
        ;;
esac

create_forgejo_repo() {
    local name="$1"
    local desc="$2"
    local private="$3"
    
    # Get Git user from config
    local git_user=$(git config user.name || echo "developer")
    local git_domain="git.${BASE_DOMAIN:-localhost}"
    local git_port="${BASE_PORT:-80}"
    
    # Construct URLs
    local ssh_url="git@${git_domain}:${git_user}/${name}.git"
    local web_url="${PROTOCOL:-http}://${git_domain}:${git_port}/git/${git_user}/${name}"
    
    # Forgejo supports push-to-create, so just add remote and push
    if [ -d ".git" ]; then
        echo "Adding Forgejo remote..."
        git remote add origin "$ssh_url" 2>/dev/null || git remote set-url origin "$ssh_url"
        
        echo "Pushing to create repository..."
        git push -u origin main
        
        if [ $? -eq 0 ]; then
            echo "✅ Repository created successfully!"
            echo "🌐 Web: $web_url"
            echo "📁 SSH: $ssh_url"
            
            # Set description if provided (requires API call)
            if [ -n "$desc" ] && [ -n "$FORGEJO_TOKEN" ]; then
                set_repo_description "$git_user" "$name" "$desc"
            fi
        else
            echo "❌ Failed to create repository"
            exit 1
        fi
    else
        echo "❌ Not in a Git repository. Run 'git init' first."
        exit 1
    fi
}

set_repo_description() {
    local owner="$1"
    local repo="$2"
    local description="$3"
    
    if [ -n "$FORGEJO_TOKEN" ]; then
        curl -X PATCH \
            -H "Authorization: token $FORGEJO_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"description\":\"$description\"}" \
            "${PROTOCOL}://git.${BASE_DOMAIN}:${BASE_PORT}/api/v1/repos/${owner}/${repo}"
    fi
}

# Auto-detect environment and call appropriate function
create_forgejo_repo "$REPO_NAME" "$DESCRIPTION" "$PRIVATE"
```

#### Enhanced Workspace Injection
```javascript
// Enhanced workspace credential injection
async generateHelperScripts(tempDir, gitTokens) {
  // ... existing scripts ...

  // Forgejo repository creation script
  if (gitTokens.forgejo) {
    const forgejoScript = `#!/bin/bash
# Forgejo Repository Creation Helper (with CI/CD support)
REPO_NAME="\$1"
DESCRIPTION="\$2"
PRIVATE="\${3:-false}"

if [ -z "\$REPO_NAME" ]; then
  echo "Usage: create-forgejo-repo <name> [description] [private]"
  exit 1
fi

# Environment variables from credential injection
export FORGEJO_TOKEN="${gitTokens.forgejo.token}"
export BASE_DOMAIN="${process.env.BASE_DOMAIN}"
export BASE_PORT="${process.env.BASE_PORT}"
export PROTOCOL="${process.env.PROTOCOL}"

# Get Git user configuration
GIT_USER=\$(git config user.name || echo "developer")

# Push-to-create workflow (Forgejo feature)
echo "Creating repository via push-to-create..."
git remote add origin git@git.\${BASE_DOMAIN}:\${GIT_USER}/\$REPO_NAME.git
git push -u origin main

if [ \$? -eq 0 ]; then
    echo "✅ Repository created: \${PROTOCOL}://git.\${BASE_DOMAIN}:\${BASE_PORT}/git/\${GIT_USER}/\$REPO_NAME"
    
    # Set repository description via API
    if [ -n "\$DESCRIPTION" ]; then
        curl -X PATCH \\
            -H "Authorization: token \$FORGEJO_TOKEN" \\
            -H "Content-Type: application/json" \\
            -d "{\\"description\\":\\"\$DESCRIPTION\\"}" \\
            "\${PROTOCOL}://git.\${BASE_DOMAIN}:\${BASE_PORT}/api/v1/repos/\${GIT_USER}/\$REPO_NAME"
    fi
    
    # Create default CI/CD workflow if requested
    read -p "Create default CI/CD workflow? (y/N): " -n 1 -r
    echo
    if [[ \$REPLY =~ ^[Yy]\$ ]]; then
        create_default_workflow "\$REPO_NAME"
    fi
else
    echo "❌ Failed to create repository"
fi`;
    
    await fs.writeFile(`${tempDir}/create-forgejo-repo.sh`, forgejoScript, { mode: 0o755 });
  }

  // CI/CD workflow generator
  const workflowScript = `#!/bin/bash
# Generate Forgejo Actions workflow
create_default_workflow() {
    local repo_name="\$1"
    local project_type=\$(detect_project_type)
    
    mkdir -p .forgejo/workflows
    
    case \$project_type in
        python)
            create_python_workflow
            ;;
        node)
            create_node_workflow
            ;;
        *)
            create_generic_workflow
            ;;
    esac
    
    git add .forgejo/workflows/
    git commit -m "Add CI/CD workflow"
    git push
    
    echo "✅ CI/CD workflow added to repository"
}

detect_project_type() {
    if [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
        echo "python"
    elif [ -f "package.json" ]; then
        echo "node"
    else
        echo "generic"
    fi
}

create_python_workflow() {
    cat > .forgejo/workflows/ci.yml << 'EOF'
name: Python CI/CD

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [3.9, 3.10, 3.11]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python \${{ matrix.python-version }}
      uses: actions/setup-python@v3
      with:
        python-version: \${{ matrix.python-version }}
    
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install flake8 pytest
        if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
    
    - name: Lint with flake8
      run: |
        flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
        flake8 . --count --exit-zero --max-complexity=10 --max-line-length=127 --statistics
    
    - name: Test with pytest
      run: |
        pytest

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Deploy to staging
      run: |
        echo "Deploying to staging environment..."
        # Add deployment commands here
EOF
}

create_node_workflow() {
    cat > .forgejo/workflows/ci.yml << 'EOF'
name: Node.js CI/CD

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [16.x, 18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Use Node.js \${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: \${{ matrix.node-version }}
        cache: 'npm'
    
    - run: npm ci
    - run: npm run build --if-present
    - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Deploy to staging
      run: |
        echo "Deploying to staging environment..."
        # Add deployment commands here
EOF
}`;
  
  await fs.writeFile(`${tempDir}/workflow-generator.sh`, workflowScript, { mode: 0o755 });
}
```

### Phase 5: Frontend Integration

#### Git Repository Management Tab
```html
<!-- New tab: Git Repositories -->
<div class="git-tab-content" id="git-tab">
  <div class="git-header">
    <h2>Git Repository Management</h2>
    <div class="git-actions">
      <button class="btn-primary" onclick="createRepository()">
        📁 New Repository
      </button>
      <button class="btn-secondary" onclick="openGitWeb()">
        🌐 Browse Git Server
      </button>
      <button class="btn-secondary" onclick="syncRepositories()">
        🔄 Sync Repositories
      </button>
    </div>
  </div>

  <div class="git-stats">
    <div class="stat-card">
      <h3>12</h3>
      <span>Repositories</span>
    </div>
    <div class="stat-card">
      <h3>5</h3>
      <span>Active Workflows</span>
    </div>
    <div class="stat-card">
      <h3>23</h3>
      <span>Recent Commits</span>
    </div>
  </div>

  <div class="repository-list">
    <div class="list-header">
      <h3>Your Repositories</h3>
      <div class="list-filters">
        <select id="repo-filter">
          <option value="all">All repositories</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
    </div>

    <div class="repo-grid" id="repositoryGrid">
      <!-- Repository cards will be populated here -->
    </div>
  </div>

  <div class="git-info-panel">
    <div class="info-section">
      <h4>🔗 Git Server Access</h4>
      <div class="access-info">
        <div class="access-item">
          <label>Web Interface:</label>
          <span class="access-url">
            <a href="/git/" target="_blank" id="git-web-url">git.ci.infra:8000/git/</a>
            <button class="btn-icon" onclick="copyToClipboard('git-web-url')">📋</button>
          </span>
        </div>
        <div class="access-item">
          <label>SSH Clone:</label>
          <span class="access-url">
            <code id="git-ssh-template">git@git.ci.infra:username/repo.git</code>
            <button class="btn-icon" onclick="copyToClipboard('git-ssh-template')">📋</button>
          </span>
        </div>
        <div class="access-item">
          <label>HTTPS Clone:</label>
          <span class="access-url">
            <code id="git-https-template">https://git.ci.infra:8000/git/username/repo.git</code>
            <button class="btn-icon" onclick="copyToClipboard('git-https-template')">📋</button>
          </span>
        </div>
      </div>
    </div>

    <div class="info-section">
      <h4>🚀 CI/CD Features</h4>
      <div class="features-list">
        <div class="feature-item">
          ✅ Forgejo Actions (GitHub Actions compatible)
        </div>
        <div class="feature-item">
          ✅ Automated testing pipelines
        </div>
        <div class="feature-item">
          ✅ Docker container builds
        </div>
        <div class="feature-item">
          ✅ Deployment automation
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Repository Creation Modal -->
<div class="modal" id="createRepoModal">
  <div class="modal-content">
    <div class="modal-header">
      <h3>Create New Repository</h3>
      <button class="modal-close" onclick="closeCreateRepoModal()">&times;</button>
    </div>
    <div class="modal-body">
      <form id="createRepoForm">
        <div class="form-group">
          <label for="repoName">Repository Name *</label>
          <input type="text" id="repoName" required pattern="[a-zA-Z0-9._-]+" 
                 placeholder="my-awesome-project">
          <small>Only letters, numbers, dots, hyphens, and underscores allowed</small>
        </div>
        
        <div class="form-group">
          <label for="repoDescription">Description</label>
          <textarea id="repoDescription" placeholder="A brief description of your project"></textarea>
        </div>
        
        <div class="form-group">
          <label class="checkbox-option">
            <input type="checkbox" id="repoPrivate">
            <span>Private repository</span>
          </label>
        </div>
        
        <div class="form-group">
          <label class="checkbox-option">
            <input type="checkbox" id="repoInitialize" checked>
            <span>Initialize with README</span>
          </label>
        </div>
        
        <div class="form-group">
          <label class="checkbox-option">
            <input type="checkbox" id="repoCICD">
            <span>Add CI/CD workflow</span>
          </label>
        </div>
        
        <div class="form-group">
          <label for="repoTemplate">Project Template</label>
          <select id="repoTemplate">
            <option value="">No template</option>
            <option value="python-flask">Python Flask</option>
            <option value="node-express">Node.js Express</option>
            <option value="react-app">React Application</option>
            <option value="vue-app">Vue.js Application</option>
          </select>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeCreateRepoModal()">Cancel</button>
      <button class="btn-primary" onclick="submitCreateRepo()">Create Repository</button>
    </div>
  </div>
</div>
```

#### JavaScript Git Management
```javascript
// git-manager.js
class GitManager {
  constructor() {
    this.apiBase = '/api/git';
    this.repositories = [];
  }

  async loadRepositories() {
    try {
      const response = await fetch(`${this.apiBase}/repositories`);
      const data = await response.json();
      
      if (response.ok) {
        this.repositories = data.repositories;
        this.renderRepositories();
      }
    } catch (error) {
      console.error('Failed to load repositories:', error);
    }
  }

  renderRepositories() {
    const grid = document.getElementById('repositoryGrid');
    
    if (this.repositories.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3>No repositories found</h3>
          <p>Create your first repository to get started</p>
          <button class="btn-primary" onclick="createRepository()">Create Repository</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.repositories.map(repo => `
      <div class="repo-card">
        <div class="repo-header">
          <h4 class="repo-name">
            <a href="/git/${repo.owner}/${repo.name}" target="_blank">${repo.name}</a>
          </h4>
          <div class="repo-badges">
            ${repo.private ? '<span class="badge private">Private</span>' : '<span class="badge public">Public</span>'}
            ${repo.has_actions ? '<span class="badge actions">CI/CD</span>' : ''}
          </div>
        </div>
        
        <div class="repo-description">
          ${repo.description || 'No description provided'}
        </div>
        
        <div class="repo-stats">
          <span class="stat">
            <span class="stat-icon">⭐</span>
            ${repo.stars_count || 0}
          </span>
          <span class="stat">
            <span class="stat-icon">🍴</span>
            ${repo.forks_count || 0}
          </span>
          <span class="stat">
            <span class="stat-icon">👁️</span>
            ${repo.watchers_count || 0}
          </span>
          <span class="stat">
            <span class="stat-icon">📝</span>
            ${repo.size}KB
          </span>
        </div>
        
        <div class="repo-meta">
          <span class="language">${repo.language || 'Unknown'}</span>
          <span class="updated">Updated ${this.formatDate(repo.updated_at)}</span>
        </div>
        
        <div class="repo-actions">
          <button class="btn-small btn-secondary" onclick="cloneRepository('${repo.clone_url}')">
            📥 Clone
          </button>
          <button class="btn-small btn-secondary" onclick="openInWorkspace('${repo.html_url}')">
            🚀 Open
          </button>
          <div class="dropdown">
            <button class="btn-small btn-secondary dropdown-toggle">⚙️</button>
            <div class="dropdown-menu">
              <a href="/git/${repo.owner}/${repo.name}/settings" target="_blank">Settings</a>
              <a href="/git/${repo.owner}/${repo.name}/actions" target="_blank">Actions</a>
              <a href="/git/${repo.owner}/${repo.name}/issues" target="_blank">Issues</a>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  async createRepository(formData) {
    try {
      const response = await fetch(`${this.apiBase}/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        this.showSuccess(`Repository "${formData.name}" created successfully!`);
        this.loadRepositories();
        
        // Optionally open in new workspace
        if (formData.openInWorkspace) {
          this.openInWorkspace(data.repository.clone_url);
        }
      } else {
        this.showError(data.message || 'Failed to create repository');
      }
    } catch (error) {
      this.showError('Network error: ' + error.message);
    }
  }

  async cloneRepository(cloneUrl) {
    // Integrate with workspace creation
    const projectName = cloneUrl.split('/').pop().replace('.git', '');
    
    const response = await fetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName,
        projectType: 'git-clone',
        gitUrl: cloneUrl
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      window.open(data.project.workspaceUrl, '_blank');
    }
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  }
}
```

## Benefits of Integrated Git Server

### 🏢 **Enterprise Advantages**
- **Complete Data Sovereignty**: All code stays on-premise
- **No External Dependencies**: Works in air-gapped environments  
- **GDPR/Compliance Ready**: Full control over data processing
- **Cost Effective**: No per-user/per-repository fees

### 🚀 **Developer Experience**
- **Push-to-Create**: `git push` automatically creates repositories
- **Seamless Integration**: Git server + workspaces in one platform
- **CI/CD Out-of-the-Box**: Forgejo Actions for automated pipelines
- **Unified Authentication**: Single credential management for everything

### 🔧 **Technical Benefits**
- **GitHub Actions Compatible**: Existing workflows work with minimal changes
- **Docker Integration**: Native container builds and deployments
- **API Complete**: Full REST API for automation and integration
- **Performance**: Local Git operations = faster clone/push/pull

### 🎯 **Workflow Examples**

#### Development Workflow
```bash
# 1. Create workspace with XaresAICoder
# 2. Develop your application
# 3. Simple push creates repository
git add .
git commit -m "Initial commit"
git push -u origin main  # ✅ Repository auto-created!

# 4. CI/CD pipeline automatically triggered
# 5. Deploy to staging/production via Actions
```

#### Team Collaboration
```bash
# Team member joins project
git clone git@git.ci.infra:team/awesome-project.git
cd awesome-project

# Create feature branch
git checkout -b feature/new-login
# ... develop feature ...
git push -u origin feature/new-login

# Create pull request via web interface
# CI/CD runs tests automatically
# Deploy after merge
```

## Conclusion

This credential management system transforms XaresAICoder from a development tool into an enterprise-ready platform. Key benefits:

1. **Security**: Enterprise-grade encryption and audit logging
2. **Productivity**: One-time setup, automatic distribution to all workspaces
3. **Compliance**: Full audit trails and access controls
4. **Scalability**: Supports unlimited users and credential types
5. **Integration**: Seamless integration with existing workflows
6. **Self-Contained**: Complete on-premise solution with integrated Git server
7. **CI/CD Ready**: GitHub Actions compatible pipelines out-of-the-box

The system is designed to be incrementally deployable, with each phase building on the previous one. This allows for gradual rollout and testing while maintaining backward compatibility with existing XaresAICoder installations.

**With the integrated Forgejo server, XaresAICoder becomes a complete, self-contained development platform that rivals GitHub Codespaces while maintaining full data sovereignty and enterprise security.**