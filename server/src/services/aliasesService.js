const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const Docker = require('dockerode');

const ALIAS_REGEX = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'git', 'forgejo', 'code-server',
  'workshop', 'mitm', 'proxy', 'squid', 'nginx',
  'dashboard', 'config', 'localhost'
]);
const RESERVED_PORTS = new Set([8082]); // code-server itself
const DYNAMIC_DIR = process.env.NGINX_DYNAMIC_DIR || '/app/nginx-dynamic';
const NGINX_VIEW_DIR = process.env.NGINX_VIEW_DIR || '/etc/nginx/dynamic';
const NGINX_CONTAINER_NAME = process.env.NGINX_CONTAINER_NAME || 'xaresaicoder-nginx';
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'localhost';

class AliasesService {
  constructor() {
    this.docker = new Docker();
    this.configPath = path.join(DYNAMIC_DIR, 'aliases.conf');
    this.authDir = path.join(DYNAMIC_DIR, 'auth');
  }

  // --- Validation ---

  validateSubdomain(subdomain) {
    if (typeof subdomain !== 'string' || !subdomain) {
      const e = new Error('subdomain is required');
      e.code = 'INVALID';
      throw e;
    }
    const lower = subdomain.toLowerCase();
    if (!ALIAS_REGEX.test(lower)) {
      const e = new Error('subdomain must be 3-32 lowercase chars, start with a letter, contain only a-z 0-9 and hyphens, and not end with hyphen');
      e.code = 'INVALID';
      throw e;
    }
    if (RESERVED_SUBDOMAINS.has(lower)) {
      const e = new Error(`subdomain "${lower}" is reserved`);
      e.code = 'RESERVED';
      throw e;
    }
    return lower;
  }

  validatePort(port) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      const e = new Error('port must be an integer between 1 and 65535');
      e.code = 'INVALID';
      throw e;
    }
    if (RESERVED_PORTS.has(n)) {
      const e = new Error(`port ${n} is reserved (code-server)`);
      e.code = 'RESERVED';
      throw e;
    }
    return n;
  }

  ensureUnique(workspaceService, subdomain, ignoreKey = null) {
    for (const project of workspaceService.projects.values()) {
      const list = Array.isArray(project.aliases) ? project.aliases : [];
      for (const alias of list) {
        if (alias.subdomain === subdomain) {
          const ownKey = `${project.projectId}:${alias.subdomain}`;
          if (ownKey !== ignoreKey) {
            const e = new Error(`subdomain "${subdomain}" is already in use`);
            e.code = 'CONFLICT';
            throw e;
          }
        }
      }
    }
  }

  // --- CRUD ---

  listForProject(workspaceService, projectId) {
    const project = workspaceService.projects.get(projectId);
    if (!project) {
      const e = new Error('Project not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    return Array.isArray(project.aliases) ? project.aliases : [];
  }

  async addAlias(workspaceService, projectId, input) {
    const project = workspaceService.projects.get(projectId);
    if (!project) {
      const e = new Error('Project not found');
      e.code = 'NOT_FOUND';
      throw e;
    }

    const subdomain = this.validateSubdomain(input.subdomain);
    const port = this.validatePort(input.port);
    this.ensureUnique(workspaceService, subdomain);

    const authProtected = !!input.authProtected;
    let authUsername = null;
    let authPasswordHash = null;

    if (authProtected) {
      authUsername = (input.authUsername || '').trim();
      const plainPw = input.authPassword || '';
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(authUsername)) {
        const e = new Error('authUsername must be 1-64 chars (letters, digits, _, ., -)');
        e.code = 'INVALID';
        throw e;
      }
      if (plainPw.length < 6 || plainPw.length > 128) {
        const e = new Error('authPassword must be 6-128 characters');
        e.code = 'INVALID';
        throw e;
      }
      authPasswordHash = this.shaHashPassword(plainPw);
    }

    if (!Array.isArray(project.aliases)) project.aliases = [];

    const now = new Date().toISOString();
    const alias = {
      subdomain,
      port,
      authProtected,
      authUsername,
      authPasswordHash,
      createdAt: now,
      updatedAt: now
    };
    project.aliases.push(alias);
    await workspaceService.saveProjectsToDisk();

    if (authProtected) {
      await this.writeHtpasswd(projectId, subdomain, authUsername, authPasswordHash);
    } else {
      await this.removeHtpasswd(projectId, subdomain);
    }

    await this.generateNginxConfig(workspaceService);
    await this.reloadNginx();

    return this.sanitize(alias);
  }

  async updateAlias(workspaceService, projectId, subdomainParam, input) {
    const project = workspaceService.projects.get(projectId);
    if (!project) {
      const e = new Error('Project not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    if (!Array.isArray(project.aliases)) project.aliases = [];

    const subdomain = this.validateSubdomain(subdomainParam);
    const alias = project.aliases.find(a => a.subdomain === subdomain);
    if (!alias) {
      const e = new Error('Alias not found');
      e.code = 'NOT_FOUND';
      throw e;
    }

    if (input.port !== undefined) {
      alias.port = this.validatePort(input.port);
    }

    // Auth handling
    if (input.authProtected === false) {
      alias.authProtected = false;
      alias.authUsername = null;
      alias.authPasswordHash = null;
      await this.removeHtpasswd(projectId, subdomain);
    } else if (input.authProtected === true || input.authUsername !== undefined || input.authPassword !== undefined) {
      const username = (input.authUsername !== undefined ? input.authUsername : alias.authUsername || '').trim();
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) {
        const e = new Error('authUsername must be 1-64 chars (letters, digits, _, ., -)');
        e.code = 'INVALID';
        throw e;
      }
      let passwordHash = alias.authPasswordHash;
      if (input.authPassword) {
        const plainPw = input.authPassword;
        if (plainPw.length < 6 || plainPw.length > 128) {
          const e = new Error('authPassword must be 6-128 characters');
          e.code = 'INVALID';
          throw e;
        }
        passwordHash = this.shaHashPassword(plainPw);
      }
      if (!passwordHash) {
        const e = new Error('authPassword is required when enabling Basic Auth');
        e.code = 'INVALID';
        throw e;
      }
      alias.authProtected = true;
      alias.authUsername = username;
      alias.authPasswordHash = passwordHash;
      await this.writeHtpasswd(projectId, subdomain, username, passwordHash);
    }

    alias.updatedAt = new Date().toISOString();
    await workspaceService.saveProjectsToDisk();
    await this.generateNginxConfig(workspaceService);
    await this.reloadNginx();

    return this.sanitize(alias);
  }

  async removeAlias(workspaceService, projectId, subdomainParam) {
    const project = workspaceService.projects.get(projectId);
    if (!project) {
      const e = new Error('Project not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    if (!Array.isArray(project.aliases)) project.aliases = [];
    const subdomain = subdomainParam.toLowerCase();
    const before = project.aliases.length;
    project.aliases = project.aliases.filter(a => a.subdomain !== subdomain);
    if (project.aliases.length === before) {
      const e = new Error('Alias not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    await workspaceService.saveProjectsToDisk();
    await this.removeHtpasswd(projectId, subdomain);
    await this.generateNginxConfig(workspaceService);
    await this.reloadNginx();
  }

  async cleanupForProject(projectId) {
    // Removes htpasswd files for this project. Project is already gone
    // from workspaceService.projects when this is called, so generateNginxConfig
    // will naturally omit its aliases on next regen.
    try {
      await fs.mkdir(this.authDir, { recursive: true });
      const entries = await fs.readdir(this.authDir);
      const prefix = `${projectId}__`;
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          await fs.unlink(path.join(this.authDir, entry)).catch(() => {});
        }
      }
    } catch (err) {
      console.error('cleanupForProject readdir failed:', err);
    }
    // Regenerate config from current state (does not include the deleted project anymore)
    const workspaceService = require('./workspace');
    await this.generateNginxConfig(workspaceService);
    await this.reloadNginx().catch(err => console.error('nginx reload during cleanup failed:', err));
  }

  // --- Output sanitizers (don't expose hashes) ---

  sanitize(alias) {
    return {
      subdomain: alias.subdomain,
      port: alias.port,
      authProtected: !!alias.authProtected,
      authUsername: alias.authUsername || null,
      createdAt: alias.createdAt,
      updatedAt: alias.updatedAt,
      url: this.buildUrl(alias.subdomain)
    };
  }

  buildUrl(subdomain) {
    const protocol = process.env.PROTOCOL || 'http';
    const basePort = process.env.BASE_PORT || '80';
    const portSuffix = (basePort === '80' || basePort === '443') ? '' : `:${basePort}`;
    return `${protocol}://${subdomain}.${BASE_DOMAIN}${portSuffix}/`;
  }

  // --- htpasswd ---

  htpasswdPath(projectId, subdomain) {
    return path.join(this.authDir, `${projectId}__${subdomain}.htpasswd`);
  }

  shaHashPassword(plainPassword) {
    // nginx supports {SHA}<base64-sha1> universally (no external crypt library
    // required). Bcrypt support depends on the build; SHA1 is safe.
    const digest = crypto.createHash('sha1').update(plainPassword).digest('base64');
    return `{SHA}${digest}`;
  }

  async writeHtpasswd(projectId, subdomain, username, passwordHash) {
    await fs.mkdir(this.authDir, { recursive: true });
    const line = `${username}:${passwordHash}\n`;
    // mode 0o644 so nginx workers (running as 'nginx' user) can read the file.
    // Contents are already hashed; world-readable is acceptable.
    await fs.writeFile(this.htpasswdPath(projectId, subdomain), line, { mode: 0o644 });
  }

  async removeHtpasswd(projectId, subdomain) {
    await fs.unlink(this.htpasswdPath(projectId, subdomain)).catch(() => {});
  }

  // --- nginx config generation ---

  async generateNginxConfig(workspaceService) {
    await fs.mkdir(DYNAMIC_DIR, { recursive: true });
    await fs.mkdir(this.authDir, { recursive: true });

    // Migration: remove any legacy `.bak` backup that an older code path may
    // have left behind — nginx's `aliases.conf*` glob would otherwise load it
    // as a duplicate server block and produce conflicting_server_name warnings.
    await fs.unlink(`${this.configPath}.bak`).catch(() => {});

    const wsService = workspaceService || require('./workspace');
    const blocks = [];

    for (const project of wsService.projects.values()) {
      const list = Array.isArray(project.aliases) ? project.aliases : [];
      for (const alias of list) {
        blocks.push(this.renderServerBlock(project.projectId, alias));
      }
    }

    const header = '# Auto-generated by XaresAICoder aliasesService. Do not edit by hand.\n';
    const body = blocks.length > 0 ? blocks.join('\n') : '# (no aliases configured)\n';

    // Backup current config before overwrite to allow rollback on bad config.
    // Use a name that does NOT match the `aliases.conf*` include glob,
    // otherwise nginx would load the backup as a duplicate server block.
    try {
      const existing = await fs.readFile(this.configPath, 'utf8').catch(() => '');
      if (existing) {
        await fs.writeFile(path.join(DYNAMIC_DIR, 'last-known-good.txt'), existing);
      }
    } catch (_) { /* ignore */ }

    await fs.writeFile(this.configPath, header + body);
  }

  renderServerBlock(projectId, alias) {
    const fqdn = `${alias.subdomain}.${BASE_DOMAIN}`;
    const upstream = `workspace-${projectId}:${alias.port}`;
    const authBasic = alias.authProtected
      ? `        auth_basic           "Restricted";\n` +
        `        auth_basic_user_file ${path.posix.join(NGINX_VIEW_DIR, 'auth', `${projectId}__${alias.subdomain}.htpasswd`)};\n`
      : '';

    return `
    server {
        listen 80;
        server_name ${fqdn};
${authBasic}
        location / {
            resolver 127.0.0.11 valid=30s;
            set $upstream ${upstream};
            proxy_pass http://$upstream;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $http_host;
            proxy_set_header X-Forwarded-Port $server_port;

            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }
    }
`;
  }

  // --- nginx reload ---

  async reloadNginx() {
    let container;
    try {
      container = this.docker.getContainer(NGINX_CONTAINER_NAME);
      await container.inspect();
    } catch (err) {
      // Container lookup by literal name failed — fall back to scanning by image/label.
      try {
        const all = await this.docker.listContainers();
        const match = all.find(c =>
          (c.Names || []).some(n => n.includes('nginx')) ||
          (c.Image || '').includes('nginx')
        );
        if (!match) {
          console.warn('reloadNginx: no nginx container found, skipping reload');
          return;
        }
        container = this.docker.getContainer(match.Id);
      } catch (innerErr) {
        console.error('reloadNginx: container lookup failed:', innerErr);
        return;
      }
    }

    // 1) Validate config first.
    const testOutput = await this.execInContainer(container, ['nginx', '-t']);
    if (testOutput.exitCode !== 0) {
      console.error('nginx -t failed:', testOutput.stderr || testOutput.stdout);
      // Roll back to last-known-good
      try {
        const backup = await fs.readFile(path.join(DYNAMIC_DIR, 'last-known-good.txt'), 'utf8');
        await fs.writeFile(this.configPath, backup);
        console.warn('Rolled back aliases.conf to last-known-good');
      } catch (rollbackErr) {
        console.error('Could not roll back aliases.conf:', rollbackErr);
      }
      const e = new Error('nginx config validation failed: ' + (testOutput.stderr || testOutput.stdout));
      e.code = 'NGINX_VALIDATION';
      throw e;
    }

    // 2) Reload.
    const reloadOutput = await this.execInContainer(container, ['nginx', '-s', 'reload']);
    if (reloadOutput.exitCode !== 0) {
      console.error('nginx -s reload failed:', reloadOutput.stderr || reloadOutput.stdout);
      const e = new Error('nginx reload failed: ' + (reloadOutput.stderr || reloadOutput.stdout));
      e.code = 'NGINX_RELOAD';
      throw e;
    }
  }

  execInContainer(container, cmd) {
    return new Promise(async (resolve, reject) => {
      try {
        const exec = await container.exec({
          Cmd: cmd,
          AttachStdout: true,
          AttachStderr: true
        });
        const stream = await exec.start({});

        const stdoutChunks = [];
        const stderrChunks = [];
        this.docker.modem.demuxStream(stream,
          { write: (c) => stdoutChunks.push(c) },
          { write: (c) => stderrChunks.push(c) }
        );

        stream.on('end', async () => {
          const info = await exec.inspect().catch(() => ({ ExitCode: 0 }));
          resolve({
            exitCode: typeof info.ExitCode === 'number' ? info.ExitCode : 0,
            stdout: Buffer.concat(stdoutChunks).toString('utf8'),
            stderr: Buffer.concat(stderrChunks).toString('utf8')
          });
        });
        stream.on('error', reject);
      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = new AliasesService();
