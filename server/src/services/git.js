const fetch = require('node-fetch');

class GitService {
  constructor() {
    this.forgejoUrl = 'http://forgejo:3000';
    this.adminUser = process.env.GIT_ADMIN_USER || 'developer';
    this.adminPassword = process.env.GIT_ADMIN_PASSWORD || 'admin123!';
    this.gitServerEnabled = process.env.ENABLE_GIT_SERVER === 'true';
  }

  /**
   * Check if Git server is available and enabled
   */
  isGitServerAvailable() {
    return this.gitServerEnabled;
  }

  /**
   * Create a Git repository in Forgejo
   * @param {string} repoName - Repository name
   * @param {string} description - Repository description
   * @param {boolean} isPrivate - Whether the repository should be private
   * @returns {Promise<Object>} Repository creation result
   */
  async createGitRepository(repoName, description = '', isPrivate = false) {
    console.log(`Git repository creation requested: ${repoName} (enabled: ${this.isGitServerAvailable()})`);
    
    if (!this.isGitServerAvailable()) {
      throw new Error('Git server is not enabled or available');
    }

    // Validate repository name
    const validatedName = this.validateRepositoryName(repoName);
    console.log(`Repository name validated: ${repoName} -> ${validatedName}`);
    
    // Check if repository already exists and generate unique name if needed
    const uniqueRepoName = await this.generateUniqueRepoName(validatedName);
    console.log(`Unique repository name: ${uniqueRepoName}`);

    const repoData = {
      name: uniqueRepoName,
      description: description || `Repository for ${uniqueRepoName}`,
      private: isPrivate,
      auto_init: false, // Don't auto-initialize, let workspace handle it
      default_branch: 'main'
    };

    try {
      const apiUrl = `${this.forgejoUrl}/api/v1/user/repos`;
      console.log(`Making API call to create repository: ${apiUrl}`);
      console.log(`Repository data:`, repoData);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${this.adminUser}:${this.adminPassword}`).toString('base64')}`
        },
        body: JSON.stringify(repoData)
      });

      console.log(`Git repository API response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Failed to create Git repository:', response.status, errorData);
        throw new Error(`Failed to create Git repository: ${response.status} ${response.statusText}`);
      }

      const repository = await response.json();
      console.log(`Repository created successfully:`, {
        name: repository.name, 
        html_url: repository.html_url,
        clone_url: repository.clone_url
      });
      
      // Construct proper web URL using our environment config instead of Forgejo's response
      const protocol = process.env.PROTOCOL || 'http';
      const baseDomain = process.env.BASE_DOMAIN || 'localhost';
      const basePort = process.env.BASE_PORT || '80';
      
      let webUrl;
      if ((protocol === 'http' && basePort === '80') || (protocol === 'https' && basePort === '443')) {
        // Standard ports - don't include port in URL
        webUrl = `${protocol}://${baseDomain}/git/${this.adminUser}/${repository.name}`;
      } else {
        // Non-standard ports - include port in URL
        webUrl = `${protocol}://${baseDomain}:${basePort}/git/${this.adminUser}/${repository.name}`;
      }
      
      console.log(`Constructed web URL: ${webUrl} (from env: ${protocol}://${baseDomain}:${basePort})`);

      return {
        success: true,
        repository: {
          name: repository.name,
          fullName: repository.full_name,
          cloneUrl: repository.clone_url,
          internalCloneUrl: `http://${this.adminUser}:${this.adminPassword}@forgejo:3000/${this.adminUser}/${repository.name}.git`,
          webUrl: webUrl, // Use our constructed URL instead of repository.html_url
          description: repository.description,
          private: repository.private
        }
      };

    } catch (error) {
      console.error('Error creating Git repository:', error);
      throw new Error(`Failed to create Git repository: ${error.message}`);
    }
  }

  /**
   * Generate a unique repository name by checking for conflicts
   * @param {string} baseName - Base repository name
   * @returns {Promise<string>} Unique repository name
   */
  async generateUniqueRepoName(baseName) {
    let repoName = baseName;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      try {
        const exists = await this.checkRepositoryExists(repoName);
        if (!exists) {
          return repoName;
        }
        
        // Generate random suffix: 4 lowercase letters
        const suffix = this.generateRandomSuffix();
        repoName = `${baseName}-${suffix}`;
        attempts++;
        
      } catch (error) {
        console.error('Error checking repository existence:', error);
        // If we can't check, use the current name and let creation fail gracefully
        return repoName;
      }
    }

    // If we've tried too many times, use timestamp as suffix
    const timestamp = Date.now().toString().slice(-4);
    return `${baseName}-${timestamp}`;
  }

  /**
   * Check if a repository exists
   * @param {string} repoName - Repository name to check
   * @returns {Promise<boolean>} Whether the repository exists
   */
  async checkRepositoryExists(repoName) {
    try {
      const response = await fetch(`${this.forgejoUrl}/api/v1/repos/${this.adminUser}/${repoName}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.adminUser}:${this.adminPassword}`).toString('base64')}`
        }
      });

      return response.ok;
    } catch (error) {
      console.error('Error checking repository existence:', error);
      return false;
    }
  }

  /**
   * Generate a random 4-character lowercase suffix
   * @returns {string} Random suffix
   */
  generateRandomSuffix() {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Validate and sanitize repository name for Git/Forgejo
   * @param {string} name - Repository name to validate
   * @returns {string} Validated repository name
   */
  validateRepositoryName(name) {
    // Convert to lowercase and replace invalid characters
    let validName = name.toLowerCase()
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

  /**
   * Get Git repository configuration for workspace
   * @param {string} repoName - Repository name
   * @returns {Object} Git configuration for workspace
   */
  getWorkspaceGitConfig(repoName) {
    // Construct web URL with proper port handling
    const protocol = process.env.PROTOCOL || 'http';
    const baseDomain = process.env.BASE_DOMAIN || 'localhost';
    const basePort = process.env.BASE_PORT || '80';
    
    let webUrl;
    if ((protocol === 'http' && basePort === '80') || (protocol === 'https' && basePort === '443')) {
      // Standard ports - don't include port in URL
      webUrl = `${protocol}://${baseDomain}/git/${this.adminUser}/${repoName}`;
    } else {
      // Non-standard ports - include port in URL
      webUrl = `${protocol}://${baseDomain}:${basePort}/git/${this.adminUser}/${repoName}`;
    }
    
    return {
      remoteUrl: `http://${this.adminUser}:${this.adminPassword}@forgejo:3000/${this.adminUser}/${repoName}.git`,
      remoteName: 'origin',
      defaultBranch: 'main',
      webUrl: webUrl
    };
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