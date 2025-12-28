#!/usr/bin/env python3
"""
mitmproxy addon that captures full LLM API conversations
Logs request/response bodies to per-workspace JSON files
"""

import json
import os
from datetime import datetime
from mitmproxy import ctx, http

LOG_DIR = "/var/log/mitmproxy/llm_conversations"

LLM_DOMAINS = [
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
    'api.google.dev',
    'api.opencode.ai',
    'api.huggingface.co'
]

class LLMConversationLogger:
    def __init__(self):
        os.makedirs(LOG_DIR, exist_ok=True)

    def request(self, flow: http.HTTPFlow):
        """Capture request data"""
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
        """Capture response and write complete conversation"""
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
                resp_json = json.loads(log_data['response']['body'])
                log_data['parsed_response'] = {
                    'id': resp_json.get('id'),
                    'model': resp_json.get('model'),
                    'choices': resp_json.get('choices'),
                    'content': resp_json.get('content'),
                    'usage': resp_json.get('usage')
                }
        except json.JSONDecodeError:
            ctx.log.warn(f"Failed to parse JSON for {log_data['url']}")

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
