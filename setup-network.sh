#!/usr/bin/env bash

# XaresAICoder Network Setup Script
# Creates persistent external Docker network for workspace containers
# 
# Features:
# - Detects and prevents subnet conflicts with existing Docker networks
# - Automatically suggests alternative subnets if conflicts are found
# - Uses intelligent overlap detection via Python ipaddress module
# - Falls back to basic conflict detection if Python is not available

set -e

NETWORK_NAME="xares-aicoder-network"
NETWORK_SUBNET="172.19.0.0/16"

echo "🔧 Setting up XaresAICoder Docker network..."

# Function to check if a subnet overlaps with existing networks
check_subnet_conflicts() {
    local requested_subnet="$1"
    local conflicting_networks=""
    
    echo "🔍 Checking for subnet conflicts..."
    
    # Get all existing network subnets
    existing_subnets=$(docker network ls --format "{{.Name}}" | while read network; do
        if [ "$network" != "$NETWORK_NAME" ]; then
            docker network inspect "$network" --format '{{.Name}}: {{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | grep -v ": $" || true
        fi
    done)
    
    if [ -n "$existing_subnets" ]; then
        echo "📋 Existing Docker networks and their subnets:"
        echo "$existing_subnets" | sed 's/^/   /'
        echo
        
        # Check for overlaps using Python if available, or basic checks
        if command -v python3 >/dev/null 2>&1; then
            conflicts=$(echo "$existing_subnets" | python3 -c "
import sys
import ipaddress

requested = ipaddress.IPv4Network('$requested_subnet', strict=False)
conflicts = []

for line in sys.stdin:
    if ':' in line:
        network_name = line.split(':')[0].strip()
        subnets = line.split(':')[1].strip().split()
        for subnet in subnets:
            if subnet and '/' in subnet:
                try:
                    existing = ipaddress.IPv4Network(subnet.strip(), strict=False)
                    if requested.overlaps(existing):
                        conflicts.append(f'{network_name} ({subnet})')
                except:
                    pass

if conflicts:
    print('\\n'.join(conflicts))
" 2>/dev/null || true)
            
            if [ -n "$conflicts" ]; then
                echo "⚠️  SUBNET CONFLICT DETECTED!"
                echo "   The requested subnet $requested_subnet overlaps with:"
                echo "$conflicts" | sed 's/^/     - /'
                echo
                echo "   This could cause network connectivity issues."
                echo "   Consider using a different subnet or removing conflicting networks."
                echo
                return 1
            fi
        else
            # Basic check without Python - just check for exact matches
            if echo "$existing_subnets" | grep -q "$requested_subnet"; then
                echo "⚠️  SUBNET CONFLICT DETECTED!"
                echo "   The subnet $requested_subnet is already in use."
                echo "   Consider using a different subnet."
                echo
                return 1
            fi
        fi
    fi
    
    echo "✅ No subnet conflicts detected"
    return 0
}

# Check if network already exists
if docker network ls --format "{{.Name}}" | grep -q "^${NETWORK_NAME}$"; then
    echo "✅ Network '${NETWORK_NAME}' already exists"
    
    # Verify network configuration
    EXISTING_SUBNET=$(docker network inspect ${NETWORK_NAME} --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo "")
    
    if [ "$EXISTING_SUBNET" = "$NETWORK_SUBNET" ]; then
        echo "✅ Network configuration is correct (subnet: ${NETWORK_SUBNET})"
    else
        # A different subnet is normal: when ${NETWORK_SUBNET} was taken on the
        # first deploy, one of the alternatives below was used. The network is
        # kept as it is; workspaces are attached to it.
        echo "✅ Keeping existing subnet ${EXISTING_SUBNET} (default ${NETWORK_SUBNET} was taken or changed)"
    fi
else
    # Check for subnet conflicts before creating new network
    if ! check_subnet_conflicts "$NETWORK_SUBNET"; then
        echo "🔄 Attempting to find alternative subnet..."
        
        # Try alternative subnets
        alternative_subnets=("172.20.0.0/16" "172.21.0.0/16" "172.22.0.0/16" "10.100.0.0/16")
        
        for alt_subnet in "${alternative_subnets[@]}"; do
            echo "   Trying subnet: $alt_subnet"
            if check_subnet_conflicts "$alt_subnet"; then
                NETWORK_SUBNET="$alt_subnet"
                echo "✅ Using alternative subnet: $NETWORK_SUBNET"
                break
            fi
        done
        
        # If no alternative found, ask user
        if ! check_subnet_conflicts "$NETWORK_SUBNET" >/dev/null 2>&1; then
            echo "❌ No suitable alternative subnet found automatically."
            echo
            # Without a terminal read fails at EOF; set -e must not end the script
            read -p "Enter a custom subnet (e.g., 172.25.0.0/16) or press Enter to proceed anyway: " custom_subnet || custom_subnet=""
            if [ -n "$custom_subnet" ]; then
                NETWORK_SUBNET="$custom_subnet"
                echo "Using custom subnet: $NETWORK_SUBNET"
            else
                echo "⚠️  Proceeding with potentially conflicting subnet: $NETWORK_SUBNET"
                echo "   Monitor for network connectivity issues."
            fi
        fi
    fi
    
    # Create new network
    echo "🔧 Creating network '${NETWORK_NAME}' with subnet ${NETWORK_SUBNET}..."
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