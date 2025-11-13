FROM codercom/code-server:latest

USER root

# Install Node.js 20.x from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
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
    && rm -rf /var/lib/apt/lists/*

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

# Install AI coding tools
# Install Aider AI pair programming tool
RUN pip3 install --break-system-packages aider-chat

# Install Node.js AI tools (first install most tools, then OpenAI Codex separately)
RUN npm install -g @google/gemini-cli @anthropic-ai/claude-code @qwen-code/qwen-code@latest @charmland/crush

# Install OpenAI Codex with environment variables to use system ripgrep
ENV VSCODE_RIPGREP_BINARY_PATH=/usr/bin/rg
ENV VSCODE_RIPGREP_FORCE_PATH=/usr/bin/rg
RUN npm config set registry https://registry.npmjs.org/ && \
    npm install -g @openai/codex || \
    (sleep 10 && npm install -g @openai/codex) || \
    (sleep 20 && npm install -g @openai/codex --ignore-scripts)

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install gh -y \
    && rm -rf /var/lib/apt/lists/*

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Copy setup scripts
COPY setup-scripts/ /tmp/setup-scripts/
RUN chmod +x /tmp/setup-scripts/*.sh

# Install OpenCode SST
RUN /tmp/setup-scripts/setup-opencode.sh

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

# Create a startup script that ensures extensions are installed
RUN echo '#!/bin/bash\n\
echo "Starting XaresAICoder code-server..."\n\
\n\
# Check and install missing extensions\n\
/usr/local/bin/check-extensions.sh\n\
\n\
# Start code-server with the provided arguments\n\
exec "$@"\n\
' > /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

USER coder

# Expose code-server port
EXPOSE 8082

# Use entrypoint script to ensure extensions are installed
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8082", "--auth", "none", "/workspace"]