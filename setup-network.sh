#!/bin/bash

# XaresAICoder Network Setup Script
# Creates persistent external Docker network for workspace containers

set -e

NETWORK_NAME="xares-aicoder-network"
NETWORK_SUBNET="172.19.0.0/16"

echo "🔧 Setting up XaresAICoder Docker network..."

# Check if network already exists
if docker network ls --format "{{.Name}}" | grep -q "^${NETWORK_NAME}$"; then
    echo "✅ Network '${NETWORK_NAME}' already exists"
    
    # Verify network configuration
    EXISTING_SUBNET=$(docker network inspect ${NETWORK_NAME} --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo "")
    
    if [ "$EXISTING_SUBNET" = "$NETWORK_SUBNET" ]; then
        echo "✅ Network configuration is correct (subnet: ${NETWORK_SUBNET})"
    else
        echo "⚠️  Network exists but with different subnet: ${EXISTING_SUBNET}"
        echo "   Expected: ${NETWORK_SUBNET}"
        echo "   This may cause connectivity issues."
        
        read -p "Do you want to recreate the network? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "🗑️  Removing existing network..."
            docker network rm ${NETWORK_NAME}
            echo "🔧 Creating new network..."
            docker network create \
                --driver bridge \
                --subnet=${NETWORK_SUBNET} \
                --opt com.docker.network.bridge.name=xares-aicoder0 \
                ${NETWORK_NAME}
            echo "✅ Network '${NETWORK_NAME}' created successfully"
        fi
    fi
else
    # Create new network
    echo "🔧 Creating network '${NETWORK_NAME}'..."
    docker network create \
        --driver bridge \
        --subnet=${NETWORK_SUBNET} \
        --opt com.docker.network.bridge.name=xares-aicoder0 \
        ${NETWORK_NAME}
    echo "✅ Network '${NETWORK_NAME}' created successfully"
fi

# Display network information
echo ""
echo "📋 Network Information:"
docker network inspect ${NETWORK_NAME} --format '{{printf "%-15s %s" "Name:" .Name}}'
docker network inspect ${NETWORK_NAME} --format '{{printf "%-15s %s" "Driver:" .Driver}}'
docker network inspect ${NETWORK_NAME} --format '{{range .IPAM.Config}}{{printf "%-15s %s" "Subnet:" .Subnet}}{{end}}'
docker network inspect ${NETWORK_NAME} --format '{{printf "%-15s %s" "Gateway:" .IPAM.Config.Gateway}}' 2>/dev/null || echo "Gateway:        Auto-assigned"

echo ""
echo "🚀 Network setup complete! You can now start XaresAICoder with docker-compose."
echo ""
echo "💡 This network will persist across docker-compose restarts, ensuring"
echo "   that stopped workspace containers can be restarted successfully."