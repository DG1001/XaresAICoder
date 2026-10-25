FROM codercom/code-server:4.141.0

USER root

# Silence npm's own update-notifier (avoids the "New major version of npm" notice
# during image builds and in the workspace update_* scripts). npm honours its
# NPM_CONFIG_* config via env; NO_UPDATE_NOTIFIER only affects third-party CLIs.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Install Node.js 22.x from NodeSource (Claude Code >=2.1.193 requires Node >=22).
# Keep the npm bundled with Node — do NOT upgrade to npm >=12, which blocks package
# lifecycle scripts by default (allowScripts). That breaks the AI tools whose
# postinstall fetches a native binary (Claude Code's install.cjs, Crush), leaving
# them non-functional in the image.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Install other system dependencies including ripgrep for OpenAI Codex
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    wget \
    unzip \
    ripgrep \
    tmux \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Squid CA certificate (if proxy is enabled)
# This allows workspace containers to trust the proxy's SSL interception
# Note: deploy.sh copies the real cert here when proxy is enabled (otherwise it's just a placeholder)
COPY squid-ca-cert.crt /tmp/squid-ca-cert.crt
RUN if [ -s /tmp/squid-ca-cert.crt ] && grep -q "BEGIN CERTIFICATE" /tmp/squid-ca-cert.crt 2>/dev/null; then \
        echo "Installing Squid CA certificate for HTTPS proxy support..."; \
        cp /tmp/squid-ca-cert.crt /usr/local/share/ca-certificates/squid-ca.crt && \
        update-ca-certificates && \
        echo "Squid CA certificate installed successfully"; \
    else \
        echo "No Squid CA certificate found - proxy not enabled"; \
    fi

# Install Python packages for Flask development using --break-system-packages
RUN pip3 install --break-system-packages \
    flask==3.1.1 \
    python-dotenv==1.1.1 \
    requests==2.32.4 \
    black \
    pytest

# Install uv (fast Python package installer)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    chmod +x /usr/local/bin/uv

# AI coding tools (CLI). They live in /opt/ai-tools, owned by coder, so
# update_ai_agents and the tools' own update commands (claude update, codex
# update, opencode upgrade, ...) work without sudo; `npm install -g` in a
# workspace goes there too. The directory is appended to PATH: a file placed
# there cannot shadow a system command (root uses the same PATH, e.g. when a
# clone snapshot is cleaned).
ENV NPM_CONFIG_PREFIX=/opt/ai-tools
ENV PATH=$PATH:/opt/ai-tools/bin
# Login shells get PATH from /etc/profile, which drops the one above
RUN echo 'case ":$PATH:" in *:/opt/ai-tools/bin:*) ;; *) PATH="$PATH:/opt/ai-tools/bin" ;; esac' \
    > /etc/profile.d/ai-tools.sh
# No automatic updates: workshop participants keep the versions of the image
# until somebody runs update_ai_agents (or a tool's own update command)
ENV DISABLE_AUTOUPDATER=1 \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    COPILOT_AUTO_UPDATE=false
# Kilo Code uploads every session (prompts, answers, tool output, code, diffs)
# to its cloud when signed in with a Kilo account; independent of telemetry,
# which code-server's disable-telemetry already switches off for Kilo
ENV KILO_DISABLE_SESSION_INGEST=1
# OpenAI Codex uses the system ripgrep
ENV VSCODE_RIPGREP_BINARY_PATH=/usr/bin/rg
ENV VSCODE_RIPGREP_FORCE_PATH=/usr/bin/rg
RUN mkdir -p /opt/ai-tools && \
    npm config set registry https://registry.npmjs.org/ && \
    npm install -g @anthropic-ai/claude-code @openai/codex @github/copilot \
        @charmland/crush @opencode/cli @earendil-works/pi-coding-agent && \
    # OpenCode pulls in all four Linux builds (glibc/musl, baseline); its
    # postinstall hard-links the matching one to bin/, the rest is ~700 MB
    rm -rf /opt/ai-tools/lib/node_modules/@opencode/cli/node_modules/@opencode && \
    opencode --version && \
    chown -R coder:coder /opt/ai-tools

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install gh -y \
    && rm -rf /var/lib/apt/lists/*

# Create workspace directory
RUN mkdir -p /workspace

# Copy template files for all workspaces
COPY template-files/AGENTS.md /workspace/AGENTS.md

WORKDIR /workspace

# Copy setup scripts
COPY setup-scripts/ /tmp/setup-scripts/
RUN chmod +x /tmp/setup-scripts/*.sh

# Setup workspace initialization first
RUN /tmp/setup-scripts/workspace-init.sh

# Configure code-server
COPY config/code-server-config.yaml /home/coder/.config/code-server/config.yaml

# Configure VS Code settings (including tmux terminal profile)
RUN mkdir -p /home/coder/.local/share/code-server/User
COPY config/settings.json /home/coder/.local/share/code-server/User/settings.json

# Configure tmux with mouse support
COPY config/.tmux.conf /home/coder/.tmux.conf

# Set proper permissions for coder user
RUN chown -R coder:coder /workspace /home/coder

# Switch to coder user before installing extensions
USER coder

# Install VS Code extensions as coder user
COPY extensions.txt /tmp/extensions.txt
RUN /tmp/setup-scripts/install-extensions.sh

# Extensions will be installed through extensions.txt

# Copy and setup the extension check and test scripts
USER root
COPY check-extensions.sh /usr/local/bin/check-extensions.sh
COPY test-extension-install.sh /usr/local/bin/test-extension-install.sh
RUN chmod +x /usr/local/bin/check-extensions.sh /usr/local/bin/test-extension-install.sh

# Run the test to debug extension installation (optional - can be removed after debugging)
# RUN /usr/local/bin/test-extension-install.sh

# Copy entrypoint script with auth override support
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER coder

# Expose code-server port
EXPOSE 8082

# Use entrypoint script to ensure extensions are installed
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8082", "--auth", "none", "/workspace"]