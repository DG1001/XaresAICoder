const Docker = require('dockerode');

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

  async _execInSquid(cmd) {
    const container = await this._getSquidContainer();
    const exec = await container.exec({
      Cmd: ['bash', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true
    });
    const stream = await exec.start();
    return new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];
      this.docker.modem.demuxStream(stream,
        { write: (chunk) => stdout.push(chunk) },
        { write: (chunk) => stderr.push(chunk) }
      );
      stream.on('end', () => {
        const stderrStr = Buffer.concat(stderr).toString('utf8');
        if (stderrStr) console.error('squid exec stderr:', stderrStr);
        resolve(Buffer.concat(stdout).toString('utf8'));
      });
      stream.on('error', reject);
    });
  }

  /**
   * Read squid.conf and parse out whitelisted domains
   */
  async getWhitelist() {
    try {
      const confContent = await this._execInSquid('cat /etc/squid/squid.conf');

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
    // Convert all domains to .domain format
    const dotDomains = new Set();
    for (const d of rawDomains) {
      const clean = d.trim().toLowerCase();
      if (!clean) continue;
      // Normalize to .domain format
      const dotForm = clean.startsWith('.') ? clean : '.' + clean;
      dotDomains.add(dotForm);
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

  async applyWhitelist(domains) {
    try {
      // Merge with base defaults and normalize
      const allRaw = [...this.BASE_DOMAINS, ...domains];
      const domainList = this._normalizeDomains(allRaw);

      // Generate new whitelist section
      const newSection = this._generateWhitelistSection(domainList);

      // Read current squid.conf
      const confContent = await this._execInSquid('cat /etc/squid/squid.conf');

      const startIdx = confContent.indexOf(this.WHITELIST_START);
      const endIdx = confContent.indexOf(this.WHITELIST_END);

      if (startIdx === -1 || endIdx === -1) {
        throw new Error('Could not find whitelist markers in squid.conf');
      }

      // Replace whitelist section
      const newConf = confContent.substring(0, startIdx) + newSection + confContent.substring(endIdx);

      // Write back via squid container (escape single quotes for bash)
      const escaped = newConf.replace(/'/g, "'\\''");
      await this._execInSquid(`printf '%s' '${escaped}' > /etc/squid/squid.conf`);

      // Reconfigure squid to apply changes
      await this._execInSquid('squid -k reconfigure');

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

    // Group domains into a single ACL
    // Use .domain format for wildcard matching (squid convention)
    const aclDomains = domains.join(' ');
    section += '# Whitelisted domains\n';
    section += `acl whitelist_domains dstdomain ${aclDomains}\n\n`;

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
