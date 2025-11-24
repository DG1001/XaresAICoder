# Agent Instructions for XaresAICoder Workspaces

This guide helps AI coding agents properly configure applications to work with XaresAICoder's proxy architecture.

## Critical Rule: Always Bind to 0.0.0.0

**NEVER bind to `localhost` or `127.0.0.1` - applications will not be accessible through the proxy.**

Applications MUST bind to `0.0.0.0` (all interfaces) to be accessible from outside the container.

## Quick Start Examples

### Python (Flask)
```python
from flask import Flask
app = Flask(__name__)

@app.route('/')
def index():
    return 'Hello World'

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)  # ← CRITICAL: host='0.0.0.0'
```

### Python (FastAPI)
```python
import uvicorn
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello World"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)  # ← CRITICAL: host="0.0.0.0"
```

### Node.js (Express)
```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Hello World'));

app.listen(3000, '0.0.0.0', () => {  // ← CRITICAL: '0.0.0.0'
  console.log('Server on port 3000');
});
```

### React Development Server
```json
// package.json
{
  "scripts": {
    "start": "HOST=0.0.0.0 PORT=3000 react-scripts start"
  }
}
```

Or in `.env` file:
```
HOST=0.0.0.0
PORT=3000
```

### Java (Spring Boot)
```properties
# application.properties
server.address=0.0.0.0
server.port=8080
```

## Accessing Your Application

Once your application is running on `0.0.0.0:<port>`:

**URL Pattern**: `http://<PROJECT_ID>-<port>.<BASE_DOMAIN>:<BASE_PORT>/`

### Get Your Project ID
```bash
echo $PROJECT_ID
```

### Example URLs
If `PROJECT_ID=abc123` and `BASE_DOMAIN=localhost`:
- Flask (port 5000): `http://abc123-5000.localhost/`
- Node.js (port 3000): `http://abc123-3000.localhost/`
- Spring Boot (port 8080): `http://abc123-8080.localhost/`

VS Code will auto-detect common ports and open browser tabs automatically.

## Environment Variables

Available in your workspace:
```bash
PROJECT_ID=<your-project-id>
VSCODE_PROXY_URI=http://<project-id>-{{port}}.<domain>/
PROXY_DOMAIN=<project-id>.<domain>
```

## Common Ports

- `3000` - Node.js, React
- `5000` - Flask
- `8000` - Django, FastAPI
- `8080` - Spring Boot
- `4200` - Angular
- `9000` - Other apps

## Verification Checklist

Before accessing your app, verify:

```bash
# 1. Check if application is running
ps aux | grep <your-app>

# 2. Verify it's listening on 0.0.0.0 (NOT 127.0.0.1)
netstat -tuln | grep <port>
# Should show: 0.0.0.0:<port>

# 3. Test locally inside container
curl http://localhost:<port>

# 4. Construct your URL
echo "http://${PROJECT_ID}-<port>.localhost/"
```

## Troubleshooting

### "Connection Refused" Error

**Cause**: Application bound to `localhost` instead of `0.0.0.0`

**Fix**:
```bash
# Check binding
netstat -tuln | grep <port>

# Should show: 0.0.0.0:<port>
# NOT: 127.0.0.1:<port>
```

Restart your application with `host='0.0.0.0'` parameter.

### "502 Bad Gateway" Error

**Causes**:
1. Application not started or crashed
2. Wrong port number
3. Application bound to wrong interface

**Debug**:
```bash
# Check if running
ps aux | grep <app>

# Check application logs
tail -f <log-file>

# Kill and restart
lsof -ti:<port> | xargs kill -9
python app.py  # or your start command
```

### URL Not Opening from VS Code

**Manual URL construction**:
```bash
PROJECT_ID=$(echo $PROJECT_ID)
PORT=5000
echo "Try: http://${PROJECT_ID}-${PORT}.localhost/"
```

Then open manually in browser.

## Making API Calls to XaresAICoder Backend

If your application needs to call the XaresAICoder API:

```javascript
// Use the base domain with /api path
const API_BASE = '/api';  // Relative path works from browser

// Example: Get project info
fetch(`/api/projects/${PROJECT_ID}`)
  .then(res => res.json())
  .then(data => console.log(data));
```

## Git Operations

If Git server is enabled, it's accessible at `/git`:

```bash
# Clone from integrated Git server
git clone http://localhost/git/username/repo.git

# For authenticated access with proxy, use .netrc:
cat > ~/.netrc << 'EOF'
machine your-domain.com
login git_username
password git_token
EOF
chmod 600 ~/.netrc
```

## Complete Documentation

For comprehensive details, see:
- **Full proxy architecture**: `docs/PROXY_ARCHITECTURE.md` in XaresAICoder repository
- **API reference**: `docs/API.md`
- **AI tools guide**: `docs/AI_TOOLS.md`
- **Troubleshooting**: `docs/TROUBLESHOOTING.md`

## Summary

1. **Always use `0.0.0.0`** - Never `localhost` or `127.0.0.1`
2. **URL pattern**: `http://$PROJECT_ID-<port>.localhost/`
3. **VS Code auto-detects** common ports
4. **Verify binding**: `netstat -tuln | grep <port>` should show `0.0.0.0:<port>`
5. **Your project ID**: Available in `$PROJECT_ID` environment variable

---

**Quick Test Command**:
```bash
# Start a simple Python server to test
python3 -m http.server 8000 --bind 0.0.0.0
# Then access: http://${PROJECT_ID}-8000.localhost/
```
