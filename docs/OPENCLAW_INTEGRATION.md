# OpenClaw Integration Options for XaresAICoder

## What is OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source autonomous AI agent (145k+ GitHub stars) with:
- **Local-first Gateway** — single WebSocket control plane for sessions, channels, tools, and events
- **Multi-channel messaging** — WhatsApp, Telegram, Slack, Discord, Microsoft Teams, Signal, WebChat
- **MCP support** — Model Context Protocol for tool integration
- **Browser automation** — Chrome/Chromium control via CDP
- **Cron & webhooks** — scheduled tasks and event triggers
- **Skills ecosystem** — ClawHub marketplace for installable capabilities
- **Multi-agent routing** — isolated agents with per-agent sessions
- **Docker deployment** — production-ready containerized setup

Runs on Node.js >= 22. See the [official site](https://openclaw.ai/) for details.

---

## Integration Options

Four integration approaches, ordered from simplest to most ambitious.

### Option 1: Workspace Agent — OpenClaw Inside Each Container

**What:** Pre-install OpenClaw in the code-server Docker image alongside the existing 9 AI tools. Each workspace gets its own local OpenClaw Gateway.

**Why it's compelling:**
- OpenClaw's multi-tool design (browser, cron, canvas, file access) gives students an autonomous assistant that goes beyond code chat — it can browse docs, schedule tasks, and orchestrate workflows
- Skills from ClawHub can be installed per-workspace (linting, testing, deployment)
- Students interact via the built-in WebChat channel right in their browser, no external accounts needed

**Implementation:**
- Add OpenClaw install to `code-server/Dockerfile` (follow existing `npm install -g` pattern)
- Add `setup_openclaw` helper in `code-server/setup-scripts/workspace-init.sh`
- Start the OpenClaw Gateway as a background daemon on container init (port 18789, localhost only)
- Expose WebChat UI via code-server port forwarding (`<projectId>-18789.<baseDomain>`)
- Inject workspace context (`$PROJECT_ID`, `$GIT_SERVER_URL`, etc.) into OpenClaw's `AGENTS.md` so it understands its environment

**Effort:** Low — follows established AI tool integration pattern

---

### Option 2: Platform Orchestrator — Workspace Management via Chat (Recommended)

**What:** Run a dedicated OpenClaw instance alongside the XaresAICoder server. Give it custom skills that call the XaresAICoder REST API. Teachers interact via WhatsApp/Telegram/Slack.

**Why it's compelling:**
- Teachers manage workshops from their phone — no need for the web UI or curl
- OpenClaw's cron feature enables scheduled management: auto-start containers at 9am, auto-stop at 5pm
- Natural language interface to the existing API
- Multi-channel: teacher uses Telegram, TA uses Slack — both control the same platform
- Zero changes to existing XaresAICoder code (just calls the REST API)
- Deploys as a separate optional Docker service (like Forgejo)

**Example interactions:**
```
Teacher (WhatsApp): "Set up my Flask workshop for tomorrow, 30 students"
OpenClaw: "Created base workspace 'flask-workshop'. Cloning 30 copies with
           password 'flask2026'. Progress: 15/30... Done! All workspaces ready.
           URLs: https://xares.example.com/projects"

Teacher: "How many workspaces are still running?"
OpenClaw: "12 of 30 workspaces are running. 18 have been idle for 2+ hours."

Teacher: "Stop the idle ones"
OpenClaw: "Stopped 18 idle workspaces. 12 still active."
```

**Implementation:**
- Run OpenClaw in a separate Docker container on the `xares-aicoder-network`
- Create a custom OpenClaw skill package (`xaresaicoder-skill`) with tools:
  - `workspace_create(name, type, count, password, gitUrl)`
  - `workspace_list(status_filter?)`
  - `workspace_stop(projectId | "idle")`
  - `workspace_clone(sourceId, count, password)`
  - `whitelist_get()` / `whitelist_set(domains[])`
- Each tool calls the corresponding XaresAICoder REST API endpoint
- Configure OpenClaw channels (WhatsApp/Telegram/Slack) for the teacher
- Add to `docker-compose.yml` as an optional service

**Effort:** Medium — new Docker service + custom skill package, no changes to existing XaresAICoder code

---

### Option 3: Smart Monitoring & Assessment Agent

**What:** Extend Option 2 with proactive monitoring using OpenClaw's cron + the existing LLM logging proxy data.

**Why it's compelling:**
- Periodically check workspace health and alert teachers to issues
- Analyze captured LLM conversations (already stored by mitmproxy) for per-student progress summaries
- Auto-generate whitelist suggestions from LLM Logging Proxy recorded domains
- Detect unusual patterns (excessive API usage, stuck students, inactive workspaces)

**Example interactions:**
```
OpenClaw (proactive, 10:30am): "3 students haven't made any AI queries in
  30 minutes. Workspaces: alice-flask, bob-flask, carol-flask. Want me to
  check if they need help?"

Teacher: "Show me a summary of AI usage for the class"
OpenClaw: "Workshop 'flask-intro' (25 students):
  - Avg AI queries: 47/student
  - Most used tool: Claude Code (62%), Aider (28%), Cline (10%)
  - Top topics: Flask routing, Jinja templates, SQLAlchemy
  - 3 students appear stuck on database migration
  Here's the full report: [link to generated doc]"
```

**Implementation:**
- Add OpenClaw cron skills that poll:
  - `GET /api/projects` — workspace status
  - `GET /api/projects/:id/llm-conversations` — AI usage data
  - `GET /api/projects/:id/recorded-domains` — network activity
- Build a summarization skill that processes conversation logs through an LLM
- Use OpenClaw's `sessions_send` to proactively message the teacher channel
- Optional: add a `GET /api/workspace/stats` enhancement to aggregate per-workshop metrics server-side

**Effort:** Medium-High — builds on Option 2, needs conversation analysis logic

---

### Option 4: Multi-Agent Classroom — Coordinated Workspace Agents

**What:** Each workspace has its own OpenClaw agent (Option 1), plus a central orchestrator (Option 2). The central agent coordinates with workspace agents via OpenClaw's multi-agent routing.

**Why it's compelling:**
- Teacher broadcasts instructions to all workspace agents simultaneously: *"Everyone switch to the testing branch and run the test suite"*
- Workspace agents escalate to the teacher: *"Student bob-flask is getting repeated authentication errors — might need help"*
- Peer assistance: OpenClaw routes questions between student workspaces when appropriate
- Fully autonomous workshop progression: OpenClaw walks students through exercises step-by-step

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│  Teacher (WhatsApp/Telegram/Slack)              │
│         ↕                                       │
│  Central OpenClaw (orchestrator)                │
│    ├── XaresAICoder Skill (manage workspaces)   │
│    ├── Monitoring Skill (health + LLM logs)     │
│    └── Multi-Agent Router                       │
│         ↕ sessions_send / sessions_history      │
│  ┌──────────┬──────────┬──────────┐             │
│  │ WS Agent │ WS Agent │ WS Agent │  ...        │
│  │ (alice)  │  (bob)   │ (carol)  │             │
│  │ WebChat  │ WebChat  │ WebChat  │             │
│  └──────────┴──────────┴──────────┘             │
└─────────────────────────────────────────────────┘
```

**Implementation:**
- Central OpenClaw runs as a Docker service with access to the Docker network
- Workspace OpenClaws register with the central Gateway on startup (or via shared config)
- Central agent uses `sessions_send` to broadcast commands to workspace agents
- Workspace agents report status back via `sessions_send`
- Requires either: (a) shared Gateway with multi-agent routing, or (b) inter-container WebSocket communication
- Add lifecycle hooks to XaresAICoder: emit events when workspaces are created/destroyed so the central agent can track them

**Effort:** High — significant architectural addition, inter-agent communication, lifecycle hooks

---

## Recommendation

**Start with Option 2 (Platform Orchestrator)** — it delivers the highest value with the least disruption:
- Zero changes to existing XaresAICoder code (just calls the REST API)
- Deploys as a separate optional Docker service
- Immediately useful for teachers managing workshops from their phone
- Natural stepping stone to Options 3 and 4
- OpenClaw's Docker deployment and skill system make this straightforward

Option 1 (workspace agent) is the easiest to implement but adds less unique value since XaresAICoder already has 9 AI tools. Option 2 fills an actual gap — there's currently no conversational/mobile interface for platform management.

## References

- [OpenClaw GitHub Repository](https://github.com/openclaw/openclaw)
- [OpenClaw Official Site](https://openclaw.ai/)
- [OpenClaw AGENTS.md](https://github.com/openclaw/openclaw/blob/main/AGENTS.md)
- [OpenClaw Docker Deployment](https://github.com/willbullen/openclaw-docker)
- [OpenClaw MCP Server](https://github.com/freema/openclaw-mcp)
- [OpenClaw Security Hardening Guide](https://composio.dev/blog/secure-openclaw-moltbot-clawdbot-setup)
