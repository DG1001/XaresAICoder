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
    'api.opencode.ai',
    'opencode.ai',  # OpenCode free tier uses opencode.ai/zen/v1/
    'api.huggingface.co',
    'z.ai',  # z.ai LLM API
    'api.z.ai'
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
                    # Parse SSE response
                    content_blocks = []
                    usage_data = None
                    model_name = None
                    message_id = None

                    for line in resp_body.split('\n'):
                        if line.startswith('data: '):
                            try:
                                event_data = json.loads(line[6:])  # Remove 'data: ' prefix

                                # Extract model and ID from message_start
                                if event_data.get('type') == 'message_start':
                                    msg = event_data.get('message', {})
                                    model_name = msg.get('model')
                                    message_id = msg.get('id')
                                    usage_data = msg.get('usage')

                                # Collect content_block_delta events
                                elif event_data.get('type') == 'content_block_delta':
                                    delta = event_data.get('delta', {})
                                    if delta.get('type') == 'text_delta':
                                        content_blocks.append({
                                            'type': 'text',
                                            'text': delta.get('text', '')
                                        })
                            except json.JSONDecodeError:
                                pass

                    # Combine text content
                    combined_content = []
                    if content_blocks:
                        combined_text = ''.join(block.get('text', '') for block in content_blocks if block.get('type') == 'text')
                        if combined_text:
                            combined_content.append({'type': 'text', 'text': combined_text})

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
        except json.JSONDecodeError:
            ctx.log.warn(f"Failed to parse JSON for {log_data['url']}")

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

addons = [LLMConversationLogger()]
