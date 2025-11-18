#!/bin/bash

# Test script for verifying XaresAICoder deployment configurations
# Run from project root: ./tests/test-deployment.sh

cd "$(dirname "$0")/.." || exit 1

echo "=== XaresAICoder Deployment Configuration Test ==="
echo

# Test localhost configuration
echo "1. Testing localhost configuration..."
export BASE_DOMAIN=localhost BASE_PORT=80 PROTOCOL=http
echo "   Environment: BASE_DOMAIN=$BASE_DOMAIN, BASE_PORT=$BASE_PORT, PROTOCOL=$PROTOCOL"

# Generate nginx config snippet
echo "   Generated nginx config:"
sed 's/${BASE_DOMAIN}/localhost/g; s/${BASE_PORT}/80/g; s/${PROTOCOL}/http/g' build/nginx.conf.template | grep -A 3 "server_name"

echo
echo "   Expected URLs:"
echo "   - Main site: http://localhost"
echo "   - Workspace: http://workspace-abc123.localhost"
echo "   - App port: http://workspace-abc123-5000.localhost"
echo

# Test ci.infra configuration  
echo "2. Testing ci.infra:8000 configuration..."
export BASE_DOMAIN=ci.infra BASE_PORT=8000 PROTOCOL=http
echo "   Environment: BASE_DOMAIN=$BASE_DOMAIN, BASE_PORT=$BASE_PORT, PROTOCOL=$PROTOCOL"

# Generate nginx config snippet
echo "   Generated nginx config:"
sed 's/${BASE_DOMAIN}/ci.infra/g; s/${BASE_PORT}/8000/g; s/${PROTOCOL}/http/g' build/nginx.conf.template | grep -A 3 "server_name"

echo
echo "   Expected URLs:"
echo "   - Main site: http://ci.infra:8000"
echo "   - Workspace: http://workspace-abc123.ci.infra:8000"
echo "   - App port: http://workspace-abc123-5000.ci.infra:8000"
echo

# Test Docker Compose configuration
echo "3. Testing Docker Compose port mapping..."
echo "   With BASE_PORT=80:  nginx listens on 80:80"
echo "   With BASE_PORT=8000: nginx listens on 8000:8000"
echo

# Test environment files
echo "4. Testing environment files..."
if [ -f ".env" ]; then
    echo "   Default .env configuration:"
    grep -E "BASE_DOMAIN|BASE_PORT|PROTOCOL" .env | sed 's/^/     /'
fi

if [ -f ".env.ci.infra" ]; then
    echo "   CI .env.ci.infra configuration:"
    grep -E "BASE_DOMAIN|BASE_PORT|PROTOCOL" .env.ci.infra | sed 's/^/     /'
fi

echo
echo "=== Test Complete ==="
echo "To deploy:"
echo "  Localhost: docker compose up --build"
echo "  CI Server: cp .env.ci.infra .env && docker compose up --build"