# Agent Instructions for XaresAICoder Workspaces

Configure apps to work with XaresAICoder's proxy architecture.

## Hard Rule

**Bind to `0.0.0.0`**, never `localhost` or `127.0.0.1` — loopback binds are unreachable through the proxy.

## Accessing Your App

Each workspace app is exposed at a unique subdomain. The full URL template is pre-computed for the current deployment in `$VSCODE_PROXY_URI` with `{{port}}` as a placeholder — substitute your app's port:

```bash
echo $PROJECT_ID                                  # workspace ID
echo $VSCODE_PROXY_URI                            # template, e.g. http://abc123-{{port}}.<domain>/
echo "$VSCODE_PROXY_URI" | sed 's/{{port}}/5000/' # → real URL for port 5000
```

VS Code auto-detects common ports: `3000` Node/React, `3001` Node/React alt, `5000` Flask, `8000` Django/FastAPI, `8080` Spring, `4200` Angular, `9000` misc.

Workspace env vars: `PROJECT_ID`, `VSCODE_PROXY_URI` (templated app URL), `PROXY_DOMAIN` (workspace itself, `<id>.<domain>`).

## Bind Examples

- **Flask**: `app.run(host='0.0.0.0', port=5000)`
- **FastAPI**: `uvicorn.run(app, host="0.0.0.0", port=8000)`
- **Express**: `app.listen(3000, '0.0.0.0')`
- **Spring Boot** (`application.properties`): `server.address=0.0.0.0`
- **React dev server** (env): `HOST=0.0.0.0 PORT=3000`

## Patterns for Realtime / Stateful Demo Apps

When apps hold in-memory state, push live updates, or identify users, apply these by default. They prevent issues that look like bugs but are environment-level.

### Realtime sync: prefer polling, WebSockets work too
Plain WebSockets are supported by the proxy (used for dev-server hot-reload). **Socket.IO** specifically needs an async worker (eventlet/gevent) and adds its own polling-fallback layer that interacts awkwardly with the proxy — for simple realtime UIs (live counters, timers, leaderboards) short HTTP polling is the lower-friction default and avoids worker config:

- Client polls `/api/state` every 500 ms – 1 s with `fetch()`
- Server returns full current state as JSON on each call
- For countdowns, server returns absolute `deadline_ts` (Unix seconds); client computes `deadline_ts - Date.now()/1000` locally — don't tie smoothness to poll cadence

Reach for WebSockets when you genuinely need server-push at sub-second latency (chat, collab cursors). Skip Socket.IO unless you have a specific reason for it.

### Disable Flask's auto-reloader
Reloader restarts the process on every edit, wiping in-memory state. Keep tracebacks, drop the reloader:
```python
app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
```

### Cache-Control on every response
The proxy can serve stale GETs, freezing polled state. Set no-cache globally — HTML and JSON alike:
```python
@app.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response
```

### Client identity: query param + localStorage, not cookies
Cookies and custom headers can be stripped by the proxy. Pattern:
1. `POST /api/join` returns an ID in the JSON body
2. Client stores in `localStorage`
3. Client appends `?pid=<id>` on every subsequent GET and POST
4. Server reads `request.args.get('pid')` as source of truth

Reconnects become trivial.

### Reset endpoint
Provide `POST /api/reset` (admin-token-protected) to wipe in-memory state without restarting. Essential for iterating and live demos.

### Config via ENV
Read tokens, public URLs, feature flags from `os.environ`, not random startup values:
```python
HOST_TOKEN = os.environ.get('HOST_TOKEN', 'demo-token-change-me')
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Connection refused | Bound to `127.0.0.1`. `netstat -tuln \| grep <port>` must show `0.0.0.0:<port>`. |
| 502 Bad Gateway | App crashed or wrong port. Check `ps aux \| grep <app>` and logs. |
| State disappears between requests | Flask reloader on — set `use_reloader=False`. |
| Polled state looks frozen | Missing no-cache headers — add `@app.after_request`. |
| Per-user identity flaky | Cookies stripped — switch to `?pid=` + localStorage. |

```bash
ps aux | grep <app>                                    # running?
netstat -tuln | grep <port>                            # bound to 0.0.0.0?
curl http://localhost:<port>                           # responds locally inside container?
echo "$VSCODE_PROXY_URI" | sed "s/{{port}}/<port>/"    # external URL
```