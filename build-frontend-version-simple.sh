#!/bin/bash

# Simple Frontend Version Builder
set -e

# Get version information
VERSION=$(git describe --tags --exact-match HEAD 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0-dev")
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BUILD_ENV="${BUILD_ENV:-production}"

echo "Building version: $VERSION"
echo "Git hash: $GIT_HASH"
echo "Build date: $BUILD_DATE"

# Create version.js file
cat > frontend/version.js << EOF
// Version information - automatically generated during deployment
window.APP_VERSION = {
    version: '${VERSION}',
    gitTag: '${VERSION}',
    gitHash: '${GIT_HASH}',
    buildDate: '${BUILD_DATE}',
    buildEnv: '${BUILD_ENV}'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.APP_VERSION;
}
EOF

# Update service worker cache names with safe version
SAFE_VERSION=$(echo "$VERSION" | sed 's/[^a-zA-Z0-9]/_/g')
sed -i "s/xaresaicoder-v1\.0\.0/xaresaicoder-${SAFE_VERSION}/g" frontend/sw.js
sed -i "s/xaresaicoder-static-v1\.0\.0/xaresaicoder-static-${SAFE_VERSION}/g" frontend/sw.js
sed -i "s/xaresaicoder-dynamic-v1\.0\.0/xaresaicoder-dynamic-${SAFE_VERSION}/g" frontend/sw.js

echo "✅ Version build completed successfully!"
echo "Generated version.js with version: $VERSION"
echo "Updated service worker cache names with: $SAFE_VERSION"