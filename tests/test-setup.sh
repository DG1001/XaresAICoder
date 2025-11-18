#!/bin/bash

# XaresAICoder Setup Test Script
# Run from project root: ./tests/test-setup.sh

cd "$(dirname "$0")/.." || exit 1

echo "🚀 Testing XaresAICoder Setup..."

# Check if required files exist
echo "📁 Checking file structure..."
required_files=(
    "docker-compose.yml"
    ".env.example"
    "server/package.json"
    "server/Dockerfile"
    "code-server/Dockerfile"
    "frontend/index.html"
    "frontend/style.css"
    "frontend/app.js"
    "README.md"
    "nginx-base.conf.template"
    "nginx-git.conf.template"
    "deploy.sh"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ $file - MISSING"
        exit 1
    fi
done

# Check Docker
echo "🐳 Checking Docker..."
if command -v docker &> /dev/null; then
    echo "✅ Docker installed"
    if docker info &> /dev/null; then
        echo "✅ Docker daemon running"
    else
        echo "❌ Docker daemon not running"
        exit 1
    fi
else
    echo "❌ Docker not installed"
    exit 1
fi

# Check Docker Compose (v2 or v1)
echo "🔧 Checking Docker Compose..."
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    echo "✅ Docker Compose v2 installed"
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose v1 installed"
    COMPOSE_CMD="docker-compose"
else
    echo "❌ Docker Compose not installed"
    exit 1
fi

# Validate Docker Compose file
echo "📋 Validating Docker Compose configuration..."
if $COMPOSE_CMD config &> /dev/null; then
    echo "✅ Docker Compose configuration valid"
else
    echo "❌ Docker Compose configuration invalid"
    exit 1
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
fi

echo ""
echo "🎉 Setup test completed successfully!"
echo ""
echo "Next steps:"
echo "1. Run the deployment script:"
echo "   ./deploy.sh"
echo ""
echo "2. Or manually start the application:"
echo "   $COMPOSE_CMD up --build -d"
echo ""
echo "3. Open http://localhost in your browser"
echo ""
echo "📚 For detailed instructions, see README.md"
