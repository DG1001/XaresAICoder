const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');

// Header names whose values are credentials. Captures written before the
// mitmproxy addon redacted them still contain raw keys, so they are also
// redacted when read.
// 'token(?!s)' keeps rate-limit headers such as anthropic-ratelimit-tokens-remaining.
const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|set-cookie)$|api[-_]?key|token(?!s)|secret|session/i;
const SENSITIVE_QUERY_PARAMS = new Set(['key', 'api_key', 'apikey', 'access_token', 'token']);

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADER_RE.test(name) ? '[REDACTED]' : value;
  }
  return out;
}

function redactUrl(url) {
  if (typeof url !== 'string' || !url.includes('?')) return url;
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const name of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
        parsed.searchParams.set(name, 'REDACTED');
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

function redactConversation(conv) {
  if (!conv || typeof conv !== 'object') return conv;
  conv.headers = redactHeaders(conv.headers);
  conv.url = redactUrl(conv.url);
  if (conv.response && typeof conv.response === 'object') {
    conv.response.headers = redactHeaders(conv.response.headers);
  }
  return conv;
}

// Agent tools resend the whole history with every request, so a single
// capture can be several MB (raw body and parsed messages both stored). The
// list view therefore gets a small summary per capture; the full capture is
// fetched one at a time (getLLMConversation).
function conversationText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : (part && typeof part.text === 'string' ? part.text : '')))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function excerpt(text, max = 240) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function numberOrNull(...values) {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function summarizeConversation(conv, file, size) {
  const req = (conv && conv.parsed_request) || {};
  const res = (conv && conv.parsed_response) || {};
  const messages = Array.isArray(req.messages) ? req.messages : [];
  // Agents feed screenshots back as user messages without text: take the
  // last user message that has text
  const userMessages = messages.filter(m => m && m.role === 'user');
  const userTexts = userMessages.map(m => conversationText(m.content)).filter(t => t.trim());
  const userHasImage = userMessages.some(m => Array.isArray(m.content)
    && m.content.some(p => p && /image/.test(p.type || '')));
  const u = res.usage || {};
  const input = numberOrNull(u.prompt_tokens, u.input_tokens);
  const output = numberOrNull(u.completion_tokens, u.output_tokens);
  const cached = numberOrNull(u.prompt_cache_hit_tokens, u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens, u.cache_read_input_tokens);
  let answer = '';
  if (Array.isArray(res.choices) && res.choices[0]) {
    const c = res.choices[0];
    answer = conversationText((c.message && c.message.content) || c.text);
  } else if (Array.isArray(res.content)) {
    answer = conversationText(res.content);
  }
  const summary = {
    _file: file,
    timestamp: conv.timestamp,
    method: conv.method,
    url: redactUrl(conv.url),
    model: req.model || res.model || null,
    status: numberOrNull(conv.response && conv.response.status_code),
    messageCount: messages.length,
    usage: input !== null || output !== null ? { input, output, cached } : null,
    size,
    lastUserMessage: userTexts.length ? excerpt(userTexts[userTexts.length - 1]) : (userHasImage ? '[image]' : ''),
    response: excerpt(answer)
  };
  if (Array.isArray(conv.websocket_messages)) {
    summary.websocketMessages = conv.websocket_messages.length;
    summary.inProgress = !!conv.in_progress;
  }
  return summary;
}

// Every environment variable buildContainerSpec() may set. A clone container
// inherits the snapshot's environment from its image, so any of these that
// the clone does not set itself is overridden with an empty value (e.g. the
// source's GIT_ACCESS_TOKEN or PASSWORD).
const PLATFORM_ENV_KEYS = [
  'PROJECT_TYPE', 'PROJECT_ID', 'VSCODE_PROXY_URI', 'PROXY_DOMAIN',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'PASSWORD',
  'GIT_SERVER_ENABLED', 'GIT_SERVER_URL', 'GIT_ADMIN_USER', 'GIT_ADMIN_PASSWORD', 'GIT_SERVER_EXTERNAL_URL',
  'FORGEJO_USER', 'FORGEJO_TOKEN',
  'GIT_REPO_NAME', 'GIT_REMOTE_URL', 'GIT_WEB_URL',
  'GIT_CLONE_URL', 'GIT_USERNAME', 'GIT_ACCESS_TOKEN',
  'NVIDIA_VISIBLE_DEVICES', 'NVIDIA_DRIVER_CAPABILITIES'
];

// Prepends sandbox_mode = "danger-full-access" to ~/.codex/config.toml unless a
// sandbox_mode is already configured. Under Docker's default seccomp profile
// Codex's own sandbox (bubblewrap) cannot create user namespaces; the
// workspace container is the sandbox. Prepended because TOML top-level keys
// must precede any [table].
const CODEX_SANDBOX_DEFAULT_SCRIPT = `
f="$HOME/.codex/config.toml"
mkdir -p "$HOME/.codex"
if ! grep -qs '^[[:space:]]*sandbox_mode[[:space:]]*=' "$f"; then
  {
    echo '# Set by XaresAICoder: this workspace container is the sandbox. Codex'"'"'s own'
    echo '# sandbox (bubblewrap) needs user namespaces, which the container blocks.'
    echo 'sandbox_mode = "danger-full-access"'
    if [ -f "$f" ]; then cat "$f"; fi
  } > "$f.tmp" && mv "$f.tmp" "$f"
fi
`;

// Runs (as root, without network) in a throwaway container created from a
// clone snapshot. Removes the source workspace's credentials and histories so
// they are not handed to every clone. AI tool logins and transcripts are only
// removed when KEEP_AI_LOGINS != 1 (the teacher can opt in to distributing a
// workshop key). Paths were collected from real workspaces of this platform.
const CLONE_CLEANUP_SCRIPT = `
H=/home/coder
# Platform and git credentials, shell histories (always)
rm -rf "$H/.code-server-auth" "$H/.git-credentials" "$H/.netrc" "$H/.pypirc" \\
  "$H/.bash_history" "$H/.zsh_history" "$H/.python_history" "$H/.node_repl_history" \\
  "$H/.lesshst" "$H/.local/state/lesshst" "$H/.local/share/fish/fish_history" \\
  "$H/.config/gh/hosts.yml" "$H/.local/state/gh"
if [ -d "$H/.ssh" ]; then find "$H/.ssh" -mindepth 1 ! -name known_hosts -exec rm -rf {} +; fi
if [ -f "$H/.npmrc" ]; then sed -i '/_authToken/d; /_auth *=/d; /_password *=/d' "$H/.npmrc"; fi
if [ -f "$H/.config/code-server/config.yaml" ]; then
  sed -i '/^password:/d; /^hashed-password:/d; s/^auth: password/auth: none/' "$H/.config/code-server/config.yaml"
fi
# Credentials embedded in git remote URLs (https://user:token@host/...)
find /workspace "$H" -maxdepth 4 -path '*/.git/config' -type f 2>/dev/null | while read -r f; do
  sed -i -E 's#(url = [A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@#\\1#' "$f"
done
if [ "\${KEEP_AI_LOGINS:-0}" != 1 ]; then
  # Claude Code
  rm -rf "$H/.claude/.credentials.json" "$H/.claude.json" "$H/.claude/backups" "$H/.claude/projects" \\
    "$H/.claude/history.jsonl" "$H/.claude/file-history" "$H/.claude/paste-cache" "$H/.claude/shell-snapshots" \\
    "$H/.claude/session-env" "$H/.claude/sessions" "$H/.claude/todos" "$H/.claude/tasks" "$H/.claude/plans" \\
    "$H/.claude/mcp-needs-auth-cache.json"
  # OpenAI Codex
  rm -rf "$H/.codex/auth.json" "$H/.codex/sessions" "$H/.codex/history.jsonl" "$H/.codex/memories" \\
    "$H/.codex/log" "$H/.codex"/state_*.sqlite*
  # OpenCode
  rm -rf "$H/.local/share/opencode/auth.json" "$H/.local/share/opencode/storage" "$H/.local/share/opencode/log" \\
    "$H/.local/share/opencode/snapshot" "$H/.local/share/opencode"/opencode.db*
  # Kilo Code (OpenCode-based backend of the extension)
  rm -rf "$H/.local/share/kilo/auth.json" "$H/.local/share/kilo/storage" "$H/.local/share/kilo/log" \\
    "$H/.local/share/kilo"/*.db*
  # GitHub Copilot CLI (config with login, sessions, history)
  rm -rf "$H/.copilot"
  # Crush, Pi, Cline; Qwen Code (no longer installed, older snapshots)
  rm -rf "$H/.qwen/oauth_creds.json" "$H/.qwen/projects" "$H/.qwen/tmp" \\
    "$H/.local/share/crush/crush.json" "$H/.local/share/crush/hyper.json" "$H/.config/crush/crush.json" \\
    "$H/.pi/agent/auth.json" "$H/.pi/agent/sessions" \\
    "$H/.cline/data/secrets.json" "$H/.cline/data/tasks"
  # Continue and Aider (no longer installed, older snapshots).
  # Continue: legacy JSON config and .env; strip API keys from config.yaml
  rm -rf "$H/.continue/config.json" "$H/.continue/.env" "$H/.continue/dev_data"
  if [ -f "$H/.continue/config.yaml" ]; then sed -i -E '/^[[:space:]]*-?[[:space:]]*apiKey:/d' "$H/.continue/config.yaml"; fi
  # Aider (reads keys from ~/.env and ~/.aider.conf.yml; histories live in the repo)
  rm -rf "$H/.env" "$H/.aider.conf.yml" /workspace/.aider.chat.history.md /workspace/.aider.input.history \\
    /workspace/.aider.tags.cache.v*
fi
echo cleanup-done
`;

// IPv4 address <-> number. Arithmetic instead of bit operators, which work on
// signed 32-bit integers.
function ipv4ToInt(ip) {
  return ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
}
function intToIpv4(n) {
  return [16777216, 65536, 256, 1].map(d => Math.floor(n / d) % 256).join('.');
}
// '172.30.0.0/16' -> { base, size }, or null for anything but IPv4 CIDR
function parseIpv4Cidr(cidr) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr || '');
  if (!m || Number(m[2]) > 30) return null;
  const size = 2 ** (32 - Number(m[2]));
  return { base: ipv4ToInt(m[1]) - (ipv4ToInt(m[1]) % size), size };
}

class DockerService {
  constructor() {
    this.docker = new Docker();
    // External persistent network name (no Docker Compose prefix)
    this.network = process.env.DOCKER_NETWORK || 'xares-aicoder-network';
    // Capture summaries by "<ip>/<file>", valid while mtime and size match
    // (WebSocket captures are rewritten while the session runs)
    this.conversationSummaries = new Map();
    this.activeContainers = new Map();
    // Domain and port configuration
    this.baseDomain = process.env.BASE_DOMAIN || 'localhost';
    this.basePort = process.env.BASE_PORT || '80';
    this.protocol = process.env.PROTOCOL || 'http';
    // Docker image configuration
    this.codeServerImage = process.env.CODESERVER_IMAGE || 'xares-aicoder-codeserver:latest';
    // Disk usage display configuration
    this.showDiskUsage = process.env.SHOW_DISK_USAGE === 'true';
    // Proxy configuration
    this.enableProxy = process.env.ENABLE_PROXY === 'true';
    // Internal networks for proxied workspaces (compose prefixed): one per
    // proxy, so Security Proxy workspaces cannot reach the unrestricted mitmproxy
    this.proxyNetwork = process.env.PROXY_NETWORK || 'xaresaicoder_xares-internal'; // LLM Logging Proxy
    this.securityNetwork = process.env.SECURITY_PROXY_NETWORK || 'xaresaicoder_xares-security'; // Security Proxy
    this.loggingDnsIp = process.env.DNSMASQ_IP || '172.30.0.2'; // dnsmasq on each internal network
    this.securityDnsIp = process.env.SECURITY_DNSMASQ_IP || '172.31.255.254';
    this.nginxContainerName = process.env.NGINX_CONTAINER_NAME || 'xaresaicoder-nginx';
    this.proxyHost = 'xaresaicoder-mitmproxy-logger:8080'; // mitmproxy container for LLM conversation logging
    this.squidProxyHost = 'xaresaicoder-squid-proxy:3128'; // Squid proxy container for security whitelist filtering
    // Default for workspaces that do not choose themselves (per-workspace sudoEnabled)
    this.workspaceSudoEnabled = process.env.WORKSPACE_SUDO_ENABLED === 'true';
    // 'default' = Docker's default seccomp profile; 'unconfined' only if some
    // tool really needs syscalls the default profile blocks
    this.seccompMode = process.env.WORKSPACE_SECCOMP === 'unconfined' ? 'unconfined' : 'default';
    // Per-workspace writable layer limit (e.g. '20G'); only enforceable on
    // overlay2 backed by xfs with project quotas (see getHostCapabilities)
    this.diskLimit = (process.env.WORKSPACE_DISK_LIMIT || '').trim();
    // Docker log rotation, same values as the compose services
    this.logConfig = {
      Type: 'json-file',
      Config: {
        'max-size': process.env.LOG_MAX_SIZE || '10m',
        'max-file': process.env.LOG_MAX_FILE || '3'
      }
    };
    this.hostCapabilities = null;
    // Security and isolation configuration
    this.securityConfig = {
      pidsLimit: parseInt(process.env.CONTAINER_PIDS_LIMIT) || 2048,
      maxFileDescriptors: parseInt(process.env.CONTAINER_MAX_FDS) || 4096,
      maxFileDescriptorsHard: parseInt(process.env.CONTAINER_MAX_FDS_HARD) || 8192,
      maxProcessesPerUser: parseInt(process.env.CONTAINER_MAX_PROCS) || 2048,
      maxProcessesPerUserHard: parseInt(process.env.CONTAINER_MAX_PROCS_HARD) || 4096
    };
  }

  // Docker network a workspace belongs on, by proxy mode
  networkForProxyMode(proxyMode) {
    if (proxyMode === 'security') return this.securityNetwork;
    if (proxyMode === 'logging') return this.proxyNetwork;
    return this.network;
  }

  // Every network the platform attaches workspaces to
  workspaceNetworks() {
    return [this.network, this.proxyNetwork, this.securityNetwork];
  }

  endpointConfig(containerName, fixedIp = null) {
    return {
      Aliases: [containerName],
      ...(fixedIp && { IPAMConfig: { IPv4Address: fixedIp } })
    };
  }

  // IPv4 subnet of the network for a proxy mode, plus the addresses in use
  async getProxyNetworkInfo(proxyMode) {
    const name = this.networkForProxyMode(proxyMode);
    let info;
    try {
      info = await this.docker.getNetwork(name).inspect();
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Network '${name}' does not exist. Run ./deploy.sh first.`);
      }
      throw error;
    }
    const cfg = ((info.IPAM && info.IPAM.Config) || []).find(c => parseIpv4Cidr(c.Subnet));
    if (!cfg) throw new Error(`Network '${name}' has no IPv4 subnet`);
    const used = new Set([this.loggingDnsIp, this.securityDnsIp]);
    for (const c of Object.values(info.Containers || {})) {
      if (c.IPv4Address) used.add(c.IPv4Address.split('/')[0]);
    }
    return { name, subnet: cfg.Subnet, range: parseIpv4Cidr(cfg.Subnet), used };
  }

  ipInSubnet(ip, subnet) {
    const range = parseIpv4Cidr(subnet);
    if (!range || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '')) return false;
    const n = ipv4ToInt(ip);
    return n > range.base && n < range.base + range.size - 1;
  }

  // Picks a fixed address for a proxied workspace. mitmproxy and squid know a
  // workspace only by its client IP; with Docker's dynamic addresses a
  // restarted workspace could come back under another IP and lose its
  // captures, or see those of another workspace. Fixed addresses come from
  // the upper half of the subnet because Docker hands out dynamic ones
  // (infrastructure containers) from the bottom. `taken` holds the addresses
  // of all other projects, including stopped ones.
  async allocateProxyIp(proxyMode, taken = new Set()) {
    const { name, subnet, range, used } = await this.getProxyNetworkInfo(proxyMode);
    const last = range.base + range.size - 2;
    for (let n = range.base + range.size / 2; n <= last; n++) {
      if (n % 256 === 0 || n % 256 === 255) continue;
      const ip = intToIpv4(n);
      if (!used.has(ip) && !taken.has(ip)) return ip;
    }
    throw new Error(`No free fixed address left in network '${name}' (${subnet})`);
  }

  // Current address of a running workspace on the network of its proxy mode
  async getCurrentProxyIp(projectId, proxyMode) {
    try {
      const info = await this.docker.getContainer(`workspace-${projectId}`).inspect();
      const entry = (info.NetworkSettings.Networks || {})[this.networkForProxyMode(proxyMode)];
      return info.State.Running && entry && entry.IPAddress ? entry.IPAddress : null;
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  // Single source of truth for workspace container settings. Used by both
  // createWorkspaceContainer and createCloneContainer, so security and
  // resource settings cannot drift apart between the two paths.
  // Returns { containerName, useProxy, spec } where spec is the
  // docker.createContainer() payload.
  buildContainerSpec(projectId, {
    image,
    projectType,
    memoryLimit = '2g',
    cpuCores = '2',
    passwordProtected = false,
    password = null,
    proxyMode = 'none',
    gitRepository = null,
    gitUrl = null,
    gitUsername = null,
    gitToken = null,
    forgejo = null,
    sudoEnabled = this.workspaceSudoEnabled,
    proxyIp = null,
    hostCapabilities = { ncpu: null, diskQuota: false }
  }) {
    const containerName = `workspace-${projectId}`;
    const useProxy = proxyMode !== 'none';
    const activeProxyHost = proxyMode === 'security' ? this.squidProxyHost : this.proxyHost;
    const hostSuffix = this.basePort !== '80' ? ':' + this.basePort : '';
    let authFlag = 'none'; // Default to no auth
    const envVars = [
      `PROJECT_TYPE=${projectType}`,
      `PROJECT_ID=${projectId}`,
      `VSCODE_PROXY_URI=${this.protocol}://${projectId}-{{port}}.${this.baseDomain}${hostSuffix}/`,
      `PROXY_DOMAIN=${projectId}.${this.baseDomain}${hostSuffix}`
    ];

    // Add proxy environment variables if THIS workspace uses proxy
    if (useProxy) {
      // Uppercase (used by some tools)
      envVars.push(`HTTP_PROXY=http://${activeProxyHost}`);
      envVars.push(`HTTPS_PROXY=http://${activeProxyHost}`);
      envVars.push(`NO_PROXY=localhost,127.0.0.1,forgejo`);
      // Lowercase (used by curl and many CLI tools)
      envVars.push(`http_proxy=http://${activeProxyHost}`);
      envVars.push(`https_proxy=http://${activeProxyHost}`);
      envVars.push(`no_proxy=localhost,127.0.0.1,forgejo`);
      // Tell Node.js to trust the proxy CA certificate
      envVars.push(`NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/squid-ca.crt`);
    }

    if (passwordProtected && password) {
      authFlag = 'password';
      envVars.push(`PASSWORD=${password}`);
    }

    // Git server: the workspace's own Forgejo user and token (never the
    // admin account). GIT_ADMIN_USER/GIT_ADMIN_PASSWORD carry the same values
    // for setup_local_remote in code-server images built before FORGEJO_*.
    if (process.env.ENABLE_GIT_SERVER === 'true') {
      const protocol = process.env.PROTOCOL || 'http';
      const baseDomain = process.env.BASE_DOMAIN || 'localhost';
      const basePort = process.env.BASE_PORT || '80';

      envVars.push(`GIT_SERVER_ENABLED=true`);
      envVars.push(`GIT_SERVER_URL=http://forgejo:3000`);
      if (forgejo && forgejo.user && forgejo.token) {
        envVars.push(`FORGEJO_USER=${forgejo.user}`);
        envVars.push(`FORGEJO_TOKEN=${forgejo.token}`);
        envVars.push(`GIT_ADMIN_USER=${forgejo.user}`);
        envVars.push(`GIT_ADMIN_PASSWORD=${forgejo.token}`);
      }

      // Build external Git server URL for display
      let externalGitUrl;
      if ((protocol === 'http' && basePort === '80') || (protocol === 'https' && basePort === '443')) {
        externalGitUrl = `${protocol}://${baseDomain}/git`;
      } else {
        externalGitUrl = `${protocol}://${baseDomain}:${basePort}/git`;
      }
      envVars.push(`GIT_SERVER_EXTERNAL_URL=${externalGitUrl}`);
    }

    // Add Git repository configuration to environment if available
    if (gitRepository) {
      envVars.push(`GIT_REPO_NAME=${gitRepository.name}`);
      envVars.push(`GIT_REMOTE_URL=${gitRepository.internalCloneUrl}`);
      envVars.push(`GIT_WEB_URL=${gitRepository.webUrl}`);
    }

    // Add Git clone configuration if available
    if (gitUrl) {
      envVars.push(`GIT_CLONE_URL=${gitUrl}`);
      if (gitUsername) {
        envVars.push(`GIT_USERNAME=${gitUsername}`);
      }
      if (gitToken) {
        envVars.push(`GIT_ACCESS_TOKEN=${gitToken}`);
      }
    }

    // Add GPU environment variables only if GPU is enabled
    const enableGpu = process.env.ENABLE_GPU === 'true';
    if (enableGpu) {
      envVars.push('NVIDIA_VISIBLE_DEVICES=all');
      envVars.push('NVIDIA_DRIVER_CAPABILITIES=compute,utility');
    }

    const workspaceNetwork = this.networkForProxyMode(proxyMode);

    const spec = {
      Image: image,
      name: containerName,
      Env: envVars,
      ExposedPorts: {
        '8082/tcp': {}, // code-server
        '3000/tcp': {}, // Node.js apps
        '5000/tcp': {}, // Flask/Python apps
        '8000/tcp': {}, // Django/other Python apps
        '8080/tcp': {}, // Spring Boot apps
        '4200/tcp': {}, // Angular
        '3001/tcp': {}, // React dev server alt
        '9000/tcp': {}  // Various apps
      },
      HostConfig: {
        Memory: this.parseMemoryLimit(memoryLimit),
        // Hard CPU limit (CpuShares was only a relative weight under contention)
        NanoCpus: this.cpuCoresToNanoCpus(cpuCores, hostCapabilities.ncpu),
        NetworkMode: workspaceNetwork,
        PidMode: '', // Isolated PID namespace (default, but explicit for security)
        IpcMode: 'private', // Isolated IPC namespace (prevents container communication via shared memory)
        PidsLimit: this.securityConfig.pidsLimit, // Limit max processes (prevents fork bombs)
        // Run docker-init (tini) as PID 1 so orphaned processes get reaped.
        // code-server is a node process and does not call waitpid() for
        // children it did not spawn itself, so every orphaned grandchild --
        // AI tool helpers, headless browsers, dev servers -- stays behind as a
        // zombie. Those consume PID slots and count against PidsLimit; long
        // running workspaces accumulate dozens of them.
        Init: true,
        SecurityOpt: [
          // Without sudo, block privilege escalation (setuid binaries) entirely
          ...(sudoEnabled ? [] : ['no-new-privileges:true']),
          // Docker's default seccomp profile unless explicitly configured otherwise
          ...(this.seccompMode === 'unconfined' ? ['seccomp=unconfined'] : [])
        ],
        // Limit the container's writable layer where the host supports it
        ...(this.diskLimit && hostCapabilities.diskQuota && {
          StorageOpt: { size: this.diskLimit }
        }),
        // Drop all capabilities, then add back only what's needed for development
        CapDrop: ['ALL'],
        CapAdd: [
          'CHOWN',           // Change file ownership
          'DAC_OVERRIDE',    // Bypass file permission checks (needed for some dev tools)
          'FOWNER',          // Bypass permission checks on file operations
          'SETGID',          // Set GID (needed for some installers)
          'SETUID',          // Set UID (needed for some installers)
          'NET_BIND_SERVICE', // Bind to ports < 1024 (useful for web servers)
          'AUDIT_WRITE'      // Write to audit logs (suppresses sudo audit warnings)
        ],
        // Resource limits to prevent abuse
        // Note: nproc (RLIMIT_NPROC) is NOT used here because it counts threads per-UID
        // system-wide across ALL containers sharing UID 1000, causing cross-container
        // interference. Per-container process isolation is handled by PidsLimit (cgroup).
        Ulimits: [
          { Name: 'nofile', Soft: this.securityConfig.maxFileDescriptors, Hard: this.securityConfig.maxFileDescriptorsHard }
        ],
        RestartPolicy: {
          Name: 'unless-stopped'
        },
        LogConfig: this.logConfig,
        // dnsmasq on the workspace's internal network (no route to public DNS)
        ...(useProxy && {
          Dns: [proxyMode === 'security' ? this.securityDnsIp : this.loggingDnsIp]
        }),
        // Only request GPU access if GPU is enabled
        ...(enableGpu && {
          DeviceRequests: [{
            Driver: '',
            Count: -1, // Request all available GPUs
            Capabilities: [['gpu']]
          }]
        })
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [workspaceNetwork]: this.endpointConfig(containerName, useProxy ? proxyIp : null)
        }
      },
      // Explicit, because snapshots imported via export/import lose the image's USER
      User: 'coder',
      WorkingDir: '/workspace',
      Cmd: ['code-server', '--bind-addr', '0.0.0.0:8082', '--auth', authFlag, '--proxy-domain', `${projectId}.${this.baseDomain}${hostSuffix}`, '/workspace']
    };

    return { containerName, useProxy, spec };
  }

  async createWorkspaceContainer(projectId, projectType, authOptions = {}) {
    try {
      const containerName = `workspace-${projectId}`;
      const port = await this.findAvailablePort(8080);

      // Build the code-server image if it doesn't exist
      await this.ensureCodeServerImage();

      const { proxyMode = 'none' } = authOptions;
      const { useProxy, spec } = this.buildContainerSpec(projectId, {
        ...authOptions,
        image: this.codeServerImage,
        projectType,
        hostCapabilities: await this.getHostCapabilities()
      });
      const container = await this.docker.createContainer(spec);

      await container.start();
      console.log(`Container ${containerName} started`);

      // Docker reuses IPs: drop proxy logs left by a previous workspace at this
      // address before this one generates traffic (also keeps init domains).
      if (useProxy) await this.resetProxyLogsForWorkspace(projectId);

      // Wait for code-server to be ready first
      await this.waitForWorkspaceReady(containerName);
      console.log(`Workspace ${containerName} is ready, now initializing project`);

      // Initialize git repository and project structure after container is ready
      await this.initializeProject(container, projectType, proxyMode);
      await this.ensureCodexSandboxDefault(container);
      console.log(`Initialization completed for ${containerName}`);

      this.activeContainers.set(projectId, {
        container,
        name: containerName,
        port,
        createdAt: new Date(),
        projectType
      });

      // Wait for DNS to propagate so nginx can resolve the container name
      await this.waitForDnsReady(containerName);

      return {
        projectId,
        containerName,
        workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        status: 'running'
      };

    } catch (error) {
      console.error('Error creating workspace container:', error);
      throw new Error(`Failed to create workspace: ${error.message}`);
    }
  }

  async initializeProject(container, projectType, proxyMode = 'none') {
    const useProxy = proxyMode !== 'none';
    const activeProxyHost = proxyMode === 'security' ? this.squidProxyHost : this.proxyHost;
    console.log(`Starting project initialization for type: ${projectType}`);
    try {
      const commands = [
        'git init',
        'git config user.name "XaresAICoder User"',
        'git config user.email "user@xaresaicoder.local"'
      ];

      // Configure sudo to preserve proxy environment variables when THIS workspace uses proxy.
      // NODE_EXTRA_CA_CERTS must be kept too: `sudo npm install -g` otherwise loses the
      // proxy CA trust and fails TLS verification against the MITM proxy, silently
      // falling back to stale cached packages. (update_ai_agents needs no sudo.)
      if (useProxy) {
        commands.push('echo "Defaults env_keep += \\"HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy NODE_EXTRA_CA_CERTS\\"" | sudo tee /etc/sudoers.d/proxy > /dev/null');
        commands.push('sudo chmod 440 /etc/sudoers.d/proxy');

        // Parse proxy host and port from activeProxyHost (format: "host:port")
        const [proxyHostName, proxyPort] = activeProxyHost.split(':');

        // Configure Maven to use proxy and official repositories only
        commands.push('mkdir -p ~/.m2');
        commands.push('cat > ~/.m2/settings.xml << "EOF"\n' +
          '<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0"\n' +
          '          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
          '          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.2.0 \n' +
          '                              https://maven.apache.org/xsd/settings-1.2.0.xsd">\n' +
          '  <proxies>\n' +
          '    <proxy>\n' +
          '      <id>workspace-proxy</id>\n' +
          '      <active>true</active>\n' +
          '      <protocol>http</protocol>\n' +
          `      <host>${proxyHostName}</host>\n` +
          `      <port>${proxyPort}</port>\n` +
          '      <nonProxyHosts>localhost|127.0.0.1|forgejo</nonProxyHosts>\n' +
          '    </proxy>\n' +
          '  </proxies>\n' +
          '  <mirrors>\n' +
          '    <!-- Use official Maven Central only (whitelisted in proxy) -->\n' +
          '    <mirror>\n' +
          '      <id>maven-central</id>\n' +
          '      <mirrorOf>central</mirrorOf>\n' +
          '      <name>Maven Central</name>\n' +
          '      <url>https://repo.maven.apache.org/maven2</url>\n' +
          '    </mirror>\n' +
          '  </mirrors>\n' +
          '</settings>\n' +
          'EOF');

        // Configure Gradle to use proxy (gradle.properties)
        commands.push('mkdir -p ~/.gradle');
        commands.push('cat > ~/.gradle/gradle.properties << "EOF"\n' +
          `systemProp.http.proxyHost=${proxyHostName}\n` +
          `systemProp.http.proxyPort=${proxyPort}\n` +
          'systemProp.http.nonProxyHosts=localhost|127.0.0.1|forgejo\n' +
          `systemProp.https.proxyHost=${proxyHostName}\n` +
          `systemProp.https.proxyPort=${proxyPort}\n` +
          'systemProp.https.nonProxyHosts=localhost|127.0.0.1|forgejo\n' +
          'EOF');

        // Configure npm to trust proxy CA certificate (speeds up package installs)
        commands.push('npm config set cafile /usr/local/share/ca-certificates/squid-ca.crt');

        // Configure Gradle to use official repositories only (init.gradle)
        commands.push('cat > ~/.gradle/init.gradle << "EOF"\n' +
          '// Global Gradle configuration: Use official repositories only (whitelisted in proxy)\n' +
          'allprojects {\n' +
          '    buildscript {\n' +
          '        repositories {\n' +
          '            // Remove any configured repositories and use only whitelisted ones\n' +
          '            clear()\n' +
          '            mavenCentral()  // Official Maven Central\n' +
          '            google()        // Official Google Maven\n' +
          '        }\n' +
          '    }\n' +
          '    repositories {\n' +
          '        // Remove any configured repositories and use only whitelisted ones\n' +
          '        clear()\n' +
          '        mavenCentral()  // Official Maven Central\n' +
          '        google()        // Official Google Maven\n' +
          '    }\n' +
          '}\n' +
          'EOF');
      }

      // Add Git remote configuration if repository was created (only when NOT cloning)
      // For git-clone with createGitRepo, we'll set up remotes after cloning
      commands.push('if [ -n "$GIT_REPO_NAME" ] && [ -n "$GIT_REMOTE_URL" ] && [ -z "$GIT_CLONE_URL" ]; then echo "Configuring Git remote for repository: $GIT_REPO_NAME"; git remote add origin "$GIT_REMOTE_URL"; git branch -M main; fi');

      if (projectType === 'empty' || projectType === 'python-flask' || projectType === 'node-react' || projectType === 'java-spring') {
        console.log(`Adding empty project setup commands (legacy type: ${projectType})`);
        commands.push('setup_empty_project');
        // Note: Legacy template types (python-flask, node-react, java-spring) now default to empty project
      } else if (projectType === 'git-clone') {
        console.log('Adding Git repository cloning commands');
        // Create a single comprehensive command for Git cloning to avoid bash syntax issues
        const gitCloneScript = `
if [ -n "$GIT_CLONE_URL" ]; then
  echo "Cloning Git repository: $GIT_CLONE_URL"

  # Clean workspace completely (git clone needs empty directory)
  find /workspace -mindepth 1 -delete 2>/dev/null || true

  # For public repositories: simple clone without authentication
  # For private repositories: embed credentials in URL only if provided
  if [ -n "$GIT_ACCESS_TOKEN" ] && [ -n "$GIT_USERNAME" ]; then
    # Private repository with username and token
    PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|://.*||')
    URL_WITHOUT_PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|^[^:]*://||')
    CLONE_URL="\${PROTOCOL}://\${GIT_USERNAME}:\${GIT_ACCESS_TOKEN}@\${URL_WITHOUT_PROTOCOL}"
    echo "Cloning private repository with authentication for $GIT_USERNAME"
  elif [ -n "$GIT_ACCESS_TOKEN" ]; then
    # Private repository with token only
    PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|://.*||')
    URL_WITHOUT_PROTOCOL=$(echo "$GIT_CLONE_URL" | sed 's|^[^:]*://||')
    CLONE_URL="\${PROTOCOL}://\${GIT_ACCESS_TOKEN}@\${URL_WITHOUT_PROTOCOL}"
    echo "Cloning private repository with token authentication"
  else
    # Public repository - use URL as-is
    CLONE_URL="$GIT_CLONE_URL"
    echo "Cloning public repository (no authentication required)"
  fi

  # Clone directly into workspace directory
  if git clone "\$CLONE_URL" /workspace; then
    cd /workspace
    echo "✅ Repository cloned successfully to /workspace"

    # Configure Git user for this repository
    git config user.name "XaresAICoder User"
    git config user.email "user@xaresaicoder.local"

    # Set up dual remotes if local Forgejo repository was also created
    if [ -n "$GIT_REPO_NAME" ] && [ -n "$GIT_REMOTE_URL" ]; then
      echo "🔀 Setting up dual remotes (local Forgejo + external repo)"

      # Rename cloned 'origin' to 'github' for external repo
      if git remote rename origin github 2>/dev/null; then
        echo "✅ External repo configured as 'github' remote"
      fi

      # Add local Forgejo as 'origin' (main remote)
      if git remote add origin "$GIT_REMOTE_URL" 2>/dev/null; then
        echo "✅ Local Forgejo configured as 'origin' remote"

        # Push all branches to local Forgejo
        if git push -u origin --all 2>/dev/null; then
          echo "✅ Pushed branches to local Forgejo"
        fi

        # Push tags if any exist
        if [ -n "$(git tag)" ]; then
          git push origin --tags 2>/dev/null && echo "✅ Pushed tags to local Forgejo"
        fi

        echo "📋 Git remotes configured:"
        git remote -v | sed -E 's#(://)[^/@[:space:]]+@#\\1***@#'
      else
        echo "⚠️  Failed to add local Forgejo remote"
      fi
    else
      # Only set up persistent credentials for private repositories (single remote mode)
      if [ -n "$GIT_ACCESS_TOKEN" ]; then
        git remote set-url origin "\$CLONE_URL"
        echo "✅ Remote URL configured with credentials for future git operations"
      fi
    fi

    echo "Repository contents:"
    git status --short || true
  else
    echo "❌ Failed to clone repository: $GIT_CLONE_URL"
    echo "The workspace will start with an empty project instead."
  fi
fi`.trim();
        commands.push(gitCloneScript);
      }

      // Note: No automatic push - template files are not committed
      // Users can commit and push their initial files when ready

      // Run commands as root but set proper ownership afterward
      for (const cmd of commands) {
        console.log(`Executing: ${cmd}`);
        const fullCmd = `source /home/coder/.bashrc && cd /workspace && ${cmd}`;
        
        const exec = await container.exec({
          Cmd: ['bash', '-c', fullCmd],
          AttachStdout: true,
          AttachStderr: true,
          Env: ['HOME=/home/coder', 'USER=coder'] // Git env vars are already in container env
        });
        
        const stream = await exec.start();
        const output = await this.streamToString(stream);
        console.log(`Command output: ${output.trim()}`);
      }
      
      // Fix ownership of created files
      const chownExec = await container.exec({
        Cmd: ['chown', '-R', 'coder:coder', '/workspace'],
        AttachStdout: true,
        AttachStderr: true
      });
      await chownExec.start();
      console.log('Project initialization completed successfully');
    } catch (error) {
      console.error('Error initializing project:', error);
      // Don't throw here, as the container is already created
    }
  }

  async waitForWorkspaceReady(containerName, maxWaitTime = 15000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    console.log(`Waiting for workspace ${containerName} to be ready...`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const container = this.docker.getContainer(containerName);
        
        // Simple approach: just check if we can execute curl successfully
        const exec = await container.exec({
          Cmd: ['/usr/bin/curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', 'http://localhost:8082/', '--max-time', '3'],
          AttachStdout: true,
          AttachStderr: false
        });
        
        const stream = await exec.start({ hijack: true, stdin: false });
        const result = await this.streamToString(stream);
        
        console.log(`Health check result: "${result.trim()}"`);
        
        // Any valid HTTP response code means the server is responding
        const httpCode = result.trim();
        if (httpCode && (httpCode.includes('302') || httpCode.includes('200') || httpCode.match(/[2-5]\d{2}/))) {
          console.log(`Workspace ${containerName} is ready! (HTTP ${httpCode})`);
          return true;
        }
      } catch (error) {
        console.log(`Health check attempt failed: ${error.message}`);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.warn(`Workspace ${containerName} not ready after ${maxWaitTime}ms, proceeding anyway`);
    return false;
  }

  // nginx resolves the workspace name through Docker's DNS when it proxies a
  // request. The API server shares no network with workspaces, so the lookup
  // runs inside the nginx container.
  async waitForDnsReady(containerName, maxWaitTime = 10000) {
    const nginx = this.docker.getContainer(this.nginxContainerName);
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const exec = await nginx.exec({
          Cmd: ['getent', 'hosts', containerName],
          AttachStdout: true,
          AttachStderr: true
        });
        await this.streamToString(await exec.start({}));
        const { ExitCode } = await exec.inspect();
        if (ExitCode === 0) {
          console.log(`DNS resolved for ${containerName}`);
          return true;
        }
      } catch {
        // nginx not running (yet): retry until the deadline
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.warn(`DNS for ${containerName} not ready after ${maxWaitTime}ms, proceeding anyway`);
    return false;
  }

  async streamToString(stream) {
    return new Promise((resolve, reject) => {
      let data = '';
      stream.on('data', chunk => {
        data += chunk.toString();
      });
      stream.on('end', () => {
        resolve(data);
      });
      stream.on('error', reject);
    });
  }

  async ensureCodeServerImage() {
    try {
      await this.docker.getImage(this.codeServerImage).inspect();
    } catch (error) {
      // Image doesn't exist, need to build it
      console.log(`Building code-server image: ${this.codeServerImage}...`);
      // In a real implementation, you would build from the Dockerfile
      // For now, we'll use the official code-server image as fallback
      throw new Error(`Code-server image not found: ${this.codeServerImage}. Please build the image first with: docker build -t ${this.codeServerImage} ./code-server`);
    }
  }

  async getContainerDiskUsage(projectId) {
    const containerName = `workspace-${projectId}`;

    try {
      const container = this.docker.getContainer(containerName);

      // Use Docker's native container inspect with size information
      // This is much more reliable than executing du commands inside containers
      const containerInfo = await container.inspect({ size: true });

      if (containerInfo.SizeRw !== undefined) {
        // SizeRw = size of the writable layer (user data)
        // SizeRootFs = total size including read-only layers (base image + user data)
        // For workspace usage, SizeRw is most relevant as it represents user-created data
        const userDataSize = containerInfo.SizeRw || 0;
        const totalSize = containerInfo.SizeRootFs || 0;

        return {
          bytes: userDataSize,
          totalBytes: totalSize,
          readable: this.formatBytes(userDataSize),
          totalReadable: this.formatBytes(totalSize)
        };
      }

      // Fallback if size information is not available
      return {
        bytes: 0,
        totalBytes: 0,
        readable: 'Unknown',
        totalReadable: 'Unknown'
      };

    } catch (error) {
      console.error(`Error getting disk usage for container ${containerName}:`, error.message);
      return {
        bytes: 0,
        totalBytes: 0,
        readable: 'Unknown',
        totalReadable: 'Unknown'
      };
    }
  }

  async getAllWorkspaceContainerSizes() {
    try {
      // Get all containers with size information in a single API call
      // Much more efficient than calling inspect on each container individually
      const containers = await this.docker.listContainers({
        all: true,
        size: true,
        filters: {
          name: ['workspace-']  // Only get workspace containers
        }
      });

      const sizeMap = new Map();

      containers.forEach(container => {
        // Extract project ID from container name (format: workspace-{projectId})
        const containerName = container.Names[0]?.replace(/^\//, ''); // Remove leading slash
        const projectIdMatch = containerName?.match(/^workspace-(.+)$/);

        if (projectIdMatch) {
          const projectId = projectIdMatch[1];
          const userDataSize = container.SizeRw || 0;
          const totalSize = container.SizeRootFs || 0;

          sizeMap.set(projectId, {
            bytes: userDataSize,
            totalBytes: totalSize,
            readable: this.formatBytes(userDataSize),
            totalReadable: this.formatBytes(totalSize)
          });
        }
      });

      return sizeMap;
    } catch (error) {
      console.error('Error getting batch container sizes:', error.message);
      return new Map();
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';

    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);

    // For sizes >= 1GB, show 1 decimal place
    // For sizes < 1GB, show appropriate precision
    if (i >= 3) {
      return size.toFixed(1) + ' ' + sizes[i];
    } else if (i >= 2) {
      return size.toFixed(size < 10 ? 1 : 0) + ' ' + sizes[i];
    } else {
      return Math.round(size) + ' ' + sizes[i];
    }
  }

  async getAllProjectStatuses() {
    try {
      // Get all containers and filter manually (Docker filter syntax can be tricky)
      const containers = await this.docker.listContainers({
        all: true
      });

      const statusMap = new Map();

      containers.forEach(container => {
        const containerName = container.Names[0]?.replace(/^\//, '');

        // Only process workspace containers
        if (!containerName?.startsWith('workspace-')) {
          return;
        }

        const projectIdMatch = containerName.match(/^workspace-(.+)$/);

        if (projectIdMatch) {
          const projectId = projectIdMatch[1];
          const isRunning = container.State === 'running';
          const status = isRunning ? 'running' : 'stopped';

          statusMap.set(projectId, {
            projectId,
            status,
            workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
            createdAt: new Date(container.Created * 1000),
            projectType: 'unknown', // Will be preserved from stored data
            containerInfo: {
              running: isRunning,
              state: container.State,
              status: container.Status
            }
          });
        }
      });

      console.log(`Found ${statusMap.size} workspace containers`);
      return statusMap;
    } catch (error) {
      console.error('Error getting batch container statuses:', error);
      return new Map();
    }
  }

  async getProjectStatus(projectId) {
    const containerName = `workspace-${projectId}`;

    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      const isRunning = containerInfo.State.Running;
      const status = isRunning ? 'running' : 'stopped';

      // Update our in-memory cache if container exists
      if (!this.activeContainers.has(projectId)) {
        this.activeContainers.set(projectId, {
          container: container,
          createdAt: new Date(containerInfo.Created),
          projectType: this.extractProjectTypeFromEnv(containerInfo.Config.Env)
        });
      }

      const workspace = this.activeContainers.get(projectId);

      // Get disk usage for the container only if enabled
      const diskUsage = this.showDiskUsage ? await this.getContainerDiskUsage(projectId) : null;

      return {
        projectId,
        status,
        workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        createdAt: workspace.createdAt,
        projectType: workspace.projectType,
        diskUsage: diskUsage,
        containerInfo: {
          running: isRunning,
          startedAt: containerInfo.State.StartedAt,
          finishedAt: containerInfo.State.FinishedAt,
          exitCode: containerInfo.State.ExitCode
        }
      };
    } catch (error) {
      // Container doesn't exist
      if (error.statusCode === 404) {
        return { status: 'not_found' };
      }
      console.error(`Error inspecting container for project ${projectId}:`, error);
      return { status: 'error', error: error.message };
    }
  }

  // Helper method to extract project type from container environment variables
  extractProjectTypeFromEnv(envArray) {
    const projectTypeVar = envArray.find(env => env.startsWith('PROJECT_TYPE='));
    return projectTypeVar ? projectTypeVar.split('=')[1] : 'unknown';
  }

  // Get workspace container IP address on its proxy network (for proxy logs filtering)
  async getWorkspaceIPAddress(projectId) {
    const containerName = `workspace-${projectId}`;

    try {
      const container = this.docker.getContainer(containerName);
      const inspectData = await container.inspect();

      const networks = inspectData.NetworkSettings.Networks || {};
      const proxyNetwork = networks[this.proxyNetwork] || networks[this.securityNetwork];

      return proxyNetwork ? proxyNetwork.IPAddress : null;
    } catch (error) {
      console.error(`Error getting IP address for project ${projectId}:`, error);
      return null;
    }
  }

  /**
   * Get projectId from container IP address (reverse lookup)
   * Used for mapping LLM conversation logs to projects
   */
  async getProjectIdFromIP(ipAddress) {
    try {
      const containers = await this.docker.listContainers({ all: true });

      for (const container of containers) {
        const containerName = container.Names[0]?.replace(/^\//, '');
        if (!containerName?.startsWith('workspace-')) continue;

        const projectIdMatch = containerName.match(/^workspace-(.+)$/);
        if (!projectIdMatch) continue;

        const projectId = projectIdMatch[1];
        const containerIP = await this.getWorkspaceIPAddress(projectId);

        if (containerIP === ipAddress) {
          return projectId;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error mapping IP ${ipAddress} to projectId:`, error);
      return null;
    }
  }

  // Gives a new workspace a clean slate at its (possibly reused) IP: clears
  // recorded domains and archives captured LLM conversations left by an
  // earlier workspace. Non-fatal: logging must never block creation.
  async resetProxyLogsForWorkspace(projectId) {
    try {
      const ip = await this.getWorkspaceIPAddress(projectId);
      if (ip) await this.resetProxyLogsForIp(ip);
    } catch (e) {
      console.warn(`Could not reset proxy logs for ${projectId}: ${e.message}`);
    }
  }

  async resetProxyLogsForIp(ip) {
    await this.clearRecordedDomains(ip);
    await this.archiveLLMConversations(ip);
  }

  // Moves the conversations stored under an IP to llm_conversations/_archive/
  // (not served by the API) instead of deleting them: the IP may have been
  // released by a *stopped* workspace whose owner still wants its captures.
  async archiveLLMConversations(ipAddress) {
    const containers = await this.docker.listContainers();
    const mitmproxyContainer = containers.find(c =>
      c.Names.some(name => name.includes('mitmproxy-logger'))
    );
    if (!mitmproxyContainer) return;

    const container = this.docker.getContainer(mitmproxyContainer.Id);
    const exec = await container.exec({
      Cmd: ['sh', '-c',
        'd=/var/log/mitmproxy/llm_conversations; [ -d "$d/$1" ] || exit 0; ' +
        'mkdir -p "$d/_archive" && mv "$d/$1" "$d/_archive/$1-$(date -u +%Y%m%dT%H%M%SZ)" && echo archived',
        'sh', ipAddress],
      AttachStdout: true,
      AttachStderr: true
    });
    const output = await this.streamToString(await exec.start());
    if (output.includes('archived')) {
      console.log(`Archived LLM conversations previously stored for IP ${ipAddress}`);
    }
  }

  /**
   * Get LLM conversations for workspace by IP address
   * Reads JSON conversation logs from mitmproxy logger
   */
  async getLLMConversationsForWorkspace(ipAddress, limit = 100, offset = 0, filters = {}) {
    try {
      const containers = await this.docker.listContainers();
      const mitmproxyContainer = containers.find(c =>
        c.Names.some(name => name.includes('mitmproxy-logger'))
      );

      if (!mitmproxyContainer) {
        console.error('mitmproxy container not found');
        return [];
      }

      const container = this.docker.getContainer(mitmproxyContainer.Id);

      // List JSON files in workspace directory, sorted by timestamp
      const exec = await container.exec({
        Cmd: ['bash', '-c',
          `find /var/log/mitmproxy/llm_conversations/${ipAddress} -name "*.json" -type f 2>/dev/null | sort -r | head -n ${limit + offset} | tail -n ${limit}`
        ],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      const output = await this.streamToString(stream);
      const files = output.trim().split('\n').filter(f => f);

      // Read and parse each file
      const conversations = [];
      for (const file of files) {
        const readExec = await container.exec({
          Cmd: ['cat', file],
          AttachStdout: true,
          AttachStderr: true
        });

        const readStream = await readExec.start();
        const content = await this.streamToString(readStream);

        try {
          const conversation = redactConversation(JSON.parse(content));
          // File name (without .json) – needed to delete WebSocket captures,
          // whose file name differs from their timestamp.
          conversation._file = file.split('/').pop().replace(/\.json$/, '');

          // Apply filters if provided
          if (filters.model && conversation.parsed_request?.model !== filters.model) {
            continue;
          }
          if (filters.dateFrom && conversation.timestamp < filters.dateFrom) {
            continue;
          }
          if (filters.dateTo && conversation.timestamp > filters.dateTo) {
            continue;
          }

          conversations.push(conversation);
        } catch (parseError) {
          console.error(`Failed to parse ${file}:`, parseError);
        }
      }

      return conversations;

    } catch (error) {
      console.error('Error reading LLM conversations:', error);
      return [];
    }
  }

  async getMitmproxyContainer() {
    const containers = await this.docker.listContainers();
    const info = containers.find(c => c.Names.some(name => name.includes('mitmproxy-logger')));
    return info ? this.docker.getContainer(info.Id) : null;
  }

  async execToString(container, cmd) {
    const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
    return this.streamToString(await exec.start());
  }

  /**
   * Summaries of a workspace's LLM captures, newest first:
   * { conversations: [summary], total }. Reads each capture once and keeps the
   * summary in memory until the file changes.
   */
  async getLLMConversationSummaries(ipAddress, limit = 50, offset = 0, filters = {}) {
    try {
      const container = await this.getMitmproxyContainer();
      if (!container) {
        console.error('mitmproxy container not found');
        return { conversations: [], total: 0 };
      }
      const dir = `/var/log/mitmproxy/llm_conversations/${ipAddress}`;
      const listing = await this.execToString(container, ['sh', '-c',
        `find ${dir} -maxdepth 1 -name "*.json" -type f -printf "%f %T@ %s\\n" 2>/dev/null | sort -r`]);
      const entries = listing.trim().split('\n').filter(Boolean).map(line => {
        const [name, mtime, size] = line.split(' ');
        return { name, mtime, size: Number(size) };
      });
      const page = entries.slice(offset, offset + limit);
      const conversations = [];
      for (const entry of page) {
        const key = `${ipAddress}/${entry.name}`;
        const stamp = `${entry.mtime}:${entry.size}`;
        let cached = this.conversationSummaries.get(key);
        if (!cached || cached.stamp !== stamp) {
          const content = await this.execToString(container, ['cat', `${dir}/${entry.name}`]);
          let summary;
          try {
            summary = summarizeConversation(JSON.parse(content), entry.name.replace(/\.json$/, ''), entry.size);
          } catch (parseError) {
            console.error(`Failed to parse ${key}:`, parseError.message);
            continue;
          }
          cached = { stamp, summary };
          this.conversationSummaries.set(key, cached);
          if (this.conversationSummaries.size > 5000) {
            this.conversationSummaries.delete(this.conversationSummaries.keys().next().value);
          }
        }
        const s = cached.summary;
        if (filters.model && s.model !== filters.model) continue;
        if (filters.dateFrom && s.timestamp < filters.dateFrom) continue;
        if (filters.dateTo && s.timestamp > filters.dateTo) continue;
        conversations.push(s);
      }
      return { conversations, total: entries.length };
    } catch (error) {
      console.error('Error reading LLM conversation summaries:', error);
      return { conversations: [], total: 0 };
    }
  }

  /**
   * One complete LLM capture (credentials redacted), or null if it does not
   * exist. `file` is the capture file name without .json (checked by the route).
   */
  async getLLMConversation(ipAddress, file) {
    const container = await this.getMitmproxyContainer();
    if (!container) return null;
    const path = `/var/log/mitmproxy/llm_conversations/${ipAddress}/${file}.json`;
    const content = await this.execToString(container, ['sh', '-c', `test -f "$1" && cat "$1"`, 'sh', path]);
    if (!content.trim()) return null;
    const conversation = redactConversation(JSON.parse(content));
    conversation._file = file;
    return conversation;
  }

  forgetConversationSummaries(ipAddress, file = null) {
    const prefix = `${ipAddress}/`;
    for (const key of [...this.conversationSummaries.keys()]) {
      if (file ? key === `${prefix}${file}.json` : key.startsWith(prefix)) {
        this.conversationSummaries.delete(key);
      }
    }
  }

  /**
   * Get recorded domains for a workspace by IP address
   * Reads domain tracking JSON from mitmproxy logger
   */
  async getRecordedDomainsForWorkspace(ipAddress) {
    try {
      const containers = await this.docker.listContainers();
      const mitmproxyContainer = containers.find(c =>
        c.Names.some(name => name.includes('mitmproxy-logger'))
      );

      if (!mitmproxyContainer) {
        console.error('mitmproxy container not found');
        return {};
      }

      const container = this.docker.getContainer(mitmproxyContainer.Id);

      const exec = await container.exec({
        Cmd: ['cat', `/var/log/mitmproxy/domains/${ipAddress}.json`],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      const output = await this.streamToString(stream);

      if (!output.trim()) {
        return {};
      }

      return JSON.parse(output);
    } catch (error) {
      console.error('Error reading recorded domains:', error);
      return {};
    }
  }

  /**
   * Categorize domains by known patterns for display
   */
  categorizeDomainsForDisplay(domains) {
    const categories = {
      'Package Managers': [],
      'AI APIs': [],
      'Documentation': [],
      'Version Control': [],
      'System': [],
      'Other': []
    };

    const patterns = {
      'Package Managers': [
        'pypi.org', 'pythonhosted.org', 'npmjs.org', 'npmjs.com', 'yarnpkg.com',
        'registry.npmjs.org', 'maven.org', 'maven.apache.org', 'repo.maven.apache.org',
        'dl.google.com', 'maven.google.com', 'jitpack.io', 'repo.spring.io',
        'rubygems.org', 'crates.io', 'pkg.go.dev', 'proxy.golang.org',
        'packagist.org', 'nuget.org', 'hex.pm', 'pub.dev',
        'open-vsx.org', 'openvsx.org', 'eclipsecontent.org'
      ],
      'AI APIs': [
        'openai.com', 'anthropic.com', 'googleapis.com', 'google.dev',
        'opencode.ai', 'huggingface.co', 'ollama.ai', 'ollama.com',
        'z.ai', 'api.z.ai', 'cohere.ai', 'mistral.ai',
        'githubcopilot.com', 'kilo.ai', 'cline.bot'
      ],
      'Documentation': [
        'docs.python.org', 'developer.mozilla.org', 'nodejs.org',
        'stackoverflow.com', 'stackexchange.com', 'readthedocs.io',
        'readthedocs.org', 'docs.rs', 'doc.rust-lang.org',
        'devdocs.io', 'w3schools.com'
      ],
      'Version Control': [
        'github.com', 'githubusercontent.com', 'gitlab.com', 'bitbucket.org',
        'forgejo', 'gitea.io', 'codeberg.org'
      ],
      'System': [
        'debian.org', 'ubuntu.com', 'nodesource.com', 'apache.org',
        'cloudflare.com', 'akamaihd.net', 'fastly.net'
      ]
    };

    for (const [domain, data] of Object.entries(domains)) {
      let categorized = false;
      for (const [category, domainPatterns] of Object.entries(patterns)) {
        if (domainPatterns.some(p => domain === p || domain.endsWith('.' + p))) {
          categories[category].push({ domain, ...data });
          categorized = true;
          break;
        }
      }
      if (!categorized) {
        categories['Other'].push({ domain, ...data });
      }
    }

    // Remove empty categories
    for (const key of Object.keys(categories)) {
      if (categories[key].length === 0) {
        delete categories[key];
      }
    }

    return categories;
  }

  /**
   * Delete all LLM conversations for a workspace
   */
  async deleteAllLLMConversations(ipAddress) {
    this.forgetConversationSummaries(ipAddress);
    try {
      const containers = await this.docker.listContainers();
      const mitmproxyContainer = containers.find(c =>
        c.Names.some(name => name.includes('mitmproxy-logger'))
      );

      if (!mitmproxyContainer) {
        throw new Error('mitmproxy container not found');
      }

      const container = this.docker.getContainer(mitmproxyContainer.Id);

      // Delete the entire workspace directory
      const exec = await container.exec({
        Cmd: ['rm', '-rf', `/var/log/mitmproxy/llm_conversations/${ipAddress}`],
        AttachStdout: true,
        AttachStderr: true
      });

      await exec.start();

      console.log(`Deleted all LLM conversations for IP ${ipAddress}`);

    } catch (error) {
      console.error('Error deleting all LLM conversations:', error);
      throw error;
    }
  }

  /**
   * Clear recorded domain data for a workspace IP
   */
  async clearRecordedDomains(ipAddress) {
    try {
      const containers = await this.docker.listContainers();
      const mitmproxyContainer = containers.find(c =>
        c.Names.some(name => name.includes('mitmproxy-logger'))
      );

      if (!mitmproxyContainer) return;

      const container = this.docker.getContainer(mitmproxyContainer.Id);
      const exec = await container.exec({
        Cmd: ['rm', '-f', `/var/log/mitmproxy/domains/${ipAddress}.json`],
        AttachStdout: true,
        AttachStderr: true
      });
      await exec.start();

      console.log(`Cleared recorded domains for IP ${ipAddress}`);
    } catch (error) {
      console.error('Error clearing recorded domains:', error);
    }
  }

  /**
   * Delete a specific LLM conversation file
   */
  async deleteLLMConversation(ipAddress, timestamp) {
    this.forgetConversationSummaries(ipAddress, timestamp);
    try {
      const containers = await this.docker.listContainers();
      const mitmproxyContainer = containers.find(c =>
        c.Names.some(name => name.includes('mitmproxy-logger'))
      );

      if (!mitmproxyContainer) {
        throw new Error('mitmproxy container not found');
      }

      const container = this.docker.getContainer(mitmproxyContainer.Id);

      // Delete the specific conversation file
      const filename = `${timestamp}.json`;
      const exec = await container.exec({
        Cmd: ['rm', '-f', `/var/log/mitmproxy/llm_conversations/${ipAddress}/${filename}`],
        AttachStdout: true,
        AttachStderr: true
      });

      await exec.start();

      console.log(`Deleted LLM conversation ${filename} for IP ${ipAddress}`);

    } catch (error) {
      console.error('Error deleting LLM conversation:', error);
      throw error;
    }
  }

  // Helper method to convert Docker exec stream to string
  async streamToString(stream) {
    return new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];

      // Demultiplex Docker stream (removes 8-byte headers)
      this.docker.modem.demuxStream(stream,
        {
          write: (chunk) => stdout.push(chunk)
        },
        {
          write: (chunk) => stderr.push(chunk)
        }
      );

      stream.on('end', () => {
        const output = Buffer.concat(stdout).toString('utf8');
        resolve(output);
      });
      stream.on('error', reject);
    });
  }

  // Parse squid log format into structured data
  parseSquidLogs(logText) {
    // Squid log format: %ts.%03tu %6tr %>a %Ss/%03>Hs %<st %rm %ru %[un %Sh/%<a %mt
    // Example: 1638360000.123 100 172.30.0.3 TCP_MISS/200 1234 GET http://example.com/path - HIER_DIRECT/93.184.216.34 text/html
    return logText.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/);
        if (parts.length < 7) {
          return {
            rawLine: line,
            timestamp: null,
            duration: null,
            clientIP: null,
            status: null,
            bytes: null,
            method: null,
            url: null
          };
        }
        return {
          timestamp: parts[0],
          duration: parts[1],
          clientIP: parts[2],
          status: parts[3],
          bytes: parts[4],
          method: parts[5],
          url: parts[6],
          rawLine: line
        };
      });
  }

  // Get squid logs filtered by workspace IP address
  // `since` (Date) hides lines from an earlier workspace that had this IP
  async getSquidLogsForWorkspace(ipAddress, lines = 50, since = null) {
    try {
      // Find squid container dynamically (more robust than hardcoding name)
      const containers = await this.docker.listContainers();
      const squidContainerInfo = containers.find(c =>
        c.Names.some(name => name.includes('squid-proxy'))
      );

      if (!squidContainerInfo) {
        console.error('Squid proxy container not found');
        return [];
      }

      const squidContainer = this.docker.getContainer(squidContainerInfo.Id);

      // Execute command to read and filter logs
      // Field 3 of the 'detailed' logformat is the client IP. Exact match, so
      // 172.30.0.1 does not also return 172.30.0.10–19 and 172.30.0.100+.
      // Field 1 is the epoch timestamp.
      const sinceEpoch = since ? Math.floor(new Date(since).getTime() / 1000) || 0 : 0;
      const exec = await squidContainer.exec({
        Cmd: ['sh', '-c', 'tail -n 5000 /var/log/squid/access.log | awk -v ip="$1" -v since="$3" \'$3 == ip && $1 + 0 >= since + 0\' | tail -n "$2"',
          'sh', ipAddress, String(lines), String(sinceEpoch)],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start();
      const output = await this.streamToString(stream);

      // Parse squid logs
      return this.parseSquidLogs(output);
    } catch (error) {
      console.error('Error reading squid logs:', error);
      return [];
    }
  }

  async startWorkspace(projectId, proxyMode = 'none', proxyIp = null) {
    const containerName = `workspace-${projectId}`;

    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();

      if (containerInfo.State.Running) {
        return { success: true, message: 'Workspace is already running' };
      }

      // Reattach if its network was recreated, move it if it is on the wrong one
      try {
        await this.ensureWorkspaceNetwork(containerName, proxyMode, proxyIp);
      } catch (error) {
        throw new Error(`Network recovery failed: ${error.message}`);
      }

      await container.start();

      // Update our in-memory cache
      this.activeContainers.set(projectId, {
        container: container,
        name: containerName,
        createdAt: new Date(containerInfo.Created),
        projectType: this.extractProjectTypeFromEnv(containerInfo.Config.Env)
      });

      // Wait for workspace to be ready after starting
      await this.waitForWorkspaceReady(containerName);
      // Wait for DNS to propagate so nginx can resolve the container name
      await this.waitForDnsReady(containerName);

      return {
        success: true,
        message: 'Workspace started successfully',
        status: 'running'
      };
    } catch (error) {
      // Docker also answers 404 for a missing network, which is not this case
      if (error.statusCode === 404 && /no such container/i.test(error.message)) {
        throw new Error('Workspace container not found');
      }
      console.error(`Error starting workspace ${projectId}:`, error);
      throw new Error(`Failed to start workspace: ${error.message}`);
    }
  }

  // Create a minimal tar archive containing a single file (for putArchive API)
  createTarWithFile(filename, content) {
    const contentBuffer = Buffer.from(content, 'utf-8');
    const fileSize = contentBuffer.length;

    // Tar header is 512 bytes
    const header = Buffer.alloc(512, 0);

    // File name (first 100 bytes)
    header.write(filename, 0, Math.min(filename.length, 100), 'utf-8');

    // File mode: 0644
    header.write('0000644\0', 100, 8, 'utf-8');

    // Owner UID: 1000 (coder user)
    header.write('0001750\0', 108, 8, 'utf-8');

    // Group GID: 1000 (coder group)
    header.write('0001750\0', 116, 8, 'utf-8');

    // File size in octal
    header.write(fileSize.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');

    // Modification time
    const mtime = Math.floor(Date.now() / 1000);
    header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf-8');

    // Initialize checksum field with spaces (required for checksum calculation)
    header.write('        ', 148, 8, 'utf-8');

    // Type flag: '0' = regular file
    header.write('0', 156, 1, 'utf-8');

    // Calculate checksum (sum of all bytes in header, treating checksum field as spaces)
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');

    // Pad content to 512-byte boundary
    const paddingSize = (512 - (fileSize % 512)) % 512;
    const contentPadding = Buffer.alloc(paddingSize, 0);

    // End-of-archive marker (two 512-byte blocks of zeros)
    const endMarker = Buffer.alloc(1024, 0);

    return Buffer.concat([header, contentBuffer, contentPadding, endMarker]);
  }

  // Update workspace password by updating the code-server config.yaml and the auth override file.
  // If password is null, removes password protection; otherwise sets/updates it.
  async updateWorkspacePassword(projectId, password) {
    const containerName = `workspace-${projectId}`;
    const configPath = '/home/coder/.config/code-server/config.yaml';

    // Build new code-server config.yaml content
    // Password is single-quoted in YAML; internal single quotes are escaped by doubling ('')
    const yamlPassword = password ? password.replace(/'/g, "''") : '';
    const configContent = password
      ? `bind-addr: 0.0.0.0:8082\nauth: password\npassword: '${yamlPassword}'\ncert: false\ndisable-telemetry: true\ndisable-update-check: true\n`
      : `bind-addr: 0.0.0.0:8082\nauth: none\ncert: false\ndisable-telemetry: true\ndisable-update-check: true\n`;

    // Build the entrypoint auth override file content (secondary mechanism)
    let overrideContent;
    if (password) {
      const escapedPassword = password.replace(/'/g, "'\\''");
      overrideContent = `AUTH_FLAG=password\nexport PASSWORD='${escapedPassword}'\n`;
    } else {
      overrideContent = `AUTH_FLAG=none\nunset PASSWORD\n`;
    }

    try {
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();

      if (containerInfo.State.Running) {
        // Running container: update config.yaml and auth override file via exec, then stop+start
        // Both files are passed base64-encoded so no password content ever
        // reaches the shell (a heredoc could be terminated by the password).
        const b64Config = Buffer.from(configContent).toString('base64');
        const b64Override = Buffer.from(overrideContent).toString('base64');
        const writeCmd = [
          `echo '${b64Config}' | base64 -d > ${configPath}`,
          `echo '${b64Override}' | base64 -d > /home/coder/.code-server-auth`
        ].join(' && ');
        const exec = await container.exec({
          Cmd: ['bash', '-c', writeCmd],
          AttachStdout: true,
          AttachStderr: true
        });
        const stream = await exec.start();
        await this.streamToString(stream);

        // Stop and start the container so the new config takes effect
        await container.stop({ t: 10 });
        await container.start();

        // Wait for code-server to become ready
        await this.waitForWorkspaceReady(containerName, 15000);

        console.log(`Password updated for running container ${containerName}`);
        return { success: true, message: 'Password updated successfully' };
      } else {
        // Stopped container: write config.yaml and auth override file via putArchive
        const configTar = this.createTarWithFile('config.yaml', configContent);
        await container.putArchive(configTar, { path: '/home/coder/.config/code-server' });

        const authTar = this.createTarWithFile('.code-server-auth', overrideContent);
        await container.putArchive(authTar, { path: '/home/coder' });

        console.log(`Password config written to stopped container ${containerName}`);
        return { success: true, message: 'Password updated (will apply on next start)' };
      }

    } catch (error) {
      if (error.statusCode === 404) {
        console.log(`Container ${containerName} not found, password will apply on next creation`);
        return { success: true, message: 'Container not found, password stored for next start' };
      }
      console.error(`Error updating password for workspace ${projectId}:`, error);
      throw new Error(`Failed to update workspace password: ${error.message}`);
    }
  }

  /**
   * Commit a workspace container to a snapshot image for cloning.
   * Works on both running and stopped containers.
   */
  async commitContainer(projectId) {
    const containerName = `workspace-${projectId}`;
    const snapshotRepo = `clone-snapshot-${projectId}`;
    // Unique per clone batch: concurrent batches of the same source must not
    // share (and delete) each other's snapshot
    const snapshotTag = `raw-${Date.now()}`;
    const imageName = `${snapshotRepo}:${snapshotTag}`;

    const container = this.docker.getContainer(containerName);

    // Try docker commit first (faster, preserves layer history)
    try {
      await container.commit({
        repo: snapshotRepo,
        tag: snapshotTag,
        comment: `Snapshot for cloning workspace ${projectId}`,
        pause: true
      });
      console.log(`Created snapshot image: ${imageName} from container ${containerName}`);
      return imageName;
    } catch (commitError) {
      // commit can fail when the parent image layers are no longer present
      // (e.g. after the base image was rebuilt). Fall back to export → import,
      // which captures the live container filesystem as a flat image.
      console.warn(`docker commit failed for ${containerName}, trying export/import fallback: ${commitError.message}`);
    }

    try {
      const tarStream = await new Promise((resolve, reject) => {
        container.export((err, stream) => {
          if (err) reject(err);
          else resolve(stream);
        });
      });
      await new Promise((resolve, reject) => {
        this.docker.importImage(tarStream, { repo: snapshotRepo, tag: snapshotTag }, (err, stream) => {
          if (err) return reject(err);
          stream.resume();
          stream.on('end', resolve);
          stream.on('error', reject);
        });
      });
      console.log(`Created snapshot image via export/import: ${imageName} from container ${containerName}`);
      return imageName;
    } catch (error) {
      console.error(`Error creating snapshot from container ${containerName}:`, error);
      throw new Error(`Failed to create snapshot: ${error.message}`);
    }
  }

  // See CODEX_SANDBOX_DEFAULT_SCRIPT. Only needed with the default seccomp
  // profile; non-fatal.
  async ensureCodexSandboxDefault(container) {
    if (this.seccompMode !== 'default') return;
    try {
      const exec = await container.exec({
        Cmd: ['sh', '-c', CODEX_SANDBOX_DEFAULT_SCRIPT],
        User: 'coder',
        Env: ['HOME=/home/coder'],
        AttachStdout: true,
        AttachStderr: true
      });
      await this.streamToString(await exec.start());
    } catch (error) {
      console.warn(`Could not set Codex sandbox default: ${error.message}`);
    }
  }

  /**
   * Remove the source workspace's credentials from a raw clone snapshot.
   * Runs CLONE_CLEANUP_SCRIPT once in a throwaway container (as root, no
   * network) and commits the result. The commit also restores the base
   * image's entrypoint/cmd/user, which an export/import snapshot would lack.
   * Removes the raw snapshot; returns the sanitized image name.
   */
  async sanitizeSnapshot(rawImage, { keepAiLogins = false } = {}) {
    const [repo] = rawImage.split(':');
    const sanitizedTag = `clean-${Date.now()}`;
    const sanitizedImage = `${repo}:${sanitizedTag}`;

    let base = {};
    try {
      base = (await this.docker.getImage(this.codeServerImage).inspect()).Config || {};
    } catch (e) {
      console.warn(`Could not inspect base image ${this.codeServerImage}: ${e.message}`);
    }

    const temp = await this.docker.createContainer({
      Image: rawImage,
      Entrypoint: ['/bin/sh', '-c'],
      Cmd: [CLONE_CLEANUP_SCRIPT],
      User: 'root',
      Env: [`KEEP_AI_LOGINS=${keepAiLogins ? 1 : 0}`],
      HostConfig: { NetworkMode: 'none' }
    });
    try {
      await temp.start();
      const { StatusCode } = await temp.wait();
      const logs = (await temp.logs({ stdout: true, stderr: true })).toString('utf8');
      if (StatusCode !== 0 || !logs.includes('cleanup-done')) {
        throw new Error(`clone cleanup failed (exit ${StatusCode}): ${logs.slice(-500)}`);
      }
      // _query/_body: dockerode would otherwise send the options as query only
      await temp.commit({
        _query: { container: temp.id, repo, tag: sanitizedTag, comment: 'Sanitized clone snapshot' },
        _body: {
          Entrypoint: base.Entrypoint || ['/usr/local/bin/entrypoint.sh'],
          Cmd: base.Cmd || ['code-server', '--bind-addr', '0.0.0.0:8082', '--auth', 'none', '/workspace'],
          User: base.User || 'coder',
          WorkingDir: base.WorkingDir || '/workspace'
        }
      });
    } finally {
      await temp.remove({ force: true }).catch(() => {});
      await this.removeSnapshotImage(rawImage);
    }
    console.log(`Sanitized clone snapshot ${sanitizedImage} (AI logins ${keepAiLogins ? 'kept' : 'removed'})`);
    return sanitizedImage;
  }

  /**
   * Create a clone container from a committed snapshot image.
   * Similar to createWorkspaceContainer but uses the snapshot and skips project initialization.
   */
  async createCloneContainer(projectId, snapshotImage, options = {}) {
    try {
      const containerName = `workspace-${projectId}`;
      const port = await this.findAvailablePort(8080);

      const { useProxy, spec } = this.buildContainerSpec(projectId, {
        ...options,
        image: snapshotImage,
        projectType: 'clone',
        hostCapabilities: await this.getHostCapabilities()
      });
      // The snapshot's image config still carries the source's environment;
      // container env only overrides keys it sets, so blank out the rest
      const setKeys = new Set(spec.Env.map(e => e.split('=')[0]));
      for (const key of PLATFORM_ENV_KEYS) {
        if (!setKeys.has(key)) spec.Env.push(`${key}=`);
      }
      const container = await this.docker.createContainer(spec);

      await container.start();
      console.log(`Clone container ${containerName} started`);

      // Docker reuses IPs: drop proxy logs left by a previous workspace at this address
      if (useProxy) await this.resetProxyLogsForWorkspace(projectId);

      // Wait for code-server to be ready (no project initialization needed — filesystem is cloned)
      await this.waitForWorkspaceReady(containerName);
      await this.ensureCodexSandboxDefault(container);
      console.log(`Clone workspace ${containerName} is ready`);

      this.activeContainers.set(projectId, {
        container,
        name: containerName,
        port,
        createdAt: new Date(),
        projectType: 'clone'
      });

      return {
        projectId,
        containerName,
        workspaceUrl: `${this.protocol}://${projectId}.${this.baseDomain}${this.basePort !== '80' ? ':' + this.basePort : ''}/`,
        status: 'running'
      };

    } catch (error) {
      console.error('Error creating clone container:', error);
      throw new Error(`Failed to create clone: ${error.message}`);
    }
  }

  /**
   * Create a new branch in a clone workspace and push it to origin.
   * The clone already has the source's git remote (credentials baked into snapshot).
   * Non-throwing: returns false on error so clone still works without its own branch.
   */
  // Runs a bash script as the workspace user. Resolves { exitCode, output }.
  async execInWorkspace(projectId, script, args = []) {
    const container = this.docker.getContainer(`workspace-${projectId}`);
    const exec = await container.exec({
      Cmd: ['bash', '-c', script, 'bash', ...args],
      AttachStdout: true,
      AttachStderr: true,
      User: 'coder',
      WorkingDir: '/workspace',
      Env: ['HOME=/home/coder', 'USER=coder', 'GIT_TERMINAL_PROMPT=0']
    });
    const output = await this.streamToString(await exec.start({}));
    const { ExitCode } = await exec.inspect();
    return { exitCode: ExitCode, output: output.trim() };
  }

  // Remotes of /workspace that point to the platform's Forgejo:
  // [{ name, owner, repo }] (credentials are not returned)
  async listForgejoRemotes(projectId) {
    const { exitCode, output } = await this.execInWorkspace(projectId,
      'git -C /workspace rev-parse --git-dir >/dev/null 2>&1 || exit 0; git -C /workspace remote -v');
    if (exitCode !== 0) return [];
    const remotes = new Map();
    for (const line of output.split('\n')) {
      const m = /^(\S+)\s+https?:\/\/(?:[^@\s]+@)?forgejo:3000\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\s+\((?:fetch|push)\)$/.exec(line.trim());
      if (m) remotes.set(m[1], { name: m[1], owner: m[2], repo: m[3] });
    }
    return [...remotes.values()];
  }

  async setGitRemote(projectId, name, url) {
    const { exitCode, output } = await this.execInWorkspace(projectId,
      'git -C /workspace remote set-url "$1" "$2" 2>/dev/null || git -C /workspace remote add "$1" "$2"', [name, url]);
    if (exitCode !== 0) throw new Error(`Setting remote ${name} failed: ${output}`);
  }

  // Points origin at the clone's own repository and pushes all branches and
  // tags (nothing to push without commits). Returns false and logs why if
  // that fails.
  async pushToOwnRepo(projectId, url) {
    const { exitCode, output } = await this.execInWorkspace(projectId, [
      'cd /workspace 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1 || git init -q -b main /workspace || exit 3',
      'cd /workspace',
      'git remote set-url origin "$1" 2>/dev/null || git remote add origin "$1" || exit 4',
      'git rev-parse --verify HEAD >/dev/null 2>&1 || { echo "no commits to push"; exit 0; }',
      'git push -u origin --all 2>&1 && git push origin --tags 2>&1'
    ].join('\n'), [url]);
    if (exitCode !== 0) {
      console.warn(`Pushing workspace-${projectId} to its own repository failed (${exitCode}): ${output.replace(/\/\/[^@\s]+@/g, '//***@')}`);
      return false;
    }
    return true;
  }

  /**
   * Remove a snapshot image created by commitContainer.
   */
  async removeSnapshotImage(imageName) {
    try {
      const image = this.docker.getImage(imageName);
      await image.remove({ force: true });
      console.log(`Removed snapshot image: ${imageName}`);
    } catch (error) {
      console.error(`Failed to remove snapshot image ${imageName}:`, error.message);
    }
  }

  async stopWorkspaceContainer(projectId) {
    const containerName = `workspace-${projectId}`;
    
    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      
      if (!containerInfo.State.Running) {
        return { success: true, message: 'Workspace is already stopped' };
      }

      await container.stop({ t: 10 }); // 10 second timeout
      
      // Update our in-memory cache
      this.activeContainers.set(projectId, {
        container: container,
        name: containerName,
        createdAt: new Date(containerInfo.Created),
        projectType: this.extractProjectTypeFromEnv(containerInfo.Config.Env)
      });
      
      return { 
        success: true, 
        message: 'Workspace stopped successfully',
        status: 'stopped'
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error('Workspace container not found');
      }
      // Under heavy load Docker may give up waiting for the exit event
      // ("tried to kill container, but did not receive an exit event") while
      // the container stops anyway: look again before reporting a failure.
      if (await this.waitUntilStopped(containerName)) {
        console.warn(`Stopping workspace ${projectId} reported "${error.message}", but the container has stopped`);
        return { success: true, message: 'Workspace stopped successfully', status: 'stopped' };
      }
      console.error(`Error stopping workspace ${projectId}:`, error);
      throw new Error(`Failed to stop workspace: ${error.message}`);
    }
  }

  // True once the container no longer runs (checked every 2 s up to maxWait)
  async waitUntilStopped(containerName, maxWait = 30000) {
    const deadline = Date.now() + maxWait;
    for (;;) {
      try {
        const info = await this.docker.getContainer(containerName).inspect();
        if (!info.State.Running) return true;
      } catch (error) {
        if (error.statusCode === 404) return true;
      }
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  async stopWorkspace(projectId) {
    const containerName = `workspace-${projectId}`;
    
    try {
      // Try to get container by name from Docker API
      const container = this.docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      
      if (containerInfo.State.Running) {
        await container.stop();
      }
      
      await container.remove();
      this.activeContainers.delete(projectId);
      return { success: true };
    } catch (error) {
      if (error.statusCode === 404) {
        // Container already doesn't exist, consider it success
        this.activeContainers.delete(projectId);
        return { success: true };
      }
      throw new Error(`Failed to stop workspace: ${error.message}`);
    }
  }

  async findAvailablePort(startPort) {
    // In a real implementation, you would check for available ports
    // For now, return a port based on project count
    return startPort + this.activeContainers.size;
  }

  async cleanupInactiveWorkspaces() {
    // Automatic cleanup functionality removed
    // This method is kept for backward compatibility with manual cleanup endpoint
    console.log('Manual cleanup triggered - removing orphaned project metadata');
    
    // Only clean up project metadata for containers that no longer exist
    // This is safe and helps keep the project list accurate
  }

  // Network validation and recovery methods

  async ensureNetworkExists() {
    try {
      const network = this.docker.getNetwork(this.network);
      await network.inspect();
      return true;
    } catch (error) {
      if (error.statusCode === 404) {
        console.error(`Network '${this.network}' does not exist!`);
        console.error('Please run: ./setup-network.sh to create the required network');
        return false;
      }
      throw error;
    }
  }

  // Attaches a workspace container to the network of its proxy mode and
  // detaches it from the other workspace networks. Covers containers whose
  // network was removed and recreated by `docker compose down/up`, and
  // containers created before the proxy networks were split. Returns true
  // if anything changed.
  async ensureWorkspaceNetwork(containerName, proxyMode = 'none', proxyIp = null) {
    const required = this.networkForProxyMode(proxyMode);
    const fixedIp = proxyMode === 'none' ? null : proxyIp;
    const info = await this.docker.getContainer(containerName).inspect();
    const attached = { ...(info.NetworkSettings.Networks || {}) };
    let changed = false;

    let requiredId;
    try {
      requiredId = (await this.docker.getNetwork(required).inspect()).Id;
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Network '${required}' does not exist. Run ./deploy.sh (or ./setup-network.sh) first.`);
      }
      throw error;
    }

    // A stopped container keeps the ID of a network that `docker compose
    // down/up` has since recreated under the same name, and Docker then
    // refuses to start it ("network ... not found"). Disconnecting by name
    // drops the stale entry so the container can be reattached.
    const entry = attached[required];
    if (entry && entry.NetworkID && entry.NetworkID !== requiredId) {
      await this.docker.getNetwork(required).disconnect({ Container: info.Id, Force: true });
      delete attached[required];
      console.log(`Dropped stale entry for recreated network ${required} from ${containerName}`);
    }

    // Pin the fixed address, otherwise Docker assigns a dynamic one on the
    // next start. A running workspace that already uses it keeps running
    // undisturbed and is pinned on its next start.
    const current = attached[required];
    let reattached = false;
    if (current && fixedIp) {
      const pinned = current.IPAMConfig && current.IPAMConfig.IPv4Address;
      if (pinned !== fixedIp && !(info.State.Running && current.IPAddress === fixedIp)) {
        await this.docker.getNetwork(required).disconnect({ Container: info.Id, Force: true });
        delete attached[required];
        reattached = true;
      }
    }

    if (!attached[required]) {
      try {
        await this.docker.getNetwork(required).connect({
          Container: info.Id,
          EndpointConfig: this.endpointConfig(containerName, fixedIp)
        });
      } catch (error) {
        // Address taken (running container): stay reachable, report it
        if (reattached) {
          await this.docker.getNetwork(required).connect({
            Container: info.Id,
            EndpointConfig: this.endpointConfig(containerName)
          }).catch(() => {});
        }
        throw new Error(`Could not attach ${containerName} to ${required}` +
          (fixedIp ? ` with address ${fixedIp}` : '') + `: ${error.message}`);
      }
      console.log(`Connected ${containerName} to network ${required}` + (fixedIp ? ` (${fixedIp})` : ''));
      changed = true;
    }

    for (const name of this.workspaceNetworks()) {
      if (name === required || !attached[name]) continue;
      try {
        await this.docker.getNetwork(name).disconnect({ Container: info.Id, Force: true });
      } catch (error) {
        // The network itself is gone: the entry cannot be removed by name
        if (error.statusCode !== 404) throw error;
        console.warn(`Could not disconnect ${containerName} from missing network ${name}`);
        continue;
      }
      console.log(`Disconnected ${containerName} from network ${name} (proxy mode: ${proxyMode})`);
      changed = true;
    }

    return changed;
  }

  // Runs ensureWorkspaceNetwork for every known workspace on server start.
  // Failures are logged per workspace; startWorkspace retries them.
  async migrateWorkspaceNetworks(projects) {
    let moved = 0;
    for (const project of projects) {
      const containerName = `workspace-${project.projectId}`;
      try {
        if (await this.ensureWorkspaceNetwork(containerName, project.proxyMode || 'none', project.proxyIp)) moved++;
      } catch (error) {
        if (error.statusCode !== 404) {
          console.warn(`Could not check network of ${containerName}: ${error.message}`);
        }
      }
    }
    if (moved > 0) console.log(`Updated the network attachment of ${moved} workspace(s)`);
  }

  // Subnets of all workspace networks with their gateways. nginx denies the
  // platform API to these subnets; a gateway stays allowed because traffic
  // from the host itself (and Docker Desktop's port forwarding) arrives from
  // there.
  async getWorkspaceNetworkRanges() {
    const ranges = [];
    for (const name of this.workspaceNetworks()) {
      let info;
      try {
        info = await this.docker.getNetwork(name).inspect();
      } catch (error) {
        if (error.statusCode === 404) continue;
        throw error;
      }
      for (const cfg of (info.IPAM && info.IPAM.Config) || []) {
        if (cfg.Subnet) ranges.push({ network: name, subnet: cfg.Subnet, gateway: this.networkGateway(info, cfg) });
      }
    }
    return ranges;
  }

  // Gateways of nginx's networks that are not internal: a reverse proxy on
  // the Docker host reaches nginx through the published port and arrives
  // from one of them. Waits for nginx, which Compose starts after the server.
  async getHostGateways(maxWaitTime = 60000) {
    const deadline = Date.now() + maxWaitTime;
    let nginx;
    for (;;) {
      try {
        nginx = await this.docker.getContainer(this.nginxContainerName).inspect();
        break;
      } catch (error) {
        if (error.statusCode !== 404 || Date.now() > deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    const gateways = [];
    for (const name of Object.keys((nginx.NetworkSettings && nginx.NetworkSettings.Networks) || {})) {
      const info = await this.docker.getNetwork(name).inspect();
      if (info.Internal) continue;
      for (const cfg of (info.IPAM && info.IPAM.Config) || []) {
        const gateway = this.networkGateway(info, cfg);
        if (gateway) gateways.push({ network: name, gateway });
      }
    }
    return gateways;
  }

  // Docker on Linux leaves a gateway it assigned itself out of IPAM.Config
  // (Docker Desktop lists it); that is the subnet's first address, reserved
  // by Docker. Internal networks get none: the host does not reach nginx
  // through them, and the address could otherwise belong to a workspace.
  networkGateway(info, cfg) {
    if (cfg.Gateway) return cfg.Gateway;
    if (info.Internal) return null;
    const range = parseIpv4Cidr(cfg.Subnet);
    return range ? intToIpv4(range.base + 1) : null;
  }

  async validateNetworkHealth() {
    try {
      const networkExists = await this.ensureNetworkExists();
      if (!networkExists) {
        return {
          healthy: false,
          error: `Network '${this.network}' does not exist`,
          recommendation: 'Run ./setup-network.sh to create the required network'
        };
      }
      
      // Get network details
      const network = this.docker.getNetwork(this.network);
      const networkInfo = await network.inspect();
      
      return {
        healthy: true,
        networkId: networkInfo.Id,
        subnet: networkInfo.IPAM.Config?.[0]?.Subnet || 'Unknown',
        connectedContainers: Object.keys(networkInfo.Containers || {}).length,
        details: networkInfo
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        recommendation: 'Check Docker daemon and network configuration'
      };
    }
  }

  parseMemoryLimit(memoryLimit) {
    // Convert memory limit string (e.g., '1g', '2g', '4g', '8g', '16g') to bytes
    const memoryMap = {
      '1g': 1 * 1024 * 1024 * 1024,   // 1GB
      '2g': 2 * 1024 * 1024 * 1024,   // 2GB
      '4g': 4 * 1024 * 1024 * 1024,   // 4GB
      '8g': 8 * 1024 * 1024 * 1024,   // 8GB
      '16g': 16 * 1024 * 1024 * 1024  // 16GB
    };
    
    const memory = memoryMap[memoryLimit];
    if (!memory) {
      console.warn(`Invalid memory limit '${memoryLimit}', defaulting to 2GB`);
      return memoryMap['2g'];
    }
    
    return memory;
  }

  // Docker host facts needed for limits, read once: CPU count (NanoCpus must
  // not exceed it) and whether per-container disk quotas are supported.
  async getHostCapabilities() {
    if (this.hostCapabilities) return this.hostCapabilities;
    try {
      const info = await this.docker.info();
      const status = Object.fromEntries(info.DriverStatus || []);
      // overlay2 size limits need xfs with project quotas ('pquota')
      const diskQuota = info.Driver === 'overlay2' && status['Backing Filesystem'] === 'xfs';
      if (this.diskLimit && !diskQuota) {
        console.warn(`WORKSPACE_DISK_LIMIT=${this.diskLimit} is ignored: storage driver ${info.Driver} on ` +
          `${status['Backing Filesystem'] || 'unknown'} does not support per-container quotas (needs overlay2 on xfs with pquota)`);
      }
      this.hostCapabilities = { ncpu: info.NCPU || null, diskQuota };
    } catch (error) {
      console.warn(`Could not read Docker host info: ${error.message}`);
      this.hostCapabilities = { ncpu: null, diskQuota: false };
    }
    return this.hostCapabilities;
  }

  // CPU cores ('1'|'2'|'4'|'8') -> NanoCpus, capped at the host's CPU count
  cpuCoresToNanoCpus(cpuCores, hostCpus = null) {
    let cores = parseInt(cpuCores, 10);
    if (![1, 2, 4, 8].includes(cores)) {
      console.warn(`Invalid CPU cores '${cpuCores}', defaulting to 2 cores`);
      cores = 2;
    }
    if (hostCpus) cores = Math.min(cores, hostCpus);
    return cores * 1e9;
  }

  // Returns sorted list of TCP ports the workspace container is listening on.
  // Filters out code-server's own 8082 and ports bound only to loopback.
  // Reads /proc/net/tcp{,6} directly to avoid depending on ss/netstat
  // being installed inside the workspace image.
  async getListeningPorts(projectId) {
    const containerName = `workspace-${projectId}`;
    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();
      if (!info.State || !info.State.Running) {
        return [];
      }

      const exec = await container.exec({
        Cmd: ['sh', '-c', 'cat /proc/net/tcp 2>/dev/null; echo ---; cat /proc/net/tcp6 2>/dev/null'],
        AttachStdout: true,
        AttachStderr: true
      });
      const stream = await exec.start({});
      const output = await this.streamToString(stream);

      const ports = new Set();
      // /proc/net/tcp(6) line format (whitespace-separated):
      //   sl  local_address  rem_address  st  ...
      // local_address = HEX_IP:HEX_PORT; state 0A = TCP_LISTEN.
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const local = parts[1];
        const state = parts[3];
        if (state !== '0A') continue; // LISTEN
        const colonIdx = local.lastIndexOf(':');
        if (colonIdx < 0) continue;
        const ipHex = local.slice(0, colonIdx);
        const portHex = local.slice(colonIdx + 1);
        const port = parseInt(portHex, 16);
        if (!Number.isInteger(port) || port <= 0 || port >= 65536) continue;
        if (port === 8082) continue;

        // Loopback in /proc/net/tcp is little-endian: 127.0.0.1 -> "0100007F"
        // /proc/net/tcp6 loopback is "00000000000000000000000001000000"
        if (ipHex.toUpperCase() === '0100007F') continue;
        if (ipHex === '00000000000000000000000001000000') continue;

        ports.add(port);
      }

      return Array.from(ports).sort((a, b) => a - b);
    } catch (err) {
      console.error(`getListeningPorts(${projectId}) failed:`, err.message);
      return [];
    }
  }
}

module.exports = new DockerService();