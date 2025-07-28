// XaresAICoder Frontend Application
class XaresAICoder {
    constructor() {
        this.apiBase = '/api';
        this.projects = [];
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadProjects();
        
        // Load projects from localStorage for offline display
        this.loadProjectsFromStorage();
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

    async handleCreateProject(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const projectName = formData.get('projectName').trim();
        const projectType = formData.get('projectType');

        if (!projectName || !projectType) {
            this.showError('Please fill in all required fields');
            return;
        }

        if (projectType === 'node-react') {
            this.showError('Node.js React projects are coming soon! Please select Python Flask for now.');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch(`${this.apiBase}/projects/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    projectName,
                    projectType
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Failed to create project');
            }

            // Success! Open the workspace
            const project = data.project;
            this.saveProjectToStorage(project);
            
            // Clear form
            e.target.reset();
            
            // Show success message with instructions
            this.showWorkspaceReady(project);
            
            // Refresh project list
            this.loadProjects();

        } catch (error) {
            console.error('Error creating project:', error);
            this.showError(error.message || 'Failed to create project. Please try again.');
        } finally {
            this.showLoading(false);
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
                    <h4>${this.escapeHtml(project.projectName)}</h4>
                    <div class="project-meta">
                        <span class="project-status ${this.getStatusClass(project.status)}">${this.getStatusLabel(project.status)}</span>
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
        if (!confirm(`Are you sure you want to delete the project "${projectName}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/projects/${projectId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (response.ok) {
                this.removeProjectFromStorage(projectId);
                this.loadProjects();
            } else {
                this.showError(data.message || 'Failed to delete project');
            }

        } catch (error) {
            console.error('Error deleting project:', error);
            this.showError('Failed to delete project. Please try again.');
        }
    }

    async startProject(projectId) {
        try {
            this.setProjectActionLoading(projectId, true);
            
            const response = await fetch(`${this.apiBase}/projects/${projectId}/start`, {
                method: 'POST'
            });

            const data = await response.json();

            if (response.ok) {
                this.loadProjects(); // Refresh the list to show updated status
            } else {
                this.showError(data.message || 'Failed to start project');
            }

        } catch (error) {
            console.error('Error starting project:', error);
            this.showError('Failed to start project. Please try again.');
        } finally {
            this.setProjectActionLoading(projectId, false);
        }
    }

    async stopProject(projectId) {
        if (!confirm('Are you sure you want to stop this workspace? Any unsaved work will be lost.')) {
            return;
        }

        try {
            this.setProjectActionLoading(projectId, true);
            
            const response = await fetch(`${this.apiBase}/projects/${projectId}/stop`, {
                method: 'POST'
            });

            const data = await response.json();

            if (response.ok) {
                this.loadProjects(); // Refresh the list to show updated status
            } else {
                this.showError(data.message || 'Failed to stop project');
            }

        } catch (error) {
            console.error('Error stopping project:', error);
            this.showError('Failed to stop project. Please try again.');
        } finally {
            this.setProjectActionLoading(projectId, false);
        }
    }

    getProjectActionButtons(project) {
        const isRunning = project.status === 'running';
        const isStopped = project.status === 'stopped';
        const isError = project.status === 'error';

        let buttons = '';

        if (isRunning) {
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

        buttons += `
            <button class="btn-danger" onclick="app.deleteProject('${project.projectId}', '${this.escapeHtml(project.projectName)}')">
                Delete
            </button>
        `;

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

    showWorkspaceReady(project) {
        // Show a success modal with workspace access instructions
        const modal = document.getElementById('successModal') || this.createSuccessModal();
        const projectNameElement = modal.querySelector('#successProjectName');
        const workspaceUrlElement = modal.querySelector('#successWorkspaceUrl');
        
        projectNameElement.textContent = project.projectName;
        workspaceUrlElement.href = project.workspaceUrl;
        workspaceUrlElement.textContent = project.workspaceUrl;
        
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

    getProjectTypeLabel(type) {
        const labels = {
            'python-flask': 'Python Flask',
            'node-react': 'Node.js React'
        };
        return labels[type] || type;
    }

    getStatusLabel(status) {
        const labels = {
            'running': 'Running',
            'stopped': 'Stopped',
            'error': 'Error',
            'not_found': 'Not Found'
        };
        return labels[status] || status;
    }

    getStatusClass(status) {
        const classes = {
            'running': 'status-running',
            'stopped': 'status-stopped',
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