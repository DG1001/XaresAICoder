FROM node:18-alpine

WORKDIR /app

# Install Docker CLI to manage containers
RUN apk add --no-cache docker-cli

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create workspaces directory
RUN mkdir -p workspaces

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]