#!/usr/bin/env python3
"""
Diagnostic mitmproxy addon: unfiltered capture for privacy audits.

Why this exists alongside llm-logger.py: that addon deliberately drops any
request whose body has no "model" field ("filters out internal events,
telemetry, non-LLM API calls"). For a data-protection audit those are exactly
the flows of interest, so this addon captures them verbatim.

Two outputs, both under /var/log/mitmproxy/raw_capture/<client_ip>/:
  - full/<ts>_<host>_<slug>.json — complete request+response for hosts matching
    FULL_CAPTURE_HOSTS (headers and bodies, no filtering)
  - index.ndjson — one compact line per flow for EVERY host, so nothing is
    invisible even when its body is not dumped

Configure via env:
  RAW_FULL_HOSTS   comma-separated host substrings for full dumps
  RAW_MAX_BODY     max bytes kept per body (default 1 MiB)

Not loaded by default. To enable, mount it into the mitmproxy-logger service
and append a second -s flag, e.g. in a docker-compose.override.yml:

  services:
    mitmproxy-logger:
      volumes:
        - ./mitmproxy/raw-capture.py:/scripts/raw-capture.py:ro
      environment:
        - RAW_FULL_HOSTS=opencode.ai,models.dev,api.github.com
      command: >
        sh -c "mkdir -p /var/log/mitmproxy/llm_conversations
        /var/log/mitmproxy/domains /var/log/mitmproxy/raw_capture &&
        chmod -R 777 /var/log/mitmproxy && mitmdump --mode regular
        --listen-host 0.0.0.0 --listen-port 8080 --set confdir=/certs
        --set ssl_insecure=true -s /scripts/llm-logger.py
        -s /scripts/raw-capture.py"

Note that the override must repeat the full volume list and command, since
Compose replaces rather than merges the command string.
"""

import json
import os
import re
import threading
import time
from datetime import datetime

from mitmproxy import ctx, http

BASE_DIR = "/var/log/mitmproxy/raw_capture"

FULL_CAPTURE_HOSTS = [
    h.strip().lower()
    for h in os.environ.get(
        "RAW_FULL_HOSTS",
        "opencode.ai,sst.dev,sst.ai,posthog,sentry.io,segment.io,amplitude,"
        "google-analytics,googletagmanager,statsig,launchdarkly",
    ).split(",")
    if h.strip()
]

MAX_BODY = int(os.environ.get("RAW_MAX_BODY", 1024 * 1024))

_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]+")
_lock = threading.Lock()


def _slug(value, limit=60):
    cleaned = _SLUG_RE.sub("-", value).strip("-")
    return cleaned[:limit] or "root"


def _body(message):
    """Return body as text plus metadata, without throwing on binary payloads."""
    try:
        raw = message.raw_content or b""
    except Exception:
        raw = b""

    info = {"bytes": len(raw), "truncated": False}
    if not raw:
        info["text"] = None
        return info

    if len(raw) > MAX_BODY:
        raw = raw[:MAX_BODY]
        info["truncated"] = True

    # Prefer the decoded text (handles gzip/br); fall back to raw bytes.
    try:
        text = message.text
    except Exception:
        text = None
    if text is None:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            info["text"] = None
            info["encoding"] = "binary"
            info["hex_preview"] = raw[:256].hex()
            return info

    info["text"] = text[:MAX_BODY] if len(text) > MAX_BODY else text
    return info


class RawCapture:
    def __init__(self):
        os.makedirs(BASE_DIR, exist_ok=True)
        ctx.log.info(
            f"[raw-capture] full-dump hosts: {', '.join(FULL_CAPTURE_HOSTS)}"
        )

    # -- helpers -----------------------------------------------------------

    def _client_ip(self, flow):
        try:
            return flow.client_conn.peername[0]
        except Exception:
            return "unknown"

    def _is_full(self, host):
        host = (host or "").lower()
        return any(target in host for target in FULL_CAPTURE_HOSTS)

    def _append_index(self, client_ip, entry):
        path = os.path.join(BASE_DIR, client_ip, "index.ndjson")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with _lock:
            with open(path, "a") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def _write_full(self, client_ip, host, path_part, payload):
        directory = os.path.join(BASE_DIR, client_ip, "full")
        os.makedirs(directory, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S_%f")
        name = f"{stamp}_{_slug(host, 40)}_{_slug(path_part)}.json"
        with open(os.path.join(directory, name), "w") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        return name

    # -- hooks -------------------------------------------------------------

    def request(self, flow: http.HTTPFlow):
        flow.metadata["raw_t0"] = time.time()

    def response(self, flow: http.HTTPFlow):
        try:
            client_ip = self._client_ip(flow)
            host = flow.request.host
            started = flow.metadata.get("raw_t0")

            entry = {
                "ts": datetime.utcnow().isoformat(),
                "host": host,
                "method": flow.request.method,
                "path": flow.request.path,
                "url": flow.request.pretty_url,
                "status": flow.response.status_code,
                "req_bytes": len(flow.request.raw_content or b""),
                "resp_bytes": len(flow.response.raw_content or b""),
                "duration_ms": round((time.time() - started) * 1000, 1)
                if started
                else None,
            }

            if self._is_full(host):
                payload = {
                    **entry,
                    "request": {
                        "http_version": flow.request.http_version,
                        "headers": dict(flow.request.headers),
                        "body": _body(flow.request),
                    },
                    "response": {
                        "http_version": flow.response.http_version,
                        "reason": flow.response.reason,
                        "headers": dict(flow.response.headers),
                        "body": _body(flow.response),
                    },
                }
                entry["dump"] = self._write_full(
                    client_ip, host, flow.request.path, payload
                )
                ctx.log.info(
                    f"[raw-capture] {client_ip} -> {flow.request.method} "
                    f"{flow.request.pretty_url} ({flow.response.status_code})"
                )

            self._append_index(client_ip, entry)
        except Exception as exc:
            ctx.log.warn(f"[raw-capture] error: {type(exc).__name__}: {exc}")

    def error(self, flow):
        """Record failed flows too — a blocked/pinned TLS handshake is a finding."""
        try:
            if not isinstance(flow, http.HTTPFlow) or not flow.request:
                return
            self._append_index(
                self._client_ip(flow),
                {
                    "ts": datetime.utcnow().isoformat(),
                    "host": flow.request.host,
                    "method": flow.request.method,
                    "path": flow.request.path,
                    "status": None,
                    "error": str(flow.error) if flow.error else "unknown",
                },
            )
        except Exception:
            pass


addons = [RawCapture()]
