const Docker = require('dockerode');

const SQUID_CONF = '/etc/squid/squid.conf';

// One hostname label: letters, digits, hyphens (not at the ends); underscores
// are tolerated because some real-world hostnames use them.
const LABEL = '[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?';
// At least two labels, so a bare TLD like ".com" cannot whitelist everything.
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function whitelistError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

class WhitelistService {
  constructor() {
    this.docker = new Docker();
    // Markers in squid.conf that delimit the replaceable whitelist section
    this.WHITELIST_START = '# Whitelist ACLs - CUSTOMIZE THESE';
    this.WHITELIST_END = '# DENY ALL OTHER TRAFFIC';
    // Base domains always included (essential for workspace operation)
    // Use .domain format only — squid .domain matches both bare domain and all subdomains
    this.BASE_DOMAINS = [
      '.debian.org',
      '.ubuntu.com',
      '.nodesource.com',
      '.open-vsx.org',
      '.openvsx.org',
      '.eclipsecontent.org'
    ];
    // Applies run one at a time: they share squid.conf.new and the backup
    this._applyQueue = Promise.resolve();
  }

  async _getSquidContainer() {
    const containers = await this.docker.listContainers();
    const squidContainerInfo = containers.find(c =>
      c.Names.some(name => name.includes('squid-proxy'))
    );
    if (!squidContainerInfo) {
      throw new Error('Squid proxy container not found');
    }
    return this.docker.getContainer(squidContainerInfo.Id);
  }

  // Runs an argv command in the squid container and returns
  // { stdout, stderr, exitCode }. Never goes through a shell.
  async _execInSquid(argv) {
    const container = await this._getSquidContainer();
    const exec = await container.exec({
      Cmd: argv,
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      const out = [];
      const err = [];
      this.docker.modem.demuxStream(stream,
        { write: (chunk) => out.push(chunk) },
        { write: (chunk) => err.push(chunk) }
      );
      stream.on('end', () => resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8')
      }));
      stream.on('error', reject);
    });
    const { ExitCode } = await exec.inspect();
    return { stdout, stderr, exitCode: ExitCode };
  }

  // Like _execInSquid, but throws if the command exits non-zero.
  async _execInSquidChecked(argv, what) {
    const result = await this._execInSquid(argv);
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
      throw new Error(`${what} failed (exit ${result.exitCode})${detail ? ': ' + detail : ''}`);
    }
    return result.stdout;
  }

  async _readSquidConf() {
    return this._execInSquidChecked(['cat', SQUID_CONF], 'Reading squid.conf');
  }

  async _writeFileInSquid(path, content) {
    // base64 keeps the file content out of shell parsing entirely. It is sent
    // in chunks because Linux limits a single argv string to 128 KiB.
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const CHUNK = 64 * 1024;
    for (let i = 0; i < b64.length || i === 0; i += CHUNK) {
      const op = i === 0 ? '>' : '>>';
      await this._execInSquidChecked(
        ['sh', '-c', `printf %s "$1" ${op} "$2.b64"`, 'sh', b64.slice(i, i + CHUNK), path],
        `Writing ${path}`
      );
    }
    await this._execInSquidChecked(
      ['sh', '-c', 'base64 -d "$1.b64" > "$1" && rm -f "$1.b64"', 'sh', path],
      `Writing ${path}`
    );
  }

  /**
   * Read squid.conf and parse out whitelisted domains
   */
  async getWhitelist() {
    try {
      const confContent = await this._readSquidConf();

      const startIdx = confContent.indexOf(this.WHITELIST_START);
      const endIdx = confContent.indexOf(this.WHITELIST_END);

      if (startIdx === -1 || endIdx === -1) {
        throw new Error('Could not find whitelist markers in squid.conf');
      }

      const whitelistSection = confContent.substring(startIdx, endIdx);

      // Parse ACL lines for dstdomain entries
      const domains = new Set();
      const lines = whitelistSection.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Match: acl <name> dstdomain <domains...>
        const match = trimmed.match(/^acl\s+\S+\s+dstdomain\s+(.+)$/);
        if (match) {
          const domainList = match[1].split(/\s+/);
          for (const d of domainList) {
            if (d && !d.startsWith('#')) {
              domains.add(d);
            }
          }
        }
      }

      return {
        domains: Array.from(domains).sort(),
        raw: whitelistSection
      };
    } catch (error) {
      console.error('Error reading whitelist:', error);
      throw error;
    }
  }

  /**
   * Generate squid.conf whitelist section from domain list and apply it
   * Merges provided domains with base defaults, regenerates the whitelist
   * section of squid.conf, writes it back, and reconfigures squid.
   */
  /**
   * Normalize domains to squid .domain format and deduplicate.
   * In squid, .example.com matches both example.com and *.example.com.
   * Having both .example.com and example.com (or .sub.example.com when
   * .example.com exists) causes fatal errors.
   */
  _normalizeDomains(rawDomains) {
    // Validate and convert all domains to .domain format. Anything that is not
    // a plain hostname is rejected – entries end up verbatim in squid.conf, so
    // a newline or space would otherwise inject arbitrary squid directives.
    const dotDomains = new Set();
    const invalid = [];
    for (const d of rawDomains) {
      if (typeof d !== 'string') {
        invalid.push(String(d));
        continue;
      }
      let clean = d.trim().toLowerCase();
      if (!clean) continue;
      if (clean.startsWith('*.')) clean = clean.slice(1); // *.example.com → .example.com
      if (clean.endsWith('.')) clean = clean.slice(0, -1); // fully qualified form
      const bare = clean.startsWith('.') ? clean.slice(1) : clean;
      if (bare.length > 253 || !DOMAIN_RE.test(bare) || IPV4_RE.test(bare)) {
        invalid.push(d.trim());
        continue;
      }
      dotDomains.add('.' + bare);
    }

    if (invalid.length > 0) {
      const shown = invalid.slice(0, 10).map(d => JSON.stringify(d.slice(0, 80))).join(', ');
      const more = invalid.length > 10 ? ` (+${invalid.length - 10} more)` : '';
      throw whitelistError(
        `Invalid whitelist entries: ${shown}${more}. Only domain names are allowed ` +
        `(e.g. example.com, .example.com, *.example.com); IP addresses, URLs and ` +
        `single-label names are not supported.`,
        'INVALID'
      );
    }

    // Remove subdomains that are already covered by a parent .domain entry
    // e.g., if .anthropic.com exists, remove .api.anthropic.com
    const sorted = Array.from(dotDomains).sort((a, b) => {
      // Sort by number of parts (fewest first) so parents come before children
      const aParts = a.split('.').length;
      const bParts = b.split('.').length;
      return aParts - bParts || a.localeCompare(b);
    });

    const result = [];
    for (const domain of sorted) {
      // Check if any already-added domain is a parent of this one
      const isRedundant = result.some(parent => domain.endsWith(parent));
      if (!isRedundant) {
        result.push(domain);
      }
    }

    return result.sort();
  }

  applyWhitelist(domains) {
    const run = this._applyQueue.then(() => this._applyWhitelist(domains), () => this._applyWhitelist(domains));
    this._applyQueue = run.catch(() => {});
    return run;
  }

  async _applyWhitelist(domains) {
    try {
      // Merge with base defaults and normalize (throws code INVALID)
      const allRaw = [...this.BASE_DOMAINS, ...domains];
      const domainList = this._normalizeDomains(allRaw);

      // Generate new whitelist section
      const newSection = this._generateWhitelistSection(domainList);

      // Read current squid.conf
      const confContent = await this._readSquidConf();

      const startIdx = confContent.indexOf(this.WHITELIST_START);
      const endIdx = confContent.indexOf(this.WHITELIST_END);

      if (startIdx === -1 || endIdx === -1) {
        throw new Error('Could not find whitelist markers in squid.conf');
      }

      // Replace whitelist section
      const newConf = confContent.substring(0, startIdx) + newSection + confContent.substring(endIdx);

      // Validate the candidate config before touching the live one
      const candidate = `${SQUID_CONF}.new`;
      await this._writeFileInSquid(candidate, newConf);
      const parse = await this._execInSquid(['squid', '-k', 'parse', '-f', candidate]);
      if (parse.exitCode !== 0) {
        await this._execInSquid(['rm', '-f', candidate]);
        const detail = (parse.stderr || parse.stdout).trim().split('\n').slice(-5).join('\n');
        throw whitelistError(`Generated squid configuration is invalid: ${detail}`, 'PARSE');
      }

      // Swap in the new config, keeping a backup for rollback
      await this._execInSquidChecked(['cp', SQUID_CONF, `${SQUID_CONF}.bak`], 'Backing up squid.conf');
      await this._execInSquidChecked(['mv', candidate, SQUID_CONF], 'Installing squid.conf');

      try {
        await this._execInSquidChecked(['squid', '-k', 'reconfigure'], 'squid reconfigure');
      } catch (reconfigureError) {
        console.error('squid reconfigure failed, restoring previous config:', reconfigureError.message);
        await this._execInSquid(['cp', `${SQUID_CONF}.bak`, SQUID_CONF]);
        await this._execInSquid(['squid', '-k', 'reconfigure']);
        throw reconfigureError;
      }

      console.log(`Whitelist updated with ${domainList.length} domains`);

      return {
        success: true,
        domainCount: domainList.length,
        domains: domainList
      };
    } catch (error) {
      console.error('Error applying whitelist:', error);
      throw error;
    }
  }

  /**
   * Generate the whitelist ACL and access rules section of squid.conf
   */
  _generateWhitelistSection(domains) {
    let section = `${this.WHITELIST_START}\n`;
    section += '# ============================================\n';
    section += `# Auto-generated from recorded domains (${new Date().toISOString()})\n\n`;

    // One ACL spread over several lines (squid appends repeated acl lines),
    // so long lists never hit squid's config line length limit.
    // Use .domain format for wildcard matching (squid convention)
    section += '# Whitelisted domains\n';
    for (let i = 0; i < domains.length; i += 20) {
      section += `acl whitelist_domains dstdomain ${domains.slice(i, i + 20).join(' ')}\n`;
    }
    section += '\n';

    // Internal network ACL (required reference)
    section += '# Internal network (workspace containers)\n';
    section += 'acl internal_network src 172.30.0.0/16\n\n';

    // Access rules
    section += '# ============================================\n';
    section += '# Access Rules (Order Matters!)\n';
    section += '# ============================================\n\n';
    section += '# Deny non-safe ports\n';
    section += 'http_access deny !Safe_ports\n';
    section += 'http_access deny CONNECT !SSL_ports\n\n';
    section += '# Allow localhost (for health checks)\n';
    section += 'http_access allow localhost\n\n';
    section += '# Allow whitelisted domains for workspace containers\n';
    section += 'http_access allow internal_network whitelist_domains\n\n';

    return section;
  }
}

module.exports = new WhitelistService();
