#!/usr/bin/env python3
"""
mitmproxy addon that captures full LLM API conversations
and records all accessed domains per workspace for whitelist generation.
Logs request/response bodies to per-workspace JSON files.
"""

import json
import os
import time
from datetime import datetime
from mitmproxy import ctx, http

LOG_DIR = "/var/log/mitmproxy/llm_conversations"
DOMAINS_DIR = "/var/log/mitmproxy/domains"

LLM_DOMAINS = [
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'api.google.dev',
    'cloudcode-pa.googleapis.com',  # Gemini CLI uses this (Code Assist backend)
    'api.opencode.ai',
    'opencode.ai',  # OpenCode free tier uses opencode.ai/zen/v1/
    'api.huggingface.co',
    'z.ai',  # z.ai LLM API
    'api.z.ai',
    'api.deepseek.com',
    'openrouter.ai',
    'chatgpt.com',  # Codex CLI with ChatGPT login (streams via WebSocket)
]

class LLMConversationLogger:
    def __init__(self):
        os.makedirs(LOG_DIR, exist_ok=True)
        os.makedirs(DOMAINS_DIR, exist_ok=True)
        # Domain tracker: {client_ip: {domain: {count, first_seen, last_seen}}}
        self.domain_tracker = {}
        self._last_flush_time = time.time()
        self._load_existing_domains()

    def _load_existing_domains(self):
        """Load existing domain files from disk on startup."""
        try:
            for filename in os.listdir(DOMAINS_DIR):
                if filename.endswith('.json'):
                    ip = filename[:-5]  # Remove .json
                    filepath = os.path.join(DOMAINS_DIR, filename)
                    with open(filepath, 'r') as f:
                        self.domain_tracker[ip] = json.load(f)
            if self.domain_tracker:
                ctx.log.info(f"Loaded domain data for {len(self.domain_tracker)} workspace(s)")
        except Exception as e:
            ctx.log.warn(f"Error loading existing domain data: {e}")

    def _track_domain(self, flow):
        """Track domain from any request, keyed by client IP."""
        try:
            client_ip = flow.client_conn.peername[0]
            domain = flow.request.host
            now = datetime.utcnow().isoformat()

            # Detect external deletion — if in-memory data exists but file was removed, reset
            if client_ip in self.domain_tracker:
                filepath = os.path.join(DOMAINS_DIR, f"{client_ip}.json")
                if not os.path.exists(filepath):
                    del self.domain_tracker[client_ip]

            if client_ip not in self.domain_tracker:
                self.domain_tracker[client_ip] = {}

            ip_domains = self.domain_tracker[client_ip]
            is_new = domain not in ip_domains

            if is_new:
                ip_domains[domain] = {
                    'count': 1,
                    'first_seen': now,
                    'last_seen': now
                }
                # Write to disk immediately for new domains
                self._write_domains(client_ip)
            else:
                ip_domains[domain]['count'] += 1
                ip_domains[domain]['last_seen'] = now

            # Periodic flush every 60 seconds for count/last_seen updates
            if time.time() - self._last_flush_time >= 60:
                self._flush_all_domains()
                self._last_flush_time = time.time()
        except Exception as e:
            ctx.log.warn(f"Error tracking domain: {e}")

    def _write_domains(self, client_ip):
        """Write domain data for a specific client IP to disk."""
        try:
            filepath = os.path.join(DOMAINS_DIR, f"{client_ip}.json")
            with open(filepath, 'w') as f:
                json.dump(self.domain_tracker[client_ip], f, indent=2)
        except Exception as e:
            ctx.log.warn(f"Error writing domain data for {client_ip}: {e}")

    def _flush_all_domains(self):
        """Flush all domain data to disk."""
        for client_ip in self.domain_tracker:
            self._write_domains(client_ip)

    def request(self, flow: http.HTTPFlow):
        """Capture request data and track domain."""
        # Track ALL domains for whitelist generation (before LLM check)
        self._track_domain(flow)

        if not any(domain in flow.request.host for domain in LLM_DOMAINS):
            return

        client_ip = flow.client_conn.peername[0]

        flow.metadata['llm_log'] = {
            'client_ip': client_ip,
            'timestamp': datetime.utcnow().isoformat(),
            'method': flow.request.method,
            'url': flow.request.pretty_url,
            'headers': dict(flow.request.headers),
            'body': flow.request.text if flow.request.text else None
        }

    def response(self, flow: http.HTTPFlow):
        """Capture response and write complete conversation."""
        # Track domain in response too (catches HTTPS CONNECT tunnels)
        self._track_domain(flow)

        if 'llm_log' not in flow.metadata:
            return

        log_data = flow.metadata['llm_log']

        # Add response
        log_data['response'] = {
            'status_code': flow.response.status_code,
            'headers': dict(flow.response.headers),
            'body': flow.response.text if flow.response.text else None,
            'timestamp': datetime.utcnow().isoformat()
        }

        # Parse LLM-specific fields
        try:
            if log_data['body']:
                req_json = json.loads(log_data['body'])
                log_data['parsed_request'] = {
                    'model': req_json.get('model'),
                    'messages': req_json.get('messages'),
                    'prompt': req_json.get('prompt'),
                    'max_tokens': req_json.get('max_tokens'),
                    'temperature': req_json.get('temperature')
                }

            if log_data['response']['body']:
                resp_body = log_data['response']['body']

                # Check if response is SSE format (Anthropic streaming)
                if resp_body.startswith('event:') or '\nevent:' in resp_body:
                    # Parse SSE response. Blocks are keyed by their stream index
                    # so text and tool_use blocks can be reassembled in order.
                    blocks_by_index = {}
                    usage_data = None
                    model_name = None
                    message_id = None

                    for line in resp_body.split('\n'):
                        if line.startswith('data: '):
                            try:
                                event_data = json.loads(line[6:])  # Remove 'data: ' prefix
                                etype = event_data.get('type')

                                # Extract model and ID from message_start.
                                # NOTE: usage here only has input/cache tokens and a
                                # placeholder output_tokens (1). Final output_tokens
                                # arrive later in message_delta.
                                if etype == 'message_start':
                                    msg = event_data.get('message', {})
                                    model_name = msg.get('model')
                                    message_id = msg.get('id')
                                    usage_data = msg.get('usage')

                                # Merge final usage from message_delta. This carries the
                                # real cumulative output_tokens (and sometimes updated
                                # cache figures), so it must overwrite the placeholder.
                                elif etype == 'message_delta':
                                    delta_usage = event_data.get('usage')
                                    if delta_usage:
                                        usage_data = {**(usage_data or {}), **delta_usage}

                                # A new block begins — record text or tool_use metadata
                                elif etype == 'content_block_start':
                                    idx = event_data.get('index', 0)
                                    cb = event_data.get('content_block', {})
                                    if cb.get('type') == 'tool_use':
                                        blocks_by_index[idx] = {
                                            'type': 'tool_use',
                                            'id': cb.get('id'),
                                            'name': cb.get('name'),
                                            'json_buf': ''
                                        }
                                    elif cb.get('type') == 'text':
                                        blocks_by_index[idx] = {'type': 'text', 'text': cb.get('text', '')}

                                # Deltas append text or streamed tool-input JSON
                                elif etype == 'content_block_delta':
                                    idx = event_data.get('index', 0)
                                    delta = event_data.get('delta', {})
                                    if delta.get('type') == 'text_delta':
                                        blk = blocks_by_index.setdefault(idx, {'type': 'text', 'text': ''})
                                        blk['text'] = blk.get('text', '') + delta.get('text', '')
                                    elif delta.get('type') == 'input_json_delta':
                                        blk = blocks_by_index.setdefault(idx, {'type': 'tool_use', 'json_buf': ''})
                                        blk['json_buf'] = blk.get('json_buf', '') + delta.get('partial_json', '')
                            except json.JSONDecodeError:
                                pass

                    # Assemble content blocks in stream order
                    combined_content = []
                    for idx in sorted(blocks_by_index.keys()):
                        blk = blocks_by_index[idx]
                        if blk['type'] == 'text':
                            if blk.get('text'):
                                combined_content.append({'type': 'text', 'text': blk['text']})
                        elif blk['type'] == 'tool_use':
                            tool_input = {}
                            buf = blk.get('json_buf', '')
                            if buf:
                                try:
                                    tool_input = json.loads(buf)
                                except json.JSONDecodeError:
                                    tool_input = {'_raw': buf}
                            combined_content.append({
                                'type': 'tool_use',
                                'id': blk.get('id'),
                                'name': blk.get('name'),
                                'input': tool_input
                            })

                    log_data['parsed_response'] = {
                        'id': message_id,
                        'model': model_name,
                        'content': combined_content,
                        'usage': usage_data
                    }
                else:
                    # Regular JSON response (OpenAI, OpenCode, etc.)
                    resp_json = json.loads(resp_body)
                    log_data['parsed_response'] = {
                        'id': resp_json.get('id'),
                        'model': resp_json.get('model'),
                        'choices': resp_json.get('choices'),
                        'content': resp_json.get('content'),
                        'usage': resp_json.get('usage')
                    }
        except (json.JSONDecodeError, AttributeError, TypeError, KeyError) as e:
            ctx.log.warn(f"Failed to parse payload for {log_data['url']}: {type(e).__name__}")

        # Skip logging if either request or response body is empty
        # (streaming chunks, health checks, or incomplete conversations)
        if not log_data.get('body') or not log_data['response'].get('body'):
            ctx.log.debug(f"Skipping incomplete conversation: {log_data['url']}")
            return

        # Skip logging if no model is present in the request
        # (filters out internal events, telemetry, non-LLM API calls)
        if not log_data.get('parsed_request', {}).get('model'):
            ctx.log.debug(f"Skipping non-LLM request (no model): {log_data['url']}")
            return

        # Write to per-workspace directory
        client_ip = log_data['client_ip']
        workspace_dir = os.path.join(LOG_DIR, client_ip)
        os.makedirs(workspace_dir, exist_ok=True)

        timestamp = log_data['timestamp'].replace(':', '-').replace('.', '-')
        filename = f"{timestamp}.json"

        with open(os.path.join(workspace_dir, filename), 'w') as f:
            json.dump(log_data, f, indent=2, ensure_ascii=False)

        ctx.log.info(f"Logged LLM conversation: {client_ip} -> {log_data['url']}")

    # ---- WebSocket capture (Codex CLI streams model calls via WS) ----
    # Codex holds ONE WebSocket open for the whole session, so waiting for
    # websocket_end would make the conversation invisible until the user
    # quits. Instead the growing frame buffer is flushed to the same file
    # every WS_FLUSH_FRAMES frames or WS_FLUSH_SECONDS seconds (idempotent
    # rewrite); websocket_end writes the final state.
    WS_FLUSH_FRAMES = 20
    WS_FLUSH_SECONDS = 5.0

    def _ws_flush(self, flow, in_progress):
        msgs = flow.metadata.get('ws_msgs')
        if not msgs:
            return
        client_ip = flow.client_conn.peername[0]
        started = flow.metadata['ws_started']
        filename = flow.metadata.get('ws_file')
        if not filename:
            filename = started.replace(':', '-').replace('.', '-') + '-ws.json'
            flow.metadata['ws_file'] = filename
        entry = {
            'client_ip': client_ip,
            'timestamp': started,
            'last_updated': datetime.utcnow().isoformat(),
            'in_progress': in_progress,
            'method': 'WEBSOCKET',
            'url': flow.request.pretty_url,
            'headers': dict(flow.request.headers),
            'websocket_messages': msgs,
        }
        workspace_dir = os.path.join(LOG_DIR, client_ip)
        os.makedirs(workspace_dir, exist_ok=True)
        # write-then-rename so readers never see a half-written JSON file
        path = os.path.join(workspace_dir, filename)
        with open(path + '.tmp', 'w') as f:
            json.dump(entry, f, indent=2, ensure_ascii=False)
        os.replace(path + '.tmp', path)
        flow.metadata['ws_last_flush'] = time.time()
        flow.metadata['ws_flushed_count'] = len(msgs)

    def websocket_message(self, flow: http.HTTPFlow):
        """Collect text frames for LLM domains (e.g. chatgpt.com/backend-api/codex/responses)."""
        if not any(domain in flow.request.host for domain in LLM_DOMAINS):
            return
        try:
            m = flow.websocket.messages[-1]
            flow.metadata.setdefault('ws_started', datetime.utcnow().isoformat())
            flow.metadata.setdefault('ws_msgs', []).append({
                'from_client': m.from_client,
                'ts': datetime.utcfromtimestamp(m.timestamp).isoformat(),
                'text': m.text if m.is_text else f"[binary {len(m.content)}b]",
            })
            msgs = flow.metadata['ws_msgs']
            due = (len(msgs) - flow.metadata.get('ws_flushed_count', 0) >= self.WS_FLUSH_FRAMES
                   or time.time() - flow.metadata.get('ws_last_flush', 0) >= self.WS_FLUSH_SECONDS)
            if due:
                self._ws_flush(flow, in_progress=True)
        except Exception as e:
            ctx.log.warn(f"WS capture error: {type(e).__name__}")

    def websocket_end(self, flow: http.HTTPFlow):
        try:
            self._ws_flush(flow, in_progress=False)
            msgs = flow.metadata.get('ws_msgs') or []
            if msgs:
                ctx.log.info(f"Logged WS conversation: {flow.client_conn.peername[0]} -> {flow.request.pretty_url} ({len(msgs)} frames)")
        except Exception as e:
            ctx.log.warn(f"WS log error: {type(e).__name__}")


addons = [LLMConversationLogger()]
