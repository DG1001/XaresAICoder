FROM codercom/code-server:latest

USER root

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    wget \
    unzip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for Flask development
RUN pip3 install flask python-dotenv requests

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Copy setup scripts
COPY setup-scripts/ /tmp/setup-scripts/
RUN chmod +x /tmp/setup-scripts/*.sh

# Install OpenCode SST
RUN /tmp/setup-scripts/setup-opencode.sh

# Install VS Code extensions
COPY extensions.txt /tmp/extensions.txt
RUN /tmp/setup-scripts/install-extensions.sh

# Setup workspace initialization
RUN /tmp/setup-scripts/workspace-init.sh

# Configure code-server
COPY config/code-server-config.yaml /home/coder/.config/code-server/config.yaml

# Set proper permissions
RUN chown -R coder:coder /workspace /home/coder
USER coder

# Expose code-server port
EXPOSE 8080

# Start code-server
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "password", "/workspace"]