// XaresAICoder Frontend Application
class XaresAICoder {
    constructor() {
        this.apiBase = this.detectApiBase();
        this.projects = [];
        this.pollingInterval = null;
        this.creatingProjects = new Set(); // Track projects being created
        this.config = null; // Store app configuration
        this.deferredPrompt = null; // PWA install prompt
        this.init();
    }

    detectApiBase() {
        // For same-origin requests, use relative paths
        // This works for both localhost and ci.infra:8000 deployments
        return '/api';
    }

    async init() {
        // Initialize PWA features
        this.initPWA();
        
        // Load configuration first
        await this.loadConfiguration();
        
        // Setup UI based on configuration
        this.setupUI();
        
        this.bindEvents();
        this.loadProjects();
        
        // Load projects from localStorage for offline display
        this.loadProjectsFromStorage();
        
        // Start polling for project status updates
        this.startPolling();
        
        // Display version information
        this.displayVersionInfo();
    }

    async loadConfiguration() {
        try {
            const response = await fetch(`${this.apiBase}/config`);
            const data = await response.json();
            
            if (response.ok) {
                this.config = data;
                console.log('Configuration loaded:', this.config);
            } else {
                console.error('Failed to load configuration:', data);
                // Set default configuration
                this.config = {
                    gitServerEnabled: false,
                    baseDomain: 'localhost',
                    basePort: '80',
                    protocol: 'http'
                };
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            // Set default configuration
            this.config = {
                gitServerEnabled: false,
                baseDomain: 'localhost',
                basePort: '80',
                protocol: 'http'
            };
        }
    }

    setupUI() {
        // Show/hide Git server navigation based on configuration
        const gitServerNav = document.querySelector('.nav-item[data-tab="git-server"]');
        const gitServerTab = document.getElementById('git-server-tab');
        const gitRepoGroup = document.getElementById('gitRepoGroup');
        
        if (this.config.gitServerEnabled) {
            if (gitServerNav) gitServerNav.style.display = 'flex';
            if (gitRepoGroup) gitRepoGroup.style.display = 'block';
            
            // Update Git server URL in the tab if available
            if (this.config.gitServerUrl) {
                const gitServerLink = document.querySelector('#git-server-tab a[href="/git/"]');
                if (gitServerLink) {
                    gitServerLink.href = this.config.gitServerUrl;
                }
            }
        } else {
            if (gitServerNav) gitServerNav.style.display = 'none';
            if (gitRepoGroup) gitRepoGroup.style.display = 'none';
        }
    }

    bindEvents() {
        // Tab navigation
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => this.handleTabSwitch(e));
        });

        // Project creation form
        const createForm = document.getElementById('createProjectForm');
        createForm.addEventListener('submit', (e) => this.handleCreateProject(e));

        // Git repository checkbox
        const useGitRepositoryCheckbox = document.getElementById('useGitRepository');
        useGitRepositoryCheckbox.addEventListener('change', (e) => this.handleGitRepositoryToggle(e));

        // Password protection checkbox
        const passwordProtectedCheckbox = document.getElementById('passwordProtected');
        passwordProtectedCheckbox.addEventListener('change', (e) => this.handlePasswordProtectionToggle(e));

        // Generate password button
        const generatePasswordBtn = document.getElementById('generatePasswordBtn');
        generatePasswordBtn.addEventListener('click', () => this.generateSecurePassword());

        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.addEventListener('click', () => this.loadProjects());

        // Modal close handlers
        const closeErrorModal = document.getElementById('closeErrorModal');
        const closeErrorBtn = document.getElementById('closeErrorBtn');
        
        closeErrorModal.addEventListener('click', () => this.hideErrorModal());
        closeErrorBtn.addEventListener('click', () => this.hideErrorModal());
        
        // Close modal on outside click
        const errorModal = document.getElementById('errorModal');
        errorModal.addEventListener('click', (e) => {
            if (e.target === errorModal) {
                this.hideErrorModal();
            }
        });

        // Password verification modal handlers
        const closePasswordModal = document.getElementById('closePasswordModal');
        const cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
        const confirmPasswordBtn = document.getElementById('confirmPasswordBtn');
        
        closePasswordModal.addEventListener('click', () => this.hidePasswordModal());
        cancelPasswordBtn.addEventListener('click', () => this.hidePasswordModal());
        confirmPasswordBtn.addEventListener('click', () => this.handlePasswordConfirm());
        
        // Handle Enter key in password input
        const verifyPasswordInput = document.getElementById('verifyPasswordInput');
        verifyPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handlePasswordConfirm();
            }
        });

        // Notes modal handlers
        const closeNotesModal = document.getElementById('closeNotesModal');
        const saveNotesBtn = document.getElementById('saveNotesBtn');
        const cancelNotesBtn = document.getElementById('cancelNotesBtn');
        const notesTextarea = document.getElementById('notesTextarea');
        
        closeNotesModal.addEventListener('click', () => this.hideNotesModal());
        cancelNotesBtn.addEventListener('click', () => this.hideNotesModal());
        saveNotesBtn.addEventListener('click', () => this.saveProjectNotes());
        
        // Character count update
        notesTextarea.addEventListener('input', () => this.updateNotesCharCount());
        
        // Close notes modal on outside click
        document.getElementById('notesModal').addEventListener('click', (e) => {
            if (e.target.id === 'notesModal') {
                this.hideNotesModal();
            }
        });
    }

    handleTabSwitch(e) {
        const clickedItem = e.currentTarget;
        const targetTab = clickedItem.dataset.tab;
        
        // Remove active class from all nav items and tab panels
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.remove('active');
            // Also ensure only the target tab is visible
            if (panel.id === `${targetTab}-tab`) {
                panel.style.display = 'block';
            } else {
                panel.style.display = 'none';
            }
        });
        
        // Add active class to clicked nav item and corresponding tab panel
        clickedItem.classList.add('active');
        const targetTabElement = document.getElementById(`${targetTab}-tab`);
        if (targetTabElement) {
            targetTabElement.classList.add('active');
        }
    }

    handlePasswordProtectionToggle(e) {
        const passwordGroup = document.getElementById('passwordGroup');
        const passwordInput = document.getElementById('workspacePassword');

        if (e.target.checked) {
            passwordGroup.style.display = 'block';
            // Generate initial password when enabling protection
            if (!passwordInput.value) {
                this.generateSecurePassword();
            }
        } else {
            passwordGroup.style.display = 'none';
            passwordInput.value = '';
        }
    }

    handleGitRepositoryToggle(e) {
        const gitGroup = document.getElementById('gitGroup');
        const gitTokenGroup = document.getElementById('gitTokenGroup');
        const projectTypeSelect = document.getElementById('projectType');

        if (e.target.checked) {
            gitGroup.style.display = 'block';
            gitTokenGroup.style.display = 'block';

            // Disable project type selection when using Git repository
            projectTypeSelect.disabled = true;
            projectTypeSelect.value = 'git-clone';

            // Focus on Git URL input
            const gitUrlInput = document.getElementById('gitUrl');
            setTimeout(() => gitUrlInput.focus(), 100);
        } else {
            gitGroup.style.display = 'none';
            gitTokenGroup.style.display = 'none';

            // Re-enable project type selection
            projectTypeSelect.disabled = false;
            projectTypeSelect.value = '';

            // Clear Git inputs
            document.getElementById('gitUrl').value = '';
            document.getElementById('gitToken').value = '';
        }
    }

    generateSecurePassword() {
        const length = 12;
        // Use character sets excluding ambiguous characters (0/O, 1/l/I)
        const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const lowercase = 'abcdefghijkmnpqrstuvwxyz';
        const numbers = '23456789';
        const symbols = '!@#$%&*+-=?';
        
        const allChars = uppercase + lowercase + numbers + symbols;
        let password = '';
        
        // Ensure at least one character from each set
        password += this.getRandomChar(uppercase);
        password += this.getRandomChar(lowercase);
        password += this.getRandomChar(numbers);
        password += this.getRandomChar(symbols);
        
        // Fill the rest randomly
        for (let i = 4; i < length; i++) {
            password += this.getRandomChar(allChars);
        }
        
        // Shuffle the password to avoid predictable patterns
        password = this.shuffleString(password);
        
        document.getElementById('workspacePassword').value = password;
    }

    getRandomChar(chars) {
        const array = new Uint8Array(1);
        crypto.getRandomValues(array);
        return chars[array[0] % chars.length];
    }

    shuffleString(str) {
        const array = str.split('');
        for (let i = array.length - 1; i > 0; i--) {
            const randomArray = new Uint8Array(1);
            crypto.getRandomValues(randomArray);
            const j = randomArray[0] % (i + 1);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array.join('');
    }

    async handleCreateProject(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const projectName = formData.get('projectName').trim();
        const projectType = formData.get('projectType');
        const memoryLimit = formData.get('memoryLimit');
        const cpuCores = formData.get('cpuCores');
        const passwordProtected = formData.get('passwordProtected') === 'on';
        const workspacePassword = formData.get('workspacePassword');
        const createGitRepo = formData.get('createGitRepo') === 'on';
        const useGitRepository = formData.get('useGitRepository') === 'on';
        const gitUrl = formData.get('gitUrl')?.trim();
        const gitToken = formData.get('gitToken')?.trim();

        // Validation
        if (!projectName) {
            this.showError('Please enter a project name');
            return;
        }

        if (useGitRepository) {
            if (!gitUrl) {
                this.showError('Please enter a Git repository URL');
                return;
            }

            // Validate Git URL format (HTTP/HTTPS only)
            const urlPattern = /^https?:\/\/.+/i;
            if (!urlPattern.test(gitUrl)) {
                this.showError('Only HTTP and HTTPS Git URLs are supported for security');
                return;
            }
        } else if (!projectType) {
            this.showError('Please select a project template');
            return;
        }

        if (passwordProtected && (!workspacePassword || workspacePassword.length < 8)) {
            this.showError('Password must be at least 8 characters long');
            return;
        }


        const requestBody = {
            projectName,
            projectType: useGitRepository ? 'git-clone' : projectType,
            memoryLimit,
            cpuCores
        };

        if (passwordProtected) {
            requestBody.passwordProtected = true;
            requestBody.password = workspacePassword;
        }

        if (useGitRepository) {
            requestBody.gitUrl = gitUrl;
            if (gitToken) {
                requestBody.gitToken = gitToken;
            }
        }

        if (createGitRepo && this.config.gitServerEnabled) {
            requestBody.createGitRepo = true;
        }

        try {
            const response = await fetch(`${this.apiBase}/projects/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to create project');
            }

            // Success! Project is being created in background
            const project = data.project;
            this.saveProjectToStorage(project);
            
            // Add to creating projects set for polling
            this.creatingProjects.add(project.projectId);
            
            // Clear form
            e.target.reset();
            
            // Hide password group and clear password input
            const passwordGroup = document.getElementById('passwordGroup');
            const passwordInput = document.getElementById('workspacePassword');
            passwordGroup.style.display = 'none';
            passwordInput.value = '';
            
            // Show simple success message
            this.showCreateSuccess(project);
            
            // Refresh project list to show the creating workspace
            this.loadProjects();

        } catch (error) {
            console.error('Error creating project:', error);
            this.showError(error.message || 'Failed to create project. Please try again.');
        }
    }

    async loadProjects() {
        try {
            const response = await fetch(`${this.apiBase}/projects/`);
            const data = await response.json();

            if (response.ok) {
                this.projects = data.projects || [];
                this.saveProjectsToStorage(this.projects);
            } else {
                console.error('Failed to load projects:', data.message);
                // Fall back to localStorage
                this.loadProjectsFromStorage();
            }

        } catch (error) {
            console.error('Error loading projects:', error);
            // Fall back to localStorage
            this.loadProjectsFromStorage();
        }

        this.renderProjects();
    }

    startPolling() {
        // Poll every 3 seconds for status updates
        this.pollingInterval = setInterval(() => {
            this.pollProjectStatus();
        }, 3000);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    async pollProjectStatus() {
        // Only poll if we have projects being created or might need updates
        if (this.creatingProjects.size === 0 && !this.hasProjectsNeedingUpdates()) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/projects/`);
            const data = await response.json();

            if (response.ok) {
                const oldProjects = [...this.projects];
                this.projects = data.projects || [];
                this.saveProjectsToStorage(this.projects);
                
                // Check for status changes
                this.handleStatusChanges(oldProjects, this.projects);
                this.renderProjects();
            }
        } catch (error) {
            console.error('Error polling project status:', error);
        }
    }

    hasProjectsNeedingUpdates() {
        // Check if any projects might need status updates (creating, starting, stopping)
        return this.projects.some(p => 
            p.status === 'creating' || 
            this.creatingProjects.has(p.projectId) ||
            (p.status === 'running' && !p.workspaceUrl) // Running but not ready
        );
    }

    handleStatusChanges(oldProjects, newProjects) {
        const oldProjectMap = new Map(oldProjects.map(p => [p.projectId, p]));
        
        newProjects.forEach(newProject => {
            const oldProject = oldProjectMap.get(newProject.projectId);
            
            // Project just finished creating - check if it now has a workspaceUrl
            if (oldProject && 
                (oldProject.status === 'creating' || (oldProject.status === 'running' && !oldProject.workspaceUrl)) &&
                newProject.status === 'running' && newProject.workspaceUrl) {
                this.creatingProjects.delete(newProject.projectId);
                this.showWorkspaceReady(newProject);
            }
            
            // Project creation failed
            if (oldProject && 
                (oldProject.status === 'creating' || (oldProject.status === 'running' && !oldProject.workspaceUrl)) &&
                newProject.status === 'error') {
                this.creatingProjects.delete(newProject.projectId);
                this.showError(`Failed to create workspace "${newProject.projectName}". Please try again.`);
            }
        });
    }

    renderProjects() {
        const projectsList = document.getElementById('projectsList');
        const noProjects = document.getElementById('noProjects');

        if (this.projects.length === 0) {
            projectsList.innerHTML = '';
            noProjects.style.display = 'block';
            return;
        }

        noProjects.style.display = 'none';
        
        
        projectsList.innerHTML = this.projects.map(project => `
            <div class="project-item" data-project-id="${project.projectId}">
                <div class="project-info">
                    <h4>
                        ${this.escapeHtml(project.projectName)}
                        ${project.passwordProtected ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="margin-left: 6px; color: var(--vscode-text-muted); vertical-align: text-bottom;" title="Password Protected"><path d="M4 4v2h-.25A1.75 1.75 0 0 0 2 7.75v5.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 13.25v-5.5A1.75 1.75 0 0 0 12.25 6H12V4a4 4 0 1 0-8 0Zm6.5 2V4a2.5 2.5 0 0 0-5 0v2h5Z"/></svg>' : ''}
                        ${project.gitRepository && project.gitRepository.webUrl ? `<a href="${project.gitRepository.webUrl}" target="_blank" class="git-repo-link" title="View Git Repository: ${project.gitRepository.name}"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.20-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>` : ''}
                        <button class="notes-btn" onclick="app.openNotesModal('${project.projectId}')" title="View/Edit Project Notes" aria-label="Project Notes">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H2z"/>
                                <path d="M3 3.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1 0-1zm0 2h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1 0-1zm0 2h7a.5.5 0 0 1 0 1H3a.5.5 0 0 1 0-1z"/>
                            </svg>
                            ${project.notes && project.notes.trim() ? '<span class="notes-indicator"></span>' : ''}
                        </button>
                    </h4>
                    <div class="project-meta">
                        <span class="project-status ${this.getStatusClass(project.status, project.workspaceUrl)}">${this.getStatusLabel(project.status, project.workspaceUrl)}</span>
                        ${this.getProjectTypeLabel(project.projectType) ? `<span>${this.getProjectTypeLabel(project.projectType)}</span>` : ''}
                        ${project.gitUrl ? `<span class="git-url-info" title="Cloned from: ${this.escapeHtml(project.gitUrl)}"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px;"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.20-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>${this.getShortGitUrl(project.gitUrl)}</span>` : ''}
                        <span>${this.getMemoryLimitLabel(project.memoryLimit)}</span>
                        <span>${this.getCpuCoresLabel(project.cpuCores)}</span>
                        <span>Created ${this.formatDate(project.createdAt)}</span>
                    </div>
                </div>
                <div class="project-actions">
                    ${this.getProjectActionButtons(project)}
                </div>
            </div>
        `).join('');
    }

    async openWorkspace(projectId, workspaceUrl) {
        try {
            // Check if project is still running
            const response = await fetch(`${this.apiBase}/projects/${projectId}`);
            const data = await response.json();

            if (response.ok && data.project) {
                window.open(workspaceUrl, '_blank');
            } else {
                this.showError('Workspace is no longer available. It may have been stopped due to inactivity.');
                this.loadProjects(); // Refresh the list
            }
        } catch (error) {
            console.error('Error checking project status:', error);
            // Try to open anyway
            window.open(workspaceUrl, '_blank');
        }
    }

    async deleteProject(projectId, projectName) {
        const project = this.projects.find(p => p.projectId === projectId);
        
        if (project && project.passwordProtected) {
            // Show password verification modal for protected workspaces
            this.showPasswordModal('delete', projectId, projectName);
        } else {
            // Direct confirmation for unprotected workspaces
            if (!confirm(`Are you sure you want to delete the project "${projectName}"? This action cannot be undone.`)) {
                return;
            }
            this.executeDeleteProject(projectId);
        }
    }

    async executeDeleteProject(projectId, password = null) {
        try {
            const requestBody = password ? { password } : {};
            const response = await fetch(`${this.apiBase}/projects/${projectId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (response.ok) {
                this.removeProjectFromStorage(projectId);
                this.loadProjects();
                this.hidePasswordModal();
            } else {
                if (response.status === 401) {
                    this.showPasswordError('Invalid password. Please try again.');
                } else {
                    this.showError(data.message || 'Failed to delete project');
                    this.hidePasswordModal();
                }
            }

        } catch (error) {
            console.error('Error deleting project:', error);
            this.showError('Failed to delete project. Please try again.');
            this.hidePasswordModal();
        }
    }

    async startProject(projectId) {
        const project = this.projects.find(p => p.projectId === projectId);
        
        if (project && project.passwordProtected) {
            // Show password verification modal for protected workspaces
            this.showPasswordModal('start', projectId, project.projectName);
        } else {
            // Direct start for unprotected workspaces
            this.executeStartProject(projectId);
        }
    }

    async executeStartProject(projectId, password = null) {
        try {
            this.setProjectActionLoading(projectId, true);
            
            const requestBody = password ? { password } : {};
            const response = await fetch(`${this.apiBase}/projects/${projectId}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (response.ok) {
                this.loadProjects(); // Refresh the list to show updated status
                this.hidePasswordModal();
            } else {
                if (response.status === 401) {
                    this.showPasswordError('Invalid password. Please try again.');
                } else {
                    this.showError(data.message || 'Failed to start project');
                    this.hidePasswordModal();
                }
            }

        } catch (error) {
            console.error('Error starting project:', error);
            this.showError('Failed to start project. Please try again.');
            this.hidePasswordModal();
        } finally {
            this.setProjectActionLoading(projectId, false);
        }
    }

    async stopProject(projectId) {
        const project = this.projects.find(p => p.projectId === projectId);
        
        if (project && project.passwordProtected) {
            // Show password verification modal for protected workspaces
            this.showPasswordModal('stop', projectId, project.projectName);
        } else {
            // Direct confirmation for unprotected workspaces
            if (!confirm('Are you sure you want to stop this workspace? Any unsaved work will be lost.')) {
                return;
            }
            this.executeStopProject(projectId);
        }
    }

    async executeStopProject(projectId, password = null) {
        try {
            this.setProjectActionLoading(projectId, true);
            
            const requestBody = password ? { password } : {};
            const response = await fetch(`${this.apiBase}/projects/${projectId}/stop`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();

            if (response.ok) {
                this.loadProjects(); // Refresh the list to show updated status
                this.hidePasswordModal();
            } else {
                if (response.status === 401) {
                    this.showPasswordError('Invalid password. Please try again.');
                } else {
                    this.showError(data.message || 'Failed to stop project');
                    this.hidePasswordModal();
                }
            }

        } catch (error) {
            console.error('Error stopping project:', error);
            this.showError('Failed to stop project. Please try again.');
            this.hidePasswordModal();
        } finally {
            this.setProjectActionLoading(projectId, false);
        }
    }

    getProjectActionButtons(project) {
        const isRunning = project.status === 'running';
        const isStopped = project.status === 'stopped';
        const isError = project.status === 'error';
        const isCreating = project.status === 'creating';
        const isRunningButNotReady = isRunning && !project.workspaceUrl;

        let buttons = '';

        if (isCreating || isRunningButNotReady) {
            // Show loading indicator while creating or if running but not ready
            buttons += `
                <div class="creating-indicator">
                    <div class="spinner" style="display: inline-block; width: 16px; height: 16px; margin-right: 8px;"></div>
                    Creating workspace...
                </div>
            `;
        } else if (isRunning && project.workspaceUrl) {
            buttons += `
                <button class="btn-open" onclick="app.openWorkspace('${project.projectId}', '${project.workspaceUrl}')">
                    Open Workspace
                </button>
                <button class="btn-warning" onclick="app.stopProject('${project.projectId}')">
                    Stop
                </button>
            `;
        } else if (isStopped) {
            buttons += `
                <button class="btn-success" onclick="app.startProject('${project.projectId}')">
                    Start
                </button>
            `;
        } else if (isError) {
            buttons += `
                <button class="btn-success" onclick="app.startProject('${project.projectId}')">
                    Restart
                </button>
            `;
        }

        // Only show delete button if not creating
        if (!isCreating) {
            buttons += `
                <button class="btn-danger" onclick="app.deleteProject('${project.projectId}', '${this.escapeHtml(project.projectName)}')">
                    Delete
                </button>
            `;
        }

        return buttons;
    }

    setProjectActionLoading(projectId, loading) {
        const projectCard = document.querySelector(`[data-project-id="${projectId}"]`);
        if (projectCard) {
            const buttons = projectCard.querySelectorAll('.project-actions button');
            buttons.forEach(btn => {
                btn.disabled = loading;
                if (loading) {
                    btn.style.opacity = '0.6';
                } else {
                    btn.style.opacity = '1';
                }
            });
        }
    }

    // Utility methods
    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        const createBtn = document.getElementById('createBtn');
        const btnText = createBtn.querySelector('.btn-text');
        const spinner = createBtn.querySelector('.spinner');

        if (show) {
            overlay.style.display = 'flex';
            createBtn.disabled = true;
            btnText.textContent = 'Creating...';
            spinner.style.display = 'block';
            
            // Update loading message
            document.querySelector('.loading-content p').textContent = 'Creating your workspace and starting VS Code...';
            document.querySelector('.loading-detail').textContent = 'This may take 15-30 seconds';
        } else {
            overlay.style.display = 'none';
            createBtn.disabled = false;
            btnText.textContent = 'Create Workspace';
            spinner.style.display = 'none';
        }
    }

    showCreateSuccess(project) {
        // Simple success message without auto-redirect
        console.log(`Workspace "${project.projectName}" is being created in the background...`);
        // Optional: Could show a toast notification here
    }

    showWorkspaceReady(project) {
        // Show a success modal with workspace access instructions
        const modal = document.getElementById('successModal') || this.createSuccessModal();
        const projectNameElement = modal.querySelector('#successProjectName');
        const workspaceUrlElement = modal.querySelector('#successWorkspaceUrl');
        const passwordInfoElement = modal.querySelector('#passwordInfo');
        const passwordValueElement = modal.querySelector('#passwordValue');
        
        projectNameElement.textContent = project.projectName;
        workspaceUrlElement.href = project.workspaceUrl;
        workspaceUrlElement.textContent = project.workspaceUrl;
        
        // Show password information if workspace is protected
        if (project.passwordProtected && project.password) {
            passwordInfoElement.style.display = 'block';
            passwordValueElement.textContent = project.password;
        } else {
            passwordInfoElement.style.display = 'none';
        }

        // Show Git repository information if available
        const gitInfoElement = modal.querySelector('#gitRepositoryInfo');
        if (project.gitRepository && project.gitRepository.name) {
            if (gitInfoElement) {
                gitInfoElement.style.display = 'block';
                const gitRepoNameElement = modal.querySelector('#gitRepoName');
                const gitRepoUrlElement = modal.querySelector('#gitRepoUrl');
                if (gitRepoNameElement) gitRepoNameElement.textContent = project.gitRepository.name;
                if (gitRepoUrlElement) {
                    gitRepoUrlElement.href = project.gitRepository.webUrl;
                    gitRepoUrlElement.textContent = project.gitRepository.webUrl;
                }
            }
        } else if (gitInfoElement) {
            gitInfoElement.style.display = 'none';
        }
        
        modal.style.display = 'flex';
        
        // Auto-open workspace after a short delay
        setTimeout(() => {
            window.open(project.workspaceUrl, '_blank');
        }, 1000);
    }

    createSuccessModal() {
        const modal = document.createElement('div');
        modal.id = 'successModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🎉 Workspace Ready!</h3>
                    <button class="modal-close" onclick="this.parentElement.parentElement.parentElement.style.display='none'">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Your project "<strong id="successProjectName"></strong>" has been created successfully!</p>
                    <p>VS Code is starting in a new tab. If it doesn't open automatically, click the link below:</p>
                    <p><a id="successWorkspaceUrl" href="#" target="_blank" class="workspace-link"></a></p>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="window.open(document.getElementById('successWorkspaceUrl').href, '_blank')">Open Workspace</button>
                    <button class="btn-secondary" onclick="this.parentElement.parentElement.parentElement.style.display='none'">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        return modal;
    }

    showError(message) {
        const modal = document.getElementById('errorModal');
        const messageElement = document.getElementById('errorMessage');
        messageElement.textContent = message;
        modal.style.display = 'flex';
    }

    hideErrorModal() {
        const modal = document.getElementById('errorModal');
        modal.style.display = 'none';
    }

    showPasswordModal(action, projectId, projectName) {
        const modal = document.getElementById('passwordVerifyModal');
        const messageElement = document.getElementById('passwordVerifyMessage');
        const passwordInput = document.getElementById('verifyPasswordInput');
        const errorElement = document.getElementById('passwordVerifyError');
        
        // Store the action and project info for later use
        this.pendingPasswordAction = { action, projectId, projectName };
        
        // Set the message based on action
        const actionText = action === 'delete' ? 'delete' : action === 'stop' ? 'stop' : 'start';
        messageElement.textContent = `Enter the password for "${projectName}" to ${actionText} this protected workspace:`;
        
        // Clear previous input and errors
        passwordInput.value = '';
        errorElement.style.display = 'none';
        
        modal.style.display = 'flex';
        
        // Focus on password input
        setTimeout(() => passwordInput.focus(), 100);
    }

    hidePasswordModal() {
        const modal = document.getElementById('passwordVerifyModal');
        const errorElement = document.getElementById('passwordVerifyError');
        modal.style.display = 'none';
        errorElement.style.display = 'none';
        this.pendingPasswordAction = null;
    }

    showPasswordError(message) {
        const errorElement = document.getElementById('passwordVerifyError');
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }

    handlePasswordConfirm() {
        const passwordInput = document.getElementById('verifyPasswordInput');
        const password = passwordInput.value.trim();
        
        if (!password) {
            this.showPasswordError('Please enter the workspace password.');
            return;
        }
        
        if (!this.pendingPasswordAction) {
            return;
        }
        
        const { action, projectId, projectName } = this.pendingPasswordAction;
        
        if (action === 'delete') {
            // Show confirmation dialog before executing delete
            if (confirm(`Are you sure you want to delete the project "${projectName}"? This action cannot be undone.`)) {
                this.executeDeleteProject(projectId, password);
            } else {
                this.hidePasswordModal();
            }
        } else if (action === 'stop') {
            // Show confirmation dialog before executing stop
            if (confirm('Are you sure you want to stop this workspace? Any unsaved work will be lost.')) {
                this.executeStopProject(projectId, password);
            } else {
                this.hidePasswordModal();
            }
        } else if (action === 'start') {
            // Execute start directly (no confirmation needed)
            this.executeStartProject(projectId, password);
        }
    }

    getProjectTypeLabel(type) {
        const labels = {
            'empty': 'Empty Project',
            'python-flask': 'Python Flask',
            'node-react': 'Node.js React',
            'java-spring': 'Java Spring Boot',
            'git-clone': '' // Don't show project type for Git repositories since we show the repo name
        };
        return labels.hasOwnProperty(type) ? labels[type] : type;
    }

    getShortGitUrl(gitUrl) {
        if (!gitUrl) return '';

        try {
            const url = new URL(gitUrl);
            const pathParts = url.pathname.split('/').filter(part => part.length > 0);

            // For URLs like https://github.com/user/repo.git, show "user/repo"
            if (pathParts.length >= 2) {
                const repo = pathParts[pathParts.length - 1].replace(/\.git$/, '');
                const user = pathParts[pathParts.length - 2];
                return `${user}/${repo}`;
            }

            // Fallback: show hostname/path
            return `${url.hostname}${url.pathname}`.replace(/\.git$/, '');
        } catch (e) {
            // If URL parsing fails, just return the last part of the URL
            return gitUrl.split('/').pop().replace(/\.git$/, '');
        }
    }

    getMemoryLimitLabel(memoryLimit) {
        const labels = {
            '1g': '1GB RAM',
            '2g': '2GB RAM', 
            '4g': '4GB RAM',
            '8g': '8GB RAM',
            '16g': '16GB RAM'
        };
        return labels[memoryLimit] || '2GB RAM';
    }

    getCpuCoresLabel(cpuCores) {
        const labels = {
            '1': '1 Core',
            '2': '2 Cores',
            '4': '4 Cores',
            '8': '8 Cores'
        };
        return labels[cpuCores] || '2 Cores';
    }

    getStatusLabel(status, workspaceUrl = null) {
        // If running but no workspaceUrl, show as Creating
        if (status === 'running' && !workspaceUrl) {
            return 'Creating';
        }
        
        const labels = {
            'running': 'Running',
            'stopped': 'Stopped',
            'creating': 'Creating',
            'error': 'Error',
            'not_found': 'Not Found'
        };
        return labels[status] || status;
    }

    getStatusClass(status, workspaceUrl = null) {
        // If running but no workspaceUrl, show as Creating
        if (status === 'running' && !workspaceUrl) {
            return 'status-creating';
        }
        
        const classes = {
            'running': 'status-running',
            'stopped': 'status-stopped',
            'creating': 'status-creating',
            'error': 'status-error',
            'not_found': 'status-error'
        };
        return classes[status] || 'status-stopped';
    }

    formatDate(dateString) {
        if (!dateString) return 'Unknown';
        try {
            return new Date(dateString).toLocaleString();
        } catch (error) {
            return 'Unknown';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Local storage methods for offline support
    saveProjectsToStorage(projects) {
        try {
            localStorage.setItem('xares_projects', JSON.stringify(projects));
        } catch (error) {
            console.error('Error saving projects to storage:', error);
        }
    }

    // PWA Methods
    initPWA() {
        // Register service worker
        if ('serviceWorker' in navigator) {
            this.registerServiceWorker();
        }

        // Handle PWA install prompt
        this.setupPWAInstallPrompt();

        // Add PWA-specific event listeners
        this.addPWAEventListeners();
    }

    async registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('[PWA] Service Worker registered successfully:', registration);

            // Check for updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showUpdateNotification();
                        }
                    });
                }
            });

        } catch (error) {
            console.error('[PWA] Service Worker registration failed:', error);
        }
    }

    setupPWAInstallPrompt() {
        // Listen for the beforeinstallprompt event
        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('[PWA] beforeinstallprompt event fired');
            
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault();
            
            // Save the event so it can be triggered later
            this.deferredPrompt = e;
            
            // Show the install button
            this.showInstallButton();
        });

        // Listen for the app being installed
        window.addEventListener('appinstalled', (evt) => {
            console.log('[PWA] App was installed');
            this.hideInstallButton();
            this.deferredPrompt = null;
        });
    }

    addPWAEventListeners() {
        // Handle offline/online status
        window.addEventListener('online', () => {
            console.log('[PWA] App is online');
            this.hideOfflineIndicator();
            // Refresh projects when coming back online
            this.loadProjects();
        });

        window.addEventListener('offline', () => {
            console.log('[PWA] App is offline');
            this.showOfflineIndicator();
        });

        // Handle app visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // App became visible, refresh data
                this.loadProjects();
            }
        });
    }

    showInstallButton() {
        // Check if install button already exists
        let installButton = document.getElementById('pwa-install-btn');
        
        if (!installButton) {
            // Create install button
            installButton = document.createElement('button');
            installButton.id = 'pwa-install-btn';
            installButton.className = 'btn-primary pwa-install-btn';
            installButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8.5 1.5a.5.5 0 0 0-1 0v5.793L6.354 6.146a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 7.293V1.5z"/>
                    <path d="M3 9.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0-3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"/>
                    <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2.5L8 0v2.5A1.5 1.5 0 0 0 9.5 3z"/>
                </svg>
                Install App
            `;
            
            // Add click handler
            installButton.addEventListener('click', () => this.handleInstallClick());
            
            // Insert into the header
            const titleBarContent = document.querySelector('.title-bar-content');
            if (titleBarContent) {
                titleBarContent.appendChild(installButton);
            }
        }
        
        installButton.style.display = 'inline-flex';
    }

    hideInstallButton() {
        const installButton = document.getElementById('pwa-install-btn');
        if (installButton) {
            installButton.style.display = 'none';
        }
    }

    async handleInstallClick() {
        if (!this.deferredPrompt) {
            return;
        }

        // Show the install prompt
        this.deferredPrompt.prompt();

        // Wait for the user to respond to the prompt
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log(`[PWA] User response to install prompt: ${outcome}`);

        // Clear the deferred prompt
        this.deferredPrompt = null;
        this.hideInstallButton();
    }

    showUpdateNotification() {
        // Create update notification
        const notification = document.createElement('div');
        notification.className = 'pwa-update-notification';
        notification.innerHTML = `
            <div class="update-content">
                <span>A new version of XaresAICoder is available!</span>
                <button class="btn-secondary update-btn" onclick="this.parentElement.parentElement.remove(); location.reload();">
                    Update Now
                </button>
                <button class="btn-link dismiss-btn" onclick="this.parentElement.parentElement.remove();">
                    Dismiss
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 30 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 30000);
    }

    showOfflineIndicator() {
        let indicator = document.getElementById('offline-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offline-indicator';
            indicator.className = 'offline-indicator';
            indicator.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M10.706 3.294A12.545 12.545 0 0 0 8 3C5.259 3 2.723 3.681.63 4.85a.485.485 0 0 0-.08.94L8 13.5l7.45-7.71a.485.485 0 0 0-.08-.94C13.277 3.681 10.741 3 8 3a12.545 12.545 0 0 0-2.706.294z"/>
                    <path d="M11.5 6.5a5 5 0 1 0-3 4.5L11.5 6.5z"/>
                </svg>
                You're offline - some features may be limited
            `;
            
            document.body.appendChild(indicator);
        }
        
        indicator.style.display = 'flex';
    }

    hideOfflineIndicator() {
        const indicator = document.getElementById('offline-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    // Version Display Methods
    displayVersionInfo() {
        const versionElement = document.getElementById('version-info');
        if (!versionElement) {
            return;
        }

        // Get version information from the global variable
        if (typeof window.APP_VERSION !== 'undefined') {
            const version = window.APP_VERSION;
            const versionText = this.formatVersionInfo(version);
            versionElement.textContent = versionText;
            versionElement.title = this.getVersionTooltip(version);
        } else {
            // Fallback for development when version.js doesn't exist
            versionElement.textContent = 'XaresAICoder (dev)';
            versionElement.title = 'Development version - version.js will be generated during deployment';
        }
    }

    formatVersionInfo(version) {
        // Format: "XaresAICoder v1.2.3"
        if (version.gitTag && version.gitTag !== 'v0.0.0-dev') {
            return `XaresAICoder ${version.gitTag}`;
        } else if (version.version) {
            return `XaresAICoder ${version.version}`;
        } else {
            return 'XaresAICoder';
        }
    }

    getVersionTooltip(version) {
        const parts = [];
        
        if (version.version) {
            parts.push(`Version: ${version.version}`);
        }
        
        if (version.gitTag) {
            parts.push(`Git Tag: ${version.gitTag}`);
        }
        
        if (version.gitHash && version.gitHash !== 'unknown') {
            parts.push(`Commit: ${version.gitHash}`);
        }
        
        if (version.buildDate) {
            const buildDate = new Date(version.buildDate);
            parts.push(`Built: ${buildDate.toLocaleString()}`);
        }
        
        if (version.buildEnv) {
            parts.push(`Environment: ${version.buildEnv}`);
        }
        
        return parts.join('\n');
    }

    loadProjectsFromStorage() {
        try {
            const stored = localStorage.getItem('xares_projects');
            if (stored) {
                this.projects = JSON.parse(stored);
            }
        } catch (error) {
            console.error('Error loading projects from storage:', error);
            this.projects = [];
        }
    }

    saveProjectToStorage(project) {
        try {
            const stored = localStorage.getItem('xares_projects');
            let projects = stored ? JSON.parse(stored) : [];
            
            // Add new project or update existing
            const existingIndex = projects.findIndex(p => p.projectId === project.projectId);
            if (existingIndex >= 0) {
                projects[existingIndex] = project;
            } else {
                projects.unshift(project); // Add to beginning
            }
            
            localStorage.setItem('xares_projects', JSON.stringify(projects));
        } catch (error) {
            console.error('Error saving project to storage:', error);
        }
    }

    removeProjectFromStorage(projectId) {
        try {
            const stored = localStorage.getItem('xares_projects');
            if (stored) {
                let projects = JSON.parse(stored);
                projects = projects.filter(p => p.projectId !== projectId);
                localStorage.setItem('xares_projects', JSON.stringify(projects));
            }
        } catch (error) {
            console.error('Error removing project from storage:', error);
        }
    }

    // Project Notes Methods
    async openNotesModal(projectId) {
        try {
            const project = this.projects.find(p => p.projectId === projectId);
            if (!project) {
                this.showError('Project not found');
                return;
            }

            // Set current project ID for save operation
            this.currentNotesProjectId = projectId;
            
            // Set modal title
            document.getElementById('notesModalTitle').textContent = `Notes - ${project.projectName}`;
            
            // Load current notes
            const response = await fetch(`${this.apiBase}/projects/${projectId}/notes`);
            let notes = '';
            
            if (response.ok) {
                const data = await response.json();
                notes = data.notes || '';
            } else {
                console.error('Failed to load project notes');
                // Continue with empty notes - don't block the user
            }
            
            // Set textarea content and update character count
            const textarea = document.getElementById('notesTextarea');
            textarea.value = notes;
            this.originalNotes = notes; // Store original for cancel detection
            this.updateNotesCharCount();
            
            // Show modal
            document.getElementById('notesModal').style.display = 'flex';
            
            // Focus textarea after animation
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }, 100);
            
        } catch (error) {
            console.error('Error opening notes modal:', error);
            this.showError('Failed to open notes editor');
        }
    }

    hideNotesModal() {
        document.getElementById('notesModal').style.display = 'none';
        this.currentNotesProjectId = null;
        this.originalNotes = null;
    }

    async saveProjectNotes() {
        if (!this.currentNotesProjectId) {
            return;
        }

        try {
            const textarea = document.getElementById('notesTextarea');
            const notes = textarea.value.trim();
            
            // Check character limit
            if (notes.length > 10240) {
                this.showError('Notes are too long. Maximum 10,240 characters allowed.');
                return;
            }
            
            const saveBtn = document.getElementById('saveNotesBtn');
            const originalText = saveBtn.innerHTML;
            
            // Show loading state
            saveBtn.innerHTML = '<div class="spinner" style="display: inline-block; width: 14px; height: 14px;"></div> Saving...';
            saveBtn.disabled = true;
            
            const response = await fetch(`${this.apiBase}/projects/${this.currentNotesProjectId}/notes`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ notes })
            });
            
            if (response.ok) {
                // Update local project data
                const project = this.projects.find(p => p.projectId === this.currentNotesProjectId);
                if (project) {
                    project.notes = notes;
                    // Save to localStorage
                    this.saveProjectToStorage(project);
                    // Re-render to show/hide notes indicator
                    this.renderProjects();
                }
                
                this.hideNotesModal();
                
                // Show brief success feedback
                const successFeedback = document.createElement('div');
                successFeedback.style.cssText = 'position: fixed; top: 20px; right: 20px; background: var(--vscode-success); color: white; padding: 8px 16px; border-radius: 4px; z-index: 10001; font-size: 13px;';
                successFeedback.textContent = 'Notes saved';
                document.body.appendChild(successFeedback);
                
                setTimeout(() => {
                    document.body.removeChild(successFeedback);
                }, 2000);
                
            } else {
                const errorData = await response.json();
                this.showError(errorData.message || 'Failed to save notes');
            }
            
        } catch (error) {
            console.error('Error saving notes:', error);
            this.showError('Failed to save notes');
        } finally {
            // Restore button state
            const saveBtn = document.getElementById('saveNotesBtn');
            saveBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 4px; vertical-align: text-bottom;"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1H2z"/></svg>Save Notes';
            saveBtn.disabled = false;
        }
    }

    updateNotesCharCount() {
        const textarea = document.getElementById('notesTextarea');
        const charCount = document.getElementById('notesCharCount');
        const currentLength = textarea.value.length;
        const maxLength = 10240;
        
        charCount.textContent = currentLength;
        
        // Remove existing classes
        charCount.classList.remove('warning', 'error');
        
        // Add warning/error classes based on character count
        if (currentLength > maxLength * 0.9) {
            charCount.classList.add('warning');
        }
        if (currentLength > maxLength) {
            charCount.classList.add('error');
        }
    }
}

// Initialize the application
const app = new XaresAICoder();