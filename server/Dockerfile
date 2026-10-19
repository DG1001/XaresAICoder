# Node 22 LTS (Node 18 is end of life); the major is pinned, patch updates come with rebuilds
FROM node:22-alpine

WORKDIR /app

# Install Docker CLI to manage containers
RUN apk add --no-cache docker-cli

# Copy package files
COPY package*.json ./

# Exactly the versions in package-lock.json, no dev dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy source code
COPY . .

# Create workspaces directory
RUN mkdir -p workspaces

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]