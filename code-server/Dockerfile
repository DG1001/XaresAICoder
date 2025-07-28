FROM codercom/code-server:latest

USER root

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    wget \
    unzip \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for Flask development using --break-system-packages
RUN pip3 install --break-system-packages \
    flask==3.1.1 \
    python-dotenv==1.1.1 \
    requests==2.32.4 \
    black \
    flake8 \
    pytest \
    pylint

# Install AI coding tools
# Install Aider AI pair programming tool
RUN pip3 install --break-system-packages aider-chat

# Install Node.js AI tools (Gemini CLI and Claude Code)
RUN npm install -g @google/gemini-cli @anthropic-ai/claude-code

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

# Set proper permissions for coder user
RUN chown -R coder:coder /workspace /home/coder

# Switch to coder user before installing extensions
USER coder

# Install VS Code extensions as coder user
COPY extensions.txt /tmp/extensions.txt
RUN /tmp/setup-scripts/install-extensions.sh

# Install Continue AI extension specifically (since it might need special handling)
USER root
COPY install-continue.sh /tmp/install-continue.sh
RUN chmod +x /tmp/install-continue.sh && /tmp/install-continue.sh

# Copy and setup the extension check and test scripts
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
EXPOSE 8080

# Use entrypoint script to ensure extensions are installed
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "none", "/workspace"]