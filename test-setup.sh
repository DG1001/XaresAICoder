#!/bin/bash

# XaresAICoder Setup Test Script
echo "🚀 Testing XaresAICoder Setup..."

# Check if required files exist
echo "📁 Checking file structure..."
required_files=(
    "docker-compose.yml"
    "nginx.conf"
    ".env.example"
    "server/package.json"
    "server/Dockerfile"
    "code-server/Dockerfile"
    "frontend/index.html"
    "frontend/style.css"
    "frontend/app.js"
    "README.md"
    "docs/user-guide.md"
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

# Check Docker Compose
echo "🔧 Checking Docker Compose..."
if command -v docker-compose &> /dev/null; then
    echo "✅ Docker Compose installed"
else
    echo "❌ Docker Compose not installed"
    exit 1
fi

# Validate Docker Compose file
echo "📋 Validating Docker Compose configuration..."
if docker-compose config &> /dev/null; then
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
echo "1. Build the code-server image:"
echo "   cd code-server && docker build -t xares-aicoder-codeserver:latest . && cd .."
echo ""
echo "2. Start the application:"
echo "   docker-compose up --build"
echo ""
echo "3. Open http://localhost in your browser"
echo ""
echo "📚 For detailed instructions, see README.md"