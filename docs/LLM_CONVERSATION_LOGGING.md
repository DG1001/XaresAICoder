# LLM Conversation Logging & Documentation Generation

XaresAICoder automatically captures and logs all LLM API conversations from workspaces, enabling automatic documentation generation and learning reflection.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [How It Works](#how-it-works)
- [Using the Feature](#using-the-feature)
- [Documentation Types](#documentation-types)
- [API Endpoints](#api-endpoints)
- [Configuration](#configuration)
- [Technical Details](#technical-details)
- [Privacy & Security](#privacy--security)
- [Troubleshooting](#troubleshooting)

## Overview

This feature transparently captures all LLM API traffic from workspace containers through the mitmproxy-based network proxy. Captured conversations include:

- Full request prompts (including system prompts, user messages, tool calls)
- Complete AI responses (text, streaming SSE responses, tool outputs)
- Token usage and cost metrics
- Model information and parameters
- Timestamps and metadata

The captured data enables:
- **Automatic Documentation**: Generate markdown documentation from AI coding sessions
- **Learning Reflection**: Students can review their AI-assisted development process
- **Cost Tracking**: Monitor token usage across projects
- **Debugging**: Investigate AI behavior and prompt engineering

## Architecture

```
┌─────────────────────┐
│  Workspace Container │
│  (with AI tools)     │
└──────────┬───────────┘
           │ HTTP/HTTPS
           ▼
┌─────────────────────┐
│   mitmproxy-logger  │
│  - SSL interception  │
│  - Request/response  │
│    body capture      │
│  - SSE parsing       │
└──────────┬───────────┘
           │ Writes JSON logs
           ▼
┌─────────────────────┐
│  /var/log/mitmproxy/│
│  llm_conversations/  │
│  ├── 172.30.0.5/    │ (per workspace IP)
│  │   ├── 2025-*.json│
│  │   └── ...         │
│  └── 172.30.0.6/    │
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Backend API        │
│  - Retrieve logs     │
│  - Generate docs     │
└─────────────────────┘
```

## Features

### Automatic Logging
- ✅ Captures all LLM API calls (OpenAI, Anthropic, Google, OpenCode, etc.)
- ✅ Supports streaming responses (Server-Sent Events)
- ✅ Per-workspace organization by container IP
- ✅ No configuration required in workspaces
- ✅ Works with all pre-installed AI tools

### Documentation Generation
- ✅ Two documentation types: Clean and Detailed
- ✅ Markdown format for easy reading/sharing
- ✅ Token usage summaries
- ✅ Conversation history with timestamps
- ✅ Downloadable documentation files

### Conversation Management
- ✅ View all conversations in browser
- ✅ Filter by model, date range
- ✅ Delete individual conversations
- ✅ Clear all workspace conversations
- ✅ Search and pagination support

## How It Works

### 1. Proxy-Based Capture

When a workspace has proxy enabled:
```bash
# Environment variables set in container
HTTP_PROXY=http://mitmproxy-logger:8080
HTTPS_PROXY=http://mitmproxy-logger:8080
```

All HTTP/HTTPS traffic routes through mitmproxy, which:
1. Intercepts LLM API calls to known domains
2. Captures request body (prompts, parameters)
3. Captures response body (AI output, token usage)
4. Parses API-specific formats (JSON, SSE)
5. Writes complete conversation to JSON file

### 2. LLM Domain Detection

The logger monitors these domains:
- `api.openai.com` - OpenAI (ChatGPT, GPT-4, etc.)
- `api.anthropic.com` - Anthropic (Claude)
- `generativelanguage.googleapis.com` - Google (Gemini)
- `api.google.dev` - Google AI
- `api.opencode.ai` - OpenCode
- `opencode.ai` - OpenCode free tier
- `api.huggingface.co` - Hugging Face

### 3. SSE Response Handling

For streaming APIs (Claude Code, Claude API):
```
event: message_start
data: {"type":"message_start","message":{"id":"msg_123","model":"claude-3-5-sonnet-20241022"}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Here"}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" is"}}
```

The logger:
1. Detects SSE format (lines starting with `event:`)
2. Parses each `data:` line as JSON
3. Extracts text from `content_block_delta` events
4. Combines chunks into complete response

### 4. JSON Log Format

Each conversation is stored as:
```json
{
  "client_ip": "172.30.0.5",
  "timestamp": "2025-01-15T10:30:45.123Z",
  "method": "POST",
  "url": "https://api.anthropic.com/v1/messages",
  "headers": {...},
  "body": "{\"model\":\"claude-3-5-sonnet-20241022\",\"messages\":[...]}",
  "parsed_request": {
    "model": "claude-3-5-sonnet-20241022",
    "messages": [...],
    "max_tokens": 4096,
    "temperature": 1.0
  },
  "response": {
    "status_code": 200,
    "headers": {...},
    "body": "event: message_start\ndata: {...}",
    "timestamp": "2025-01-15T10:30:47.456Z"
  },
  "parsed_response": {
    "id": "msg_abc123",
    "model": "claude-3-5-sonnet-20241022",
    "content": [{"type": "text", "text": "Here is the code..."}],
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567
    }
  }
}
```

## Using the Feature

### Viewing Conversations

1. **Enable proxy for workspace** (required for logging)
   - Check "Use Network Proxy" when creating workspace
   - Or enable globally with `ENABLE_PROXY=true` in `.env`

2. **Open AI Conversations Modal**
   - Look for network icon (⊕) next to workspace name
   - Click document icon (📄) or "AI Conversations" button
   - View list of all captured conversations

3. **Browse Conversations**
   - Click conversation headers to expand/collapse
   - View full request/response JSON
   - See timestamps, models, token usage

### Generating Documentation

**Method 1: From Modal**
1. Open AI Conversations modal
2. Click **📄 Clean Docs** or **📋 Detailed Docs**
3. Confirm generation
4. Documentation downloads automatically

**Method 2: Via API**
```bash
curl -X POST http://localhost/api/projects/{projectId}/generate-documentation \
  -H "Content-Type: application/json" \
  -d '{"format":"markdown","type":"clean"}'
```

### Managing Conversations

**Delete Individual Conversation:**
1. Open AI Conversations modal
2. Click delete icon (🗑️) next to conversation
3. Confirm deletion

**Clear All Conversations:**
1. Open AI Conversations modal
2. Click "Clear All" button
3. Confirm deletion

**Via API:**
```bash
# Delete all
curl -X DELETE http://localhost/api/projects/{projectId}/llm-conversations

# Delete specific conversation
curl -X DELETE http://localhost/api/projects/{projectId}/llm-conversations/{timestamp}
```

## Documentation Types

### Clean Documentation (📄)

**Purpose:** Easy-to-read conversation summaries for sharing and review

**Includes:**
- User messages only
- AI assistant responses only
- Token usage summary
- Model information
- Timestamps

**Excludes:**
- System prompts
- Tool calls and results
- Internal system messages
- `<system-reminder>` tags

**Example Output:**
```markdown
# AI Coding Session Documentation (Clean)

**Generated:** 2025-01-15T14:30:00.000Z
**Total Conversations:** 5
**Type:** Clean (User/Assistant conversation only)

## Summary
- **claude-3-5-sonnet-20241022**: 3 conversations, 12,456 tokens
- **gpt-4**: 2 conversations, 8,234 tokens

## Conversation History

### Conversation 1
**Time:** 1/15/2025, 2:30:45 PM
**Model:** claude-3-5-sonnet-20241022

#### Request
**user:**
```
Please help me implement user authentication
```

#### Response
```
I'll help you implement user authentication...
```

**Tokens:** Prompt: 234, Completion: 567, Total: 801
```

**Best for:**
- Project summaries
- Sharing with team members
- Student learning reflection
- Quick conversation review

### Detailed Documentation (📋)

**Purpose:** Complete technical details for debugging and analysis

**Includes:**
- ALL messages (system, user, assistant, tool)
- System prompts (truncated at 5000 chars)
- Request parameters (max_tokens, temperature)
- Response metadata (status codes, IDs)
- Complete token usage breakdown
- Tool use indicators
- Message numbering and role labels

**Example Output:**
```markdown
# AI Coding Session Documentation (Detailed)

**Generated:** 2025-01-15T14:30:00.000Z
**Total Conversations:** 5
**Type:** Detailed (Complete technical details)

## Conversation History

### Conversation 1
**Time:** 1/15/2025, 2:30:45 PM
**Model:** claude-3-5-sonnet-20241022
**Endpoint:** https://api.anthropic.com/v1/messages
**Request ID:** msg_abc123

#### Request
**Message 1 (system):**
```
You are Claude Code, Anthropic's official CLI...
(5000+ char system prompt)
```

**Message 2 (user):**
```
Please help me implement user authentication
```

**Request Parameters:**
- Max Tokens: 4096
- Temperature: 1.0

#### Response
```
I'll help you implement user authentication...
```

**Token Usage:**
- Prompt: 1234
- Completion: 567
- Total: 1801

**Response Metadata:**
- Status Code: 200
- Response Time: 2025-01-15T14:30:47.456Z
```

**Best for:**
- Debugging AI behavior
- Prompt engineering analysis
- Cost tracking and optimization
- Understanding system prompts
- Technical troubleshooting

## API Endpoints

### Get LLM Conversations

```
GET /api/projects/:projectId/llm-conversations
```

**Query Parameters:**
- `limit` (default: 100) - Number of conversations to return
- `offset` (default: 0) - Pagination offset
- `model` - Filter by model name
- `dateFrom` - Filter conversations after date (ISO 8601)
- `dateTo` - Filter conversations before date (ISO 8601)

**Response:**
```json
{
  "success": true,
  "projectId": "abc-123",
  "ipAddress": "172.30.0.5",
  "conversations": [...],
  "count": 50
}
```

### Generate Documentation

```
POST /api/projects/:projectId/generate-documentation
```

**Request Body:**
```json
{
  "format": "markdown",
  "type": "clean"
}
```

**Parameters:**
- `format`: `markdown` or `json` (default: `markdown`)
- `type`: `clean` or `detailed` (default: `clean`)

**Response:**
```json
{
  "success": true,
  "projectId": "abc-123",
  "format": "markdown",
  "type": "clean",
  "documentation": "# AI Coding Session Documentation...",
  "conversationCount": 50
}
```

### Delete All Conversations

```
DELETE /api/projects/:projectId/llm-conversations
```

**Response:**
```json
{
  "success": true,
  "message": "All conversations deleted successfully"
}
```

### Delete Single Conversation

```
DELETE /api/projects/:projectId/llm-conversations/:timestamp
```

**Parameters:**
- `timestamp`: Conversation timestamp (from filename, e.g., `2025-01-15T10-30-45-123Z`)

**Response:**
```json
{
  "success": true,
  "message": "Conversation deleted successfully"
}
```

## Configuration

### Environment Variables

**.env file:**
```bash
# Enable proxy feature globally (affects all new workspaces)
ENABLE_PROXY=true

# LLM logging is always enabled when proxy is enabled
# No separate toggle needed
```

### Per-Workspace Configuration

Each workspace can individually enable/disable proxy:
- **With proxy**: Conversations are logged
- **Without proxy**: No logging, direct internet access

To enable for specific workspace:
1. Check "Use Network Proxy" during creation
2. Or use API: `{"useProxy": true}`

### Retention Policy

Conversations are stored indefinitely. To manage storage:

**Manual cleanup:**
```bash
# Delete all conversations for workspace
curl -X DELETE http://localhost/api/projects/{projectId}/llm-conversations
```

**Automated cleanup (future):**
- Environment variable: `LLM_LOG_RETENTION_DAYS=30`
- Cron job to delete old logs (not yet implemented)

## Technical Details

### mitmproxy Configuration

**Container:** `xaresaicoder-mitmproxy-logger`

**Command:**
```bash
mitmproxy \
  --mode regular \
  --listen-host 0.0.0.0 \
  --listen-port 8080 \
  --set ssl_insecure=true \
  -s /scripts/llm-logger.py
```

**Volumes:**
- `./mitmproxy/llm-logger.py:/scripts/llm-logger.py:ro` - Logging script
- `mitmproxy_logs:/var/log/mitmproxy` - Log storage
- `./squid/certs:/certs:ro` - CA certificate (for future use)

### SSL Certificate Trust

**Workspace containers** trust the mitmproxy CA certificate:

```dockerfile
# code-server/Dockerfile
COPY squid/certs/squid-ca-cert.pem /usr/local/share/ca-certificates/squid-ca.crt
RUN update-ca-certificates
```

This enables HTTPS interception without SSL errors.

### Log File Organization

```
/var/log/mitmproxy/llm_conversations/
├── 172.30.0.5/               # Workspace container IP
│   ├── 2025-01-15T10-30-45-123Z.json
│   ├── 2025-01-15T10-31-12-456Z.json
│   └── ...
├── 172.30.0.6/               # Different workspace
│   └── 2025-01-15T11-00-00-789Z.json
└── ...
```

- One directory per workspace IP address
- One JSON file per conversation
- Filename is ISO 8601 timestamp (colons/dots replaced with hyphens)
- Files sorted chronologically

### IP-to-Project Mapping

Backend maps workspace IP to project ID:

```javascript
// Get workspace IP from project ID
const ipAddress = await dockerService.getWorkspaceIPAddress(projectId);

// Files stored at: /var/log/mitmproxy/llm_conversations/{ipAddress}/
```

**Note:** IP addresses are dynamic and reused when workspaces are deleted/recreated. Conversation logs remain associated with the IP, not the project ID.

### Filtering Logic

**Clean documentation filtering:**
```javascript
// Only include user and assistant messages
const conversationMessages = conv.parsed_request.messages.filter(msg =>
  msg.role === 'user' || msg.role === 'assistant'
);

// Skip system-reminder tags
content = msg.content.filter(block =>
  block.type === 'text' && !block.text?.includes('<system-reminder>')
);
```

**Detailed documentation:**
- Includes ALL roles: system, user, assistant, tool
- Shows complete system prompts (truncated at 5000 chars)
- Displays tool use/result indicators

## Privacy & Security

### Data Captured

**What's logged:**
- ✅ User prompts and questions
- ✅ AI responses and code suggestions
- ✅ API keys in request headers (if sent)
- ✅ Model parameters and settings
- ✅ Token usage and costs

**What's NOT logged:**
- ❌ Workspace file contents (unless sent to AI)
- ❌ Terminal commands (unless sent to AI)
- ❌ Git credentials
- ❌ Non-LLM network traffic

### API Key Exposure

**Risk:** API keys appear in request headers and are logged in JSON files.

**Mitigation:**
- Logs stored in Docker volume (not exposed to network)
- Only accessible via backend API (requires project access)
- Consider encrypting log files (future enhancement)

**Best practice:**
- Use API keys with minimal scopes
- Rotate keys regularly
- Delete conversations when no longer needed

### Compliance Considerations

**For Educational Use:**
- Students should be informed of conversation logging
- Provide option to review/delete their conversations
- Consider data retention policies (30-90 days)

**For Commercial Use:**
- May need user consent for logging AI interactions
- Consider GDPR/privacy law implications
- Implement automated log deletion after retention period

### Disabling Logging

To completely disable conversation logging:

**Option 1: Disable proxy globally**
```bash
# .env
ENABLE_PROXY=false
```

**Option 2: Per-workspace**
- Uncheck "Use Network Proxy" during creation
- Workspace bypasses mitmproxy, no logging occurs

**Option 3: Remove mitmproxy service**
```bash
# docker-compose.yml
# Comment out mitmproxy-logger service
```

## Troubleshooting

### No Conversations Captured

**Problem:** AI Conversations modal shows "No conversations found"

**Solutions:**
1. **Check proxy enabled:**
   - Workspace must have proxy enabled
   - Look for network icon (⊕) next to workspace name

2. **Verify mitmproxy running:**
   ```bash
   docker ps | grep mitmproxy
   docker logs xaresaicoder-mitmproxy-logger
   ```

3. **Check workspace environment:**
   ```bash
   docker exec workspace-{id} env | grep -i proxy
   # Should show: HTTP_PROXY=http://mitmproxy-logger:8080
   ```

4. **Verify LLM API calls:**
   - Make a prompt in workspace AI tool
   - Check mitmproxy logs for interception
   ```bash
   docker logs xaresaicoder-mitmproxy-logger | grep "Logged LLM"
   ```

### SSL/Certificate Errors in Workspace

**Problem:** AI tools fail with SSL certificate errors

**Solution:**
```bash
# In workspace container
sudo update-ca-certificates
```

**Prevention:**
- Ensure `squid/certs/squid-ca-cert.pem` exists
- Rebuild code-server image to include certificate

### Empty Responses in Documentation

**Problem:** Documentation shows requests but empty responses

**Causes:**
1. **Streaming responses not parsed correctly**
   - Check mitmproxy logs for SSE parsing errors

2. **Old logs before SSE support**
   - Generate new conversations
   - Old logs can't be retroactively fixed

3. **Non-standard API format**
   - Some APIs may use different response formats
   - Update `llm-logger.py` to support new formats

### Large Documentation Files

**Problem:** Detailed documentation is 50+ MB and slow to download

**Cause:** System prompts are very large (e.g., Claude Code has ~100KB system prompt per conversation)

**Solutions:**
1. **Use clean documentation** - Excludes system prompts
2. **Limit conversations:**
   ```bash
   # Generate docs for last 10 conversations only
   curl -X POST .../generate-documentation \
     -d '{"type":"detailed","limit":10}'
   ```
3. **System prompt truncation** - Already implemented (5000 char limit)

### Logs Not Persisting After Restart

**Problem:** Conversations disappear after Docker restart

**Cause:** `mitmproxy_logs` volume not configured properly

**Solution:**
```bash
# Check volume exists
docker volume ls | grep mitmproxy

# Recreate volume if missing
docker-compose down
docker volume create mitmproxy_logs
docker-compose up -d
```

### IP Address Changed, Lost Conversations

**Problem:** Workspace IP changed, can't find old conversations

**Cause:** Docker reassigns IPs when containers restart

**Solution:**
1. **Check old IP directories:**
   ```bash
   docker exec xaresaicoder-mitmproxy-logger \
     ls -la /var/log/mitmproxy/llm_conversations/
   ```

2. **Manual retrieval:**
   ```bash
   # List all conversations across all IPs
   docker exec xaresaicoder-mitmproxy-logger \
     find /var/log/mitmproxy/llm_conversations -name "*.json"
   ```

3. **Prevention:**
   - Use static IP assignment (future enhancement)
   - Associate logs with project ID instead of IP

## Future Enhancements

### Planned Features

1. **Log Encryption**
   - Encrypt JSON files to protect API keys
   - Decrypt on-demand during documentation generation

2. **Automated Retention**
   - Environment variable: `LLM_LOG_RETENTION_DAYS`
   - Cron job to delete old logs
   - Per-project retention settings

3. **Cost Analytics Dashboard**
   - Token usage visualization
   - Cost estimates by model
   - Per-project spending reports
   - Monthly usage trends

4. **Advanced Filtering**
   - Search conversations by content
   - Filter by token usage range
   - Group by project/model/date
   - Export to CSV/Excel

5. **Conversation Replay**
   - Replay conversations in UI
   - Interactive prompt/response viewer
   - Diff tool for prompt iterations

6. **Static IP Assignment**
   - Assign fixed IPs to workspaces
   - Persist conversation history across restarts
   - Associate logs with project ID

7. **Multiple Export Formats**
   - PDF documentation
   - HTML with syntax highlighting
   - LaTeX for academic papers
   - JSON for programmatic access

8. **Collaborative Features**
   - Share conversations via link
   - Comment on specific prompts/responses
   - Team conversation library

## Contributing

To extend LLM conversation logging:

1. **Add new LLM provider:**
   ```python
   # mitmproxy/llm-logger.py
   LLM_DOMAINS = [
       'api.openai.com',
       'your-llm-provider.com'  # Add here
   ]
   ```

2. **Add new response format:**
   ```python
   # Handle custom API response format
   if 'x-custom-api' in flow.response.headers:
       log_data['parsed_response'] = parse_custom_format(resp_body)
   ```

3. **Add new documentation format:**
   ```javascript
   // server/src/services/documentation.js
   function generateCustomDocumentation(conversations) {
       // Your custom format logic
   }
   ```

## References

- [mitmproxy Documentation](https://docs.mitmproxy.org/)
- [Anthropic API - Streaming](https://docs.anthropic.com/claude/reference/messages-streaming)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)

## Support

For issues or questions:
- GitHub Issues: https://github.com/anthropics/xares-aicoder/issues
- Documentation: `/docs/`
- Feature Branch: `feature/llm-conversation-logging`
