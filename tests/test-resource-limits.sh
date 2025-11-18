#!/bin/bash
# Test script for resource limits feature
# Run from project root: ./tests/test-resource-limits.sh

cd "$(dirname "$0")/.." || exit 1

set -e

BASE_URL="${BASE_URL:-http://localhost}"
API_URL="${BASE_URL}/api"

echo "========================================="
echo "Resource Limits Test Script"
echo "========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check /api/limits endpoint
echo "Test 1: Checking /api/limits endpoint..."
LIMITS_RESPONSE=$(curl -s "${API_URL}/limits" || echo "ERROR")

if [[ "$LIMITS_RESPONSE" == *"maxConcurrentWorkspaces"* ]]; then
    echo -e "${GREEN}✓ PASS${NC} - /api/limits endpoint is working"
    echo "Response: $LIMITS_RESPONSE"
else
    echo -e "${RED}✗ FAIL${NC} - /api/limits endpoint not working"
    echo "Response: $LIMITS_RESPONSE"
    exit 1
fi
echo ""

# Test 2: Verify limit values
echo "Test 2: Verifying default limit values..."
MAX_CONCURRENT=$(echo "$LIMITS_RESPONSE" | grep -o '"maxConcurrentWorkspaces":[0-9]*' | grep -o '[0-9]*')
CPU_PER_WS=$(echo "$LIMITS_RESPONSE" | grep -o '"cpuPerWorkspace":[0-9.]*' | grep -o '[0-9.]*')
MEMORY_PER_WS=$(echo "$LIMITS_RESPONSE" | grep -o '"memoryPerWorkspaceMB":[0-9]*' | grep -o '[0-9]*')
ENABLED=$(echo "$LIMITS_RESPONSE" | grep -o '"enableResourceLimits":[a-z]*' | grep -o '[a-z]*')

echo "  Max Concurrent Workspaces: $MAX_CONCURRENT"
echo "  CPU per Workspace: $CPU_PER_WS cores"
echo "  Memory per Workspace: $MEMORY_PER_WS MB"
echo "  Limits Enabled: $ENABLED"

if [[ "$MAX_CONCURRENT" -ge 1 ]] && [[ "$CPU_PER_WS" != "" ]] && [[ "$MEMORY_PER_WS" -ge 1024 ]]; then
    echo -e "${GREEN}✓ PASS${NC} - Limit values are reasonable"
else
    echo -e "${RED}✗ FAIL${NC} - Limit values are invalid"
    exit 1
fi
echo ""

# Test 3: Check environment variables
echo "Test 3: Checking environment variables in .env.example..."
if grep -q "MAX_CONCURRENT_WORKSPACES" .env.example; then
    echo -e "${GREEN}✓ PASS${NC} - MAX_CONCURRENT_WORKSPACES found in .env.example"
else
    echo -e "${RED}✗ FAIL${NC} - MAX_CONCURRENT_WORKSPACES not in .env.example"
    exit 1
fi

if grep -q "CPU_PER_WORKSPACE" .env.example; then
    echo -e "${GREEN}✓ PASS${NC} - CPU_PER_WORKSPACE found in .env.example"
else
    echo -e "${RED}✗ FAIL${NC} - CPU_PER_WORKSPACE not in .env.example"
    exit 1
fi

if grep -q "MEMORY_PER_WORKSPACE_MB" .env.example; then
    echo -e "${GREEN}✓ PASS${NC} - MEMORY_PER_WORKSPACE_MB found in .env.example"
else
    echo -e "${RED}✗ FAIL${NC} - MEMORY_PER_WORKSPACE_MB not in .env.example"
    exit 1
fi

if grep -q "ENABLE_RESOURCE_LIMITS" .env.example; then
    echo -e "${GREEN}✓ PASS${NC} - ENABLE_RESOURCE_LIMITS found in .env.example"
else
    echo -e "${RED}✗ FAIL${NC} - ENABLE_RESOURCE_LIMITS not in .env.example"
    exit 1
fi
echo ""

# Test 4: Check docker-compose.yml
echo "Test 4: Checking environment variables in docker-compose.yml..."
if grep -q "MAX_CONCURRENT_WORKSPACES" docker-compose.yml; then
    echo -e "${GREEN}✓ PASS${NC} - MAX_CONCURRENT_WORKSPACES found in docker-compose.yml"
else
    echo -e "${RED}✗ FAIL${NC} - MAX_CONCURRENT_WORKSPACES not in docker-compose.yml"
    exit 1
fi
echo ""

# Test 5: Check README documentation
echo "Test 5: Checking README.md documentation..."
if grep -q "Resource Limits" README.md; then
    echo -e "${GREEN}✓ PASS${NC} - Resource Limits section found in README.md"
else
    echo -e "${RED}✗ FAIL${NC} - Resource Limits section not in README.md"
    exit 1
fi
echo ""

echo "========================================="
echo -e "${GREEN}All tests passed!${NC}"
echo "========================================="
echo ""
echo "Next steps for manual testing:"
echo "1. Start the application: docker compose up -d"
echo "2. Create workspaces until limit is reached"
echo "3. Try creating one more workspace - should see error"
echo "4. Stop a workspace and try creating again - should work"
echo ""
