// XaresAICoder Frontend Application
class XaresAICoder {
    constructor() {
        this.apiBase = this.detectApiBase();
        this.projects = [];
        this.pollingInterval = null;
        this.creatingProjects = new Set(); // Track projects being created
        this.init();
    }

    detectApiBase() {
        // For same-origin requests, use relative paths
        // This works for both localhost and ci.infra:8000 deployments
        return '/api';
    }

    init() {
        this.bindEvents();
        this.loadProjects();
        
        // Load projects from localStorage for offline display
        this.loadProjectsFromStorage();
        
        // Start polling for project status updates
        this.startPolling();
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
    }

    handleTabSwitch(e) {
        const clickedItem = e.currentTarget;
        const targetTab = clickedItem.dataset.tab;
        
        // Remove active class from all nav items and tab panels
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        
        // Add active class to clicked nav item and corresponding tab panel
        clickedItem.classList.add('active');
        document.getElementById(`${targetTab}-tab`).classList.add('active');
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
        const passwordProtected = formData.get('passwordProtected') === 'on';
        const workspacePassword = formData.get('workspacePassword');

        if (!projectName || !projectType) {
            this.showError('Please fill in all required fields');
            return;
        }

        if (passwordProtected && (!workspacePassword || workspacePassword.length < 8)) {
            this.showError('Password must be at least 8 characters long');
            return;
        }


        const requestBody = {
            projectName,
            projectType
        };

        if (passwordProtected) {
            requestBody.passwordProtected = true;
            requestBody.password = workspacePassword;
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
                    </h4>
                    <div class="project-meta">
                        <span class="project-status ${this.getStatusClass(project.status, project.workspaceUrl)}">${this.getStatusLabel(project.status, project.workspaceUrl)}</span>
                        <span>${this.getProjectTypeLabel(project.projectType)}</span>
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
            'java-spring': 'Java Spring Boot'
        };
        return labels[type] || type;
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
}

// Initialize the application
const app = new XaresAICoder();