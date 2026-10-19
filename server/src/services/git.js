const fetch = require('node-fetch');
const crypto = require('crypto');

// Forgejo integration. The admin account (GIT_ADMIN_USER/PASSWORD) stays on
// the server: every workspace gets its own Forgejo user and an access token
// limited to that user, and its repositories are private. The token works as
// password for git over HTTP and for the Forgejo API.

const TOKEN_PREFIX = 'xaresaicoder-';
const TOKEN_SCOPES = ['write:repository', 'write:user'];

class GitService {
  constructor() {
    this.forgejoUrl = 'http://forgejo:3000';
    this.adminUser = process.env.GIT_ADMIN_USER || 'developer';
    this.adminPassword = process.env.GIT_ADMIN_PASSWORD || 'admin123!';
    this.gitServerEnabled = process.env.ENABLE_GIT_SERVER === 'true';
  }

  isGitServerAvailable() {
    return this.gitServerEnabled;
  }

  // Forgejo as the browser sees it (nginx serves it under /git/)
  externalBaseUrl() {
    const protocol = process.env.PROTOCOL || 'http';
    const baseDomain = process.env.BASE_DOMAIN || 'localhost';
    const basePort = process.env.BASE_PORT || '80';
    const standard = (protocol === 'http' && basePort === '80') || (protocol === 'https' && basePort === '443');
    return `${protocol}://${baseDomain}${standard ? '' : ':' + basePort}/git`;
  }

  // Forgejo API call as admin. Returns { status, body }; throws on network errors.
  async api(method, path, body) {
    const response = await fetch(`${this.forgejoUrl}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${this.adminUser}:${this.adminPassword}`).toString('base64')}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  }

  async apiOk(method, path, body, what) {
    const res = await this.api(method, path, body);
    if (res.status < 200 || res.status >= 300) {
      const msg = res.body && res.body.message ? res.body.message : JSON.stringify(res.body);
      throw new Error(`${what}: Forgejo answered ${res.status} ${msg}`);
    }
    return res.body;
  }

  // Readable and unique: "<project-name-slug>-<8 hex of the project ID>"
  workspaceUsername(projectId, projectName) {
    const slug = this.validateRepositoryName(projectName || 'workspace')
      .replace(/[_.]/g, '-').replace(/-+/g, '-').slice(0, 28).replace(/-+$/, '') || 'workspace';
    return `${slug}-${String(projectId).replace(/-/g, '').slice(0, 8)}`;
  }

  // Creates the workspace's Forgejo user if it does not exist yet. Its
  // password is random and never stored: the server works with admin rights
  // and the workspace with its token.
  async ensureWorkspaceUser(projectId, projectName) {
    const username = this.workspaceUsername(projectId, projectName);
    const existing = await this.api('GET', `/users/${encodeURIComponent(username)}`);
    if (existing.status === 200) return username;
    await this.apiOk('POST', '/admin/users', {
      username,
      email: `${username}@workspaces.xaresaicoder.local`,
      full_name: String(projectName || '').slice(0, 100),
      password: crypto.randomBytes(24).toString('base64url'),
      must_change_password: false,
      visibility: 'private'
    }, `Creating Forgejo user ${username}`);
    console.log(`Created Forgejo user ${username} for workspace ${projectId}`);
    return username;
  }

  async issueToken(username) {
    const token = await this.apiOk('POST', `/users/${encodeURIComponent(username)}/tokens`, {
      name: `${TOKEN_PREFIX}${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      scopes: TOKEN_SCOPES
    }, `Creating token for ${username}`);
    return token.sha1;
  }

  // Revokes the platform's tokens of a user (user and repositories stay)
  async revokeTokens(username) {
    const tokens = await this.apiOk('GET', `/users/${encodeURIComponent(username)}/tokens`, null, `Listing tokens of ${username}`);
    for (const t of tokens || []) {
      if (String(t.name).startsWith(TOKEN_PREFIX)) {
        await this.apiOk('DELETE', `/users/${encodeURIComponent(username)}/tokens/${t.id}`, null, `Revoking token of ${username}`);
      }
    }
  }

  // Private repository owned by the workspace user. Names are unique per
  // user, so a clash only happens if the user already has that repository.
  async createRepoForUser(username, repoName, description = '') {
    const base = this.validateRepositoryName(repoName);
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = attempt === 0 ? base : `${base}-${crypto.randomBytes(2).toString('hex')}`;
      const res = await this.api('POST', `/admin/users/${encodeURIComponent(username)}/repos`, {
        name,
        description: description || `Repository for ${name}`,
        private: true,
        auto_init: false,
        default_branch: 'main'
      });
      if (res.status === 201) return this.repoInfo(username, res.body.name);
      if (res.status !== 409) {
        throw new Error(`Creating repository ${username}/${name}: Forgejo answered ${res.status}`);
      }
    }
    throw new Error(`Creating repository for ${username}: no free name for ${base}`);
  }

  async transferRepo(owner, repo, newOwner) {
    const moved = await this.apiOk('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/transfer`,
      { new_owner: newOwner }, `Transferring ${owner}/${repo} to ${newOwner}`);
    return this.repoInfo(newOwner, repo, !!(moved && moved.private));
  }

  async addCollaborator(owner, repo, username) {
    await this.apiOk('PUT', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
      { permission: 'write' }, `Granting ${username} access to ${owner}/${repo}`);
  }

  async repoExists(owner, repo) {
    const res = await this.api('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    return res.status === 200 && res.body && res.body.owner && res.body.owner.login === owner;
  }

  repoInfo(owner, name, isPrivate = true) {
    const webUrl = `${this.externalBaseUrl()}/${owner}/${name}`;
    return { name, owner, fullName: `${owner}/${name}`, webUrl, cloneUrl: `${webUrl}.git`, private: isPrivate };
  }

  // URL a workspace pushes to (inside the Docker network, with its token)
  remoteUrl(username, token, owner, repo) {
    return `http://${encodeURIComponent(username)}:${token}@forgejo:3000/${owner}/${repo}.git`;
  }

  // { owner, repo } if the URL points to this platform's Forgejo (as seen by
  // the browser, http://<domain>/git/<owner>/<repo>, or internally,
  // http://forgejo:3000/<owner>/<repo>), otherwise null
  parseLocalRepoUrl(url) {
    if (typeof url !== 'string') return null;
    const clean = url.replace(/\/+$/, '').replace(/\.git$/, '');
    const name = '([A-Za-z0-9][A-Za-z0-9_.-]*)';
    const internal = new RegExp(`^https?://(?:[^@/]+@)?forgejo:3000/${name}/${name}$`).exec(clean);
    if (internal) return { owner: internal[1], repo: internal[2] };
    try {
      const u = new URL(clean);
      const ext = new URL(this.externalBaseUrl());
      if (u.hostname !== ext.hostname || (u.port || '') !== (ext.port || '')) return null;
      const m = new RegExp(`^/git/${name}/${name}$`).exec(u.pathname);
      return m ? { owner: m[1], repo: m[2] } : null;
    } catch {
      return null;
    }
  }

  /**
   * Validate and sanitize repository name for Git/Forgejo
   * @param {string} name - Repository name to validate
   * @returns {string} Validated repository name
   */
  validateRepositoryName(name) {
    // Convert to lowercase and replace invalid characters
    let validName = String(name).toLowerCase()
      .replace(/[^a-z0-9-_.]/g, '-')  // Replace invalid chars with hyphens
      .replace(/^[-_.]+/, '')         // Remove leading hyphens, dots, underscores
      .replace(/[-_.]+$/, '')         // Remove trailing hyphens, dots, underscores
      .replace(/[-_.]{2,}/g, '-')     // Replace multiple consecutive separators with single hyphen
      .substring(0, 50);              // Limit length

    // Ensure it doesn't start or end with separator
    validName = validName.replace(/^-+|-+$/g, '');

    // Ensure it's not empty
    if (!validName) {
      validName = 'project';
    }

    return validName;
  }

  // Forgejo starts together with the API server and needs a while; wait
  // for it (admin login included) before working with it on boot.
  async waitUntilReady(timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if ((await this.api('GET', '/user')).status === 200) return true;
      } catch { /* not up yet */ }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return false;
  }

  /**
   * Test Git server connectivity
   * @returns {Promise<boolean>} Whether Git server is accessible
   */
  async testGitServerConnection() {
    if (!this.isGitServerAvailable()) {
      console.log('Git server is disabled (ENABLE_GIT_SERVER != true)');
      return false;
    }

    try {
      console.log(`Testing Git server connectivity to: ${this.forgejoUrl}/api/v1/version`);
      const response = await fetch(`${this.forgejoUrl}/api/v1/version`, {
        method: 'GET',
        timeout: 5000
      });

      console.log(`Git server connectivity test result: ${response.ok} (status: ${response.status})`);
      return response.ok;
    } catch (error) {
      console.error('Git server connection test failed:', error.message);
      return false;
    }
  }
}

module.exports = new GitService();
