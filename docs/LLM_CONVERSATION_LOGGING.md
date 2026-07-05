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
┌──────────────────────────┐
│     mitmproxy-logger     │
│  - SSL interception      │
│  - Domain recording      │  ← ALL requests
│  - LLM request/response  │  ← LLM API calls only
│    body capture           │
│  - SSE parsing            │
└──────────┬───────────────┘
           │ Writes JSON logs
           ▼
┌──────────────────────────┐
│  /var/log/mitmproxy/     │
│  ├── llm_conversations/  │  (LLM API calls)
│  │   ├── 172.30.0.5/    │
│  │   │   ├── 2025-*.json│
│  │   │   └── ...         │
│  │   └── 172.30.0.6/    │
│  └── domains/            │  (ALL accessed domains)
│      ├── 172.30.0.5.json │
│      └── 172.30.0.6.json │
└──────────────────────────┘
           │
           ▼
┌──────────────────────────┐
│  Backend API             │
│  - Retrieve LLM logs     │
│  - Generate docs         │
│  - Get recorded domains  │
│  - Apply as whitelist    │
└──────────────────────────┘
```

## Features

### Automatic Logging
- ✅ Captures all LLM API calls (OpenAI, Anthropic, Google, OpenCode, etc.)
- ✅ Supports streaming responses (Server-Sent Events)
- ✅ Per-workspace organization by container IP
- ✅ No configuration required in workspaces
- ✅ Works with all pre-installed AI tools

### Domain Recording & Whitelist Generation
- ✅ Records ALL accessed domains (not just LLM APIs)
- ✅ Per-workspace tracking with hit count, first/last seen timestamps
- ✅ Auto-categorization (Package Managers, AI APIs, Documentation, etc.)
- ✅ Apply recorded domains as Security Proxy whitelist
- ✅ Survives mitmproxy restarts (persistent storage)

### Documentation Generation
- ✅ Two documentation types: Clean and Detailed
- ✅ Markdown format for easy reading/sharing
- ✅ Streamed API requests grouped into sessions — the dialog is shown once
  instead of being repeated on every request
- ✅ Token usage summaries including Anthropic cache read/write tokens
- ✅ Full tool inputs and results in detailed mode (the actual code written)
- ✅ Conversation history in chronological order
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
data: {"type":"message_start","message":{"id":"msg_123","model":"...","usage":{"input_tokens":1234,"cache_read_input_tokens":18000,"output_tokens":1}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Here"}}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"Write","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\""}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":567}}
```

The logger:
1. Detects SSE format (lines starting with `event:`)
2. Parses each `data:` line as JSON
3. Extracts text from `content_block_delta` (`text_delta`) events
4. Reconstructs `tool_use` blocks from `content_block_start` plus the streamed
   `input_json_delta` fragments (keyed by block index), so tool-only turns with
   no text output are captured too
5. Reads token usage from **both** `message_start` (input + cache tokens) and
   `message_delta` (final `output_tokens`). This is essential: `message_start`
   only carries a placeholder `output_tokens` of 1, so ignoring `message_delta`
   makes completion token counts meaningless
6. Combines everything into the complete response

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
    "content": [
      {"type": "text", "text": "Here is the code..."},
      {"type": "tool_use", "name": "Write", "input": {"file_path": "/workspace/app.js", "content": "..."}}
    ],
    "usage": {
      "input_tokens": 1234,
      "cache_read_input_tokens": 18000,
      "cache_creation_input_tokens": 250,
      "output_tokens": 567
    }
  }
}
```

> Token accounting: the prompt total reported in the documentation is
> `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
> Anthropic bills cache reads/writes separately, so omitting them (as an
> earlier version did) drastically understates prompt size.

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

## Domain Recording & Whitelist Generation

### How Domain Recording Works

In addition to LLM conversation capture, mitmproxy records **every domain** accessed through the proxy. This enables teachers to discover which domains are needed for a project and create a targeted whitelist.

**What gets recorded:**
- Domain name (not full URLs) for every HTTP/HTTPS request
- Hit count per domain
- First seen and last seen timestamps
- Organized per workspace IP address

**Storage format** (`/var/log/mitmproxy/domains/{client_ip}.json`):
```json
{
  "pypi.org": {"count": 15, "first_seen": "2026-02-14T10:00:00Z", "last_seen": "2026-02-14T11:30:00Z"},
  "api.anthropic.com": {"count": 3, "first_seen": "2026-02-14T10:05:00Z", "last_seen": "2026-02-14T11:00:00Z"},
  "github.com": {"count": 8, "first_seen": "2026-02-14T10:02:00Z", "last_seen": "2026-02-14T11:25:00Z"}
}
```

**Recording behavior:**
- New domains written to disk immediately
- Hit counts and last_seen flushed to disk every 60 seconds
- Existing data loaded from disk on mitmproxy startup (survives restarts)
- Domain tracking happens in both `request()` and `response()` hooks

### Viewing Recorded Domains

1. Create a workspace with **LLM Logging Proxy** mode
2. Work in the workspace (install packages, use AI tools, browse docs)
3. Click the **globe icon** next to the workspace name
4. View domains grouped by auto-detected category:
   - **Package Managers**: pypi.org, npmjs.org, maven.org, etc.
   - **AI APIs**: openai.com, anthropic.com, googleapis.com, etc.
   - **Documentation**: docs.python.org, stackoverflow.com, etc.
   - **Version Control**: github.com, gitlab.com
   - **System**: debian.org, ubuntu.com
   - **Other**: everything else

### Applying as Whitelist

1. In the Recorded Domains modal, check/uncheck domains as needed
2. Click **"Apply as Security Proxy Whitelist"**
3. The selected domains are sent to `PUT /api/whitelist`
4. The server merges with base defaults, normalizes to squid format, and reconfigures squid
5. New Security Proxy workspaces immediately use the updated whitelist

**Via API:**
```bash
# View recorded domains for a workspace
curl http://localhost/api/projects/{projectId}/recorded-domains

# Apply domains as whitelist
curl -X PUT http://localhost/api/whitelist \
  -H "Content-Type: application/json" \
  -d '{"domains": ["pypi.org", "api.anthropic.com", "github.com", "registry.npmjs.org"]}'

# View current whitelist
curl http://localhost/api/whitelist
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
**Sessions:** 1
**Total API Requests:** 3
**Type:** Clean (User/Assistant conversation only)

## Summary
- **claude-opus-4-8**: 3 API requests, 20,690 tokens

## Conversation History

## Session 1
**Model:** claude-opus-4-8
**Time:** 1/15/2025, 2:30:45 PM – 1/15/2025, 2:34:10 PM
**API Requests:** 3
**Tokens:** Prompt: 19,486, Completion: 1,204, Total: 20,690

**user:**
```
Please help me implement user authentication
```

**assistant:**
```
I'll help you implement user authentication...
```
```

**Best for:**
- Project summaries
- Sharing with team members
- Student learning reflection
- Quick conversation review

### Detailed Documentation (📋)

**Purpose:** Complete technical details for debugging and analysis

**Includes:**
- ALL messages (system, user, assistant, tool), rendered once per session
- System prompts (truncated at 5000 chars)
- Full tool inputs and results — the actual code written/edited and commands run
- Token usage breakdown including cache read/write tokens
- A per-session API request breakdown table (time, tokens, request id)
- Message numbering and role labels

**Example Output:**
```markdown
# AI Coding Session Documentation (Detailed)

**Generated:** 2025-01-15T14:30:00.000Z
**Sessions:** 1
**Total API Requests:** 2
**Type:** Detailed (Complete technical details)

## Conversation History

## Session 1
**Model:** claude-opus-4-8
**Time:** 1/15/2025, 2:30:45 PM – 1/15/2025, 2:31:30 PM
**API Requests:** 2
**Tokens:** Prompt: 28,940, Completion: 1,120, Total: 30,060

#### Dialog

**Message 1 (user):**
```
Please help me implement user authentication
```

**Message 2 (assistant):**
```
I'll add a login form and a session helper.
[Tool Use: Write]
{
  "file_path": "/workspace/auth.js",
  "content": "export function login(user, pass) { ... }"
}
```

**Message 3 (user):**
```
[Tool Result]
File created successfully at: /workspace/auth.js
```

**Final Response (assistant):**
```
Done — authentication is wired up. Want me to add password hashing next?
```

#### API Request Breakdown (2)

| # | Time | Prompt | Completion | Total | Request ID |
|---|------|--------|------------|-------|------------|
| 1 | 1/15/2025, 2:30:45 PM | 14,210 | 612 | 14,822 | msg_abc123 |
| 2 | 1/15/2025, 2:31:30 PM | 14,730 | 508 | 15,238 | msg_def456 |
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

**⚠️ Recordings are partitioned by container IP, not by a stable project ID.**
The mitmproxy logger keys every conversation (and domain record) on the client
container's IP. Two workspaces running at the same time have different IPs and
stay cleanly separated — but Docker assigns IPs dynamically from the subnet pool
and the logs are never pruned automatically. Two consequences:

- **Cross-workspace mixing:** if a workspace is deleted and its IP is later
  reused by a new workspace, the new workspace inherits the old directory, and
  its conversation/domain views will include the earlier workspace's recordings.
  In effect the data is no longer strictly per-workspace.
- **Orphaned history:** if a workspace restarts and gets a different IP, its
  earlier conversations remain under the old IP and no longer appear in the
  API/UI for that project (see Troubleshooting → "IP Address Changed, Lost
  Conversations").

For workshop-style use with many short-lived workspaces this is worth keeping in
mind. Deleting a workspace's conversations before its IP is recycled, or keying
logs on the project ID instead of the IP (see Future Enhancements → Static IP
Assignment), would avoid it.

### Session Grouping & Filtering

**Session grouping:** Each streamed API request carries the full, growing
conversation history, so rendering requests individually repeats the whole
dialog on every request. The generator instead groups requests whose message
histories share a common prefix into a single session, then renders the dialog
once from the fullest request in the group. Prefix matching uses per-message
fingerprints that normalize string vs. text-block content and serialize tool
inputs as canonical (key-sorted) JSON, so equivalent messages match despite
harness re-serialization. Requests are sorted chronologically; grouping is by
conversation prefix, **not** by workspace.

**Clean documentation filtering:**
- Only user and assistant messages
- Harness noise is stripped (`<system-reminder>`, `<local-command-*>` and
  `<command-*>` wrappers) rather than dropping the entire message — this keeps
  the real first user prompt, which the earlier filter discarded

**Detailed documentation:**
- All roles: system, user, assistant, tool
- Full system prompts (truncated at 5000 chars)
- Full tool inputs and results, plus a per-session API request breakdown table

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
1. **Tool-only turn** — the assistant produced only a tool call and no text.
   These are now captured (the response shows the tool call); only very old logs
   recorded before this fix show a truly empty response.

2. **Streaming responses not parsed correctly**
   - Check mitmproxy logs for SSE parsing errors

3. **Old logs before the SSE token/tool fixes**
   - Correct `output_tokens` and response-side tool calls are only recorded for
     conversations captured *after* the fix. Older JSON logs stored a
     placeholder `output_tokens` and no response tool calls, and can't be fixed
     retroactively. Tool inputs in the request history and session grouping *do*
     apply retroactively, since the request messages were logged in full.

4. **Non-standard API format**
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
