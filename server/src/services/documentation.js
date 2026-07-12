/**
 * Generate project documentation from LLM conversation history
 */

function truncate(str, max) {
  if (typeof str !== 'string' || str.length <= max) return str;
  return `${str.substring(0, max)}\n... (truncated ${str.length - max} chars)`;
}

/**
 * Strip Claude Code harness noise (system reminders, local-command wrappers)
 * from a message string so the actual user prompt survives in clean mode.
 */
function stripSystemNoise(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim();
}

/**
 * Render a single Anthropic/OpenAI content block to readable text.
 * Unlike a plain label, this includes the actual tool inputs (the code that
 * was written/edited) and tool results, which is the whole point of the
 * detailed export for a coding session.
 */
function formatContentBlock(block) {
  if (!block || typeof block !== 'object') return typeof block === 'string' ? block : '';
  switch (block.type) {
    case 'text':
      return block.text || '';
    case 'thinking':
      return block.thinking ? `[Thinking]\n${truncate(block.thinking, 2000)}` : '[Thinking]';
    case 'tool_use': {
      const hasInput = block.input && Object.keys(block.input).length > 0;
      const input = hasInput ? `\n${truncate(JSON.stringify(block.input, null, 2), 4000)}` : '';
      return `[Tool Use: ${block.name || 'unknown'}]${input}`;
    }
    case 'tool_result': {
      let resultText = '';
      if (Array.isArray(block.content)) {
        resultText = block.content
          .map(c => (typeof c === 'string' ? c : (c && c.text) || `[${c && c.type}]`))
          .join('\n');
      } else if (typeof block.content === 'string') {
        resultText = block.content;
      }
      return resultText ? `[Tool Result]\n${truncate(resultText, 1500)}` : '[Tool Result]';
    }
    default:
      return `[${block.type}]`;
  }
}

/**
 * Render an assistant response body to readable text, covering the case where
 * the turn was only a tool call (no text). In detailed mode tool inputs are
 * shown in full; in clean mode a compact label is used. Returns null when
 * there is genuinely nothing to show.
 */
function formatResponseBody(parsedResponse, detailed) {
  if (!parsedResponse) return null;

  // OpenAI-style: choices[0].message.content (+ optional tool_calls)
  if (parsedResponse.choices) {
    const choice = parsedResponse.choices[0] || {};
    const message = choice.message || {};
    const parts = [];
    const text = message.content || choice.text;
    if (text) parts.push(text);
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls.forEach(tc => {
        const fn = tc.function || {};
        const args = detailed && fn.arguments ? `\n${truncate(fn.arguments, 4000)}` : '';
        parts.push(`[Tool Use: ${fn.name || 'unknown'}]${args}`);
      });
    }
    return parts.length ? parts.join('\n') : null;
  }

  // Anthropic-style: array of content blocks
  if (Array.isArray(parsedResponse.content)) {
    const parts = parsedResponse.content
      .map(block => {
        if (block.type === 'text') return block.text || '';
        if (detailed) return formatContentBlock(block);
        // clean mode: compact label for tool calls, drop thinking
        if (block.type === 'tool_use') return `[Tool Use: ${block.name || 'unknown'}]`;
        return '';
      })
      .filter(p => p && p.trim().length > 0);
    return parts.length ? parts.join('\n') : null;
  }

  if (typeof parsedResponse.content === 'string') {
    return parsedResponse.content || null;
  }
  return null;
}

/**
 * Normalize a usage object from either Anthropic (input/output/cache) or
 * OpenAI (prompt/completion) into consistent fields. Prompt total includes
 * cache read + cache creation tokens, which Anthropic bills separately and
 * the old code ignored entirely.
 */
function computeUsage(usage) {
  if (!usage) return null;
  // Cache reads across provider dialects: Anthropic (cache_read_input_tokens),
  // OpenAI chat (prompt_tokens_details.cached_tokens), OpenAI Responses API /
  // Codex (input_tokens_details.cached_tokens), DeepSeek (prompt_cache_hit_tokens).
  const cacheRead = usage.cache_read_input_tokens
    || usage.prompt_tokens_details?.cached_tokens
    || usage.input_tokens_details?.cached_tokens
    || usage.prompt_cache_hit_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const input = usage.prompt_tokens || usage.input_tokens || 0;
  const output = usage.completion_tokens || usage.output_tokens || 0;
  // Only Anthropic excludes cache reads/creations from input_tokens;
  // OpenAI and DeepSeek already include cached tokens in prompt_tokens.
  const anthropicStyle = ('cache_read_input_tokens' in usage)
    || ('cache_creation_input_tokens' in usage);
  const prompt = input + (anthropicStyle ? cacheRead + cacheCreation : 0);
  const total = usage.total_tokens || (prompt + output);
  return { input, cacheRead, cacheCreation, prompt, output, total };
}

// Usage for a conversation, falling back to a regex scan of the raw response
// body when parsed_response.usage is missing (e.g. OpenAI SSE streams the
// logger does not parse). Merges all "usage" objects found in the body
// (Anthropic SSE: message_start + message_delta).
function usageOf(conv) {
  if (conv?.parsed_response?.usage) return computeUsage(conv.parsed_response.usage);
  const body = conv?.response?.body;
  if (typeof body !== 'string') return null;
  const re = /"usage"\s*:\s*(\{(?:[^{}]|\{[^{}]*\})*\})/g;
  let usage = null, m;
  while ((m = re.exec(body)) !== null) {
    try { usage = Object.assign(usage || {}, JSON.parse(m[1])); } catch (e) { /* ignore */ }
  }
  return computeUsage(usage);
}

// --- Session reconstruction -------------------------------------------------
// A single coding session is streamed to the API as many requests, each
// carrying the whole growing message history. Rendering them one-by-one
// repeats the entire dialog (and system reminders) on every request. Instead
// we group requests whose histories share a common prefix into one session
// and render the dialog once.

// JSON.stringify with sorted keys, so tool inputs fingerprint identically
// regardless of key order (which can differ between otherwise-equal requests).
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

function messageFingerprint(msg) {
  // Normalize string content to a single text block so a message stored as
  // `content: "hi"` fingerprints identically to `content: [{type:'text', text:'hi'}]`.
  // Claude Code sends the same message in both shapes across requests, and
  // treating them differently splits one session into several.
  const blocks = Array.isArray(msg.content)
    ? msg.content
    : [{ type: 'text', text: typeof msg.content === 'string' ? msg.content : '' }];

  const c = blocks
    .map(b => {
      if (b.type === 'text') return `t:${b.text || ''}`;
      if (b.type === 'tool_use') return `u:${b.name || ''}:${stableStringify(b.input || {})}`;
      if (b.type === 'tool_result') {
        return `r:${typeof b.content === 'string' ? b.content : stableStringify(b.content || '')}`;
      }
      if (b.type === 'thinking') return `k:${b.thinking || ''}`;
      return b.type || '';
    })
    .join('§');
  return `${msg.role || '?'}»${c}`;
}

function conversationFingerprints(conv) {
  return (conv.parsed_request?.messages || []).map(messageFingerprint);
}

function isPrefix(shorter, longer) {
  if (shorter.length > longer.length) return false;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) return false;
  }
  return true;
}

/**
 * Sort conversations chronologically and group them into sessions. Each
 * session exposes a canonical request (the fullest history), an aggregated
 * token count over all its requests, and the time span.
 */
function prepareSessions(conversations) {
  const valid = (conversations || []).filter(c => c && (c.parsed_request || c.parsed_response));

  // Chronological ascending; missing timestamps sink to the end.
  const sorted = valid.slice().sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : Infinity;
    const tb = b.timestamp ? Date.parse(b.timestamp) : Infinity;
    return ta - tb;
  });

  const groups = [];
  sorted.forEach(conv => {
    const fp = conversationFingerprints(conv);
    let target = null;
    for (const g of groups) {
      if (fp.length && g.fingerprints.length &&
          (isPrefix(g.fingerprints, fp) || isPrefix(fp, g.fingerprints))) {
        target = g;
        break;
      }
    }
    if (!target) {
      target = { requests: [], fingerprints: [] };
      groups.push(target);
    }
    target.requests.push(conv);
    if (fp.length >= target.fingerprints.length) target.fingerprints = fp;
  });

  return groups.map(g => {
    // Canonical = request with the most messages (tie: latest wins).
    let canonical = g.requests[0];
    let maxLen = -1;
    g.requests.forEach(r => {
      const len = r.parsed_request?.messages?.length || 0;
      if (len >= maxLen) { maxLen = len; canonical = r; }
    });

    const models = [...new Set(g.requests.map(r => r.parsed_request?.model).filter(Boolean))];
    const tokens = g.requests.reduce((acc, r) => {
      const u = usageOf(r);
      if (u) { acc.prompt += u.prompt; acc.cacheRead += u.cacheRead || 0; acc.output += u.output; acc.total += u.total; }
      return acc;
    }, { prompt: 0, cacheRead: 0, output: 0, total: 0 });
    const times = g.requests.map(r => r.timestamp).filter(Boolean).sort();

    return {
      requests: g.requests,
      canonical,
      finalResponse: canonical.parsed_response,
      models,
      tokens,
      firstTime: times[0],
      lastTime: times[times.length - 1]
    };
  });
}

function renderMessagesMarkdown(messages, detailed) {
  let md = '';
  (messages || []).forEach((msg, i) => {
    if (!detailed && msg.role !== 'user' && msg.role !== 'assistant') return;

    let content = '';
    if (detailed) {
      if (Array.isArray(msg.content)) {
        content = msg.content.map(formatContentBlock).join('\n');
      } else if (typeof msg.content === 'string') {
        content = truncate(msg.content, 5000);
      }
      // OpenAI format: tool calls live in msg.tool_calls, not in content blocks.
      if (Array.isArray(msg.tool_calls)) {
        const markers = msg.tool_calls.map(tc => {
          const name = tc.function?.name || tc.name || 'unknown';
          const args = tc.function?.arguments;
          return args ? `[Tool Use: ${name}]\n${truncate(String(args), 4000)}` : `[Tool Use: ${name}]`;
        }).join('\n');
        content = content ? content + '\n' + markers : markers;
      }
    } else {
      if (Array.isArray(msg.content)) {
        content = msg.content
          .filter(b => b.type === 'text')
          .map(b => stripSystemNoise(b.text || ''))
          .filter(Boolean)
          .join('\n');
      } else if (typeof msg.content === 'string') {
        content = stripSystemNoise(msg.content);
      }
    }

    if (content && content.trim().length) {
      const label = detailed ? `**Message ${i + 1} (${msg.role}):**` : `**${msg.role}:**`;
      md += `${label}\n\`\`\`\n${content.trim()}\n\`\`\`\n\n`;
    }
  });
  return md;
}

function renderDocHeader(typeLabel, typeDesc, sessions, conversations) {
  let md = `# AI Coding Session Documentation (${typeLabel})\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Sessions:** ${sessions.length}\n`;
  md += `**Total API Requests:** ${conversations.length}\n`;
  md += `**Type:** ${typeDesc}\n\n`;
  md += `---\n\n`;

  const byModel = {};
  conversations.forEach(conv => {
    const model = conv.parsed_request?.model || 'unknown';
    if (!byModel[model]) byModel[model] = [];
    byModel[model].push(conv);
  });

  md += `## Summary\n\n`;
  Object.entries(byModel).forEach(([model, convs]) => {
    const totalTokens = convs.reduce((sum, c) =>
      sum + (usageOf(c)?.total || 0), 0
    );
    md += `- **${model}**: ${convs.length} API requests, ${totalTokens} tokens\n`;
  });
  md += `\n> Each API request is one streamed call. Requests sharing a conversation\n`;
  md += `> history are grouped into a single session below, so the dialog is shown\n`;
  md += `> once instead of being repeated on every request.\n\n`;
  md += `---\n\n`;
  return md;
}

function renderSessionHeader(session, idx) {
  let md = `## Session ${idx + 1}\n\n`;
  md += `**Model:** ${session.models.join(', ') || 'N/A'}\n`;
  if (session.firstTime) {
    const span = session.lastTime && session.lastTime !== session.firstTime
      ? `${new Date(session.firstTime).toLocaleString()} – ${new Date(session.lastTime).toLocaleString()}`
      : new Date(session.firstTime).toLocaleString();
    md += `**Time:** ${span}\n`;
  }
  md += `**API Requests:** ${session.requests.length}\n`;
  md += `**Tokens:** Prompt: ${session.tokens.prompt}, `;
  md += `Cache Read: ${session.tokens.cacheRead || 0}, `;
  md += `Completion: ${session.tokens.output}, Total: ${session.tokens.total}\n\n`;
  return md;
}

function renderRequestBreakdown(session) {
  let md = `#### API Request Breakdown (${session.requests.length})\n\n`;
  md += `| # | Time | Prompt | Cache Read | Completion | Total | Request ID |\n`;
  md += `|---|------|--------|-----------|------------|-------|------------|\n`;
  session.requests.forEach((r, i) => {
    const u = usageOf(r) || { prompt: 0, cacheRead: 0, output: 0, total: 0 };
    const t = r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/A';
    const id = r.parsed_response?.id || 'N/A';
    md += `| ${i + 1} | ${t} | ${u.prompt} | ${u.cacheRead || 0} | ${u.output} | ${u.total} | ${id} |\n`;
  });
  md += `\n`;
  return md;
}

// --- Codex WebSocket captures (OpenAI Responses API over WS) -----------------
// The mitmproxy logger stores one JSON entry per WebSocket connection holding
// all text frames. Client frames are `response.create` payloads that carry the
// model and only the NEW input items (the history lives server-side via
// previous_response_id / store:true); server frames stream the output, whose
// finished items arrive as `response.output_item.done` (the final
// `response.completed` usually has an empty `output` array but carries usage
// and the response id). Expand such an entry into one synthetic conversation
// per request — with a cumulatively rebuilt message history, so the existing
// prefix-based session grouping, token accounting, and the convo viewer all
// work unchanged.

function wsInputItemToMessages(item) {
  if (!item || typeof item !== 'object') return [];
  // A Responses-API message item carries an explicit `type: 'message'` over the
  // WebSocket transport, but omits `type` entirely over HTTP when a `role` is
  // present. Treat a role-bearing, type-less item as a message so Codex/Pi HTTP
  // captures surface their user prompts (otherwise they hit `default` and drop).
  const type = item.type || (item.role ? 'message' : undefined);
  switch (type) {
    case 'message':
      return [{
        role: item.role || 'user',
        content: [{
          type: 'text',
          text: typeof item.content === 'string'
            ? item.content
            : (Array.isArray(item.content) ? item.content : [])
                .map(c => (c && c.text) || '')
                .filter(Boolean)
                .join('\n')
        }]
      }];
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const out = typeof item.output === 'string' ? item.output : JSON.stringify(item.output || '');
      return [{ role: 'tool', content: [{ type: 'tool_result', content: out }] }];
    }
    default:
      // additional_tools (tool definitions), reasoning, function_call and
      // unknown items are dropped
      return [];
  }
}

function wsOutputItemToBlock(item) {
  if (!item || typeof item !== 'object') return null;
  switch (item.type) {
    case 'message': {
      const text = (Array.isArray(item.content) ? item.content : [])
        .map(c => (c && c.text) || '')
        .filter(Boolean)
        .join('\n');
      return text ? { type: 'text', text } : null;
    }
    case 'function_call': {
      let input;
      try { input = JSON.parse(item.arguments); } catch (e) { input = { arguments: item.arguments }; }
      return { type: 'tool_use', name: item.name || 'unknown', input };
    }
    case 'custom_tool_call':
      return {
        type: 'tool_use',
        name: item.name || 'unknown',
        input: typeof item.input === 'object' && item.input !== null ? item.input : { input: item.input }
      };
    case 'reasoning': {
      const text = (Array.isArray(item.summary) ? item.summary : [])
        .map(s => (s && s.text) || '')
        .filter(Boolean)
        .join('\n');
      return text ? { type: 'thinking', thinking: text } : null;
    }
    default:
      return null;
  }
}

function expandWebSocketConversation(conv) {
  if (!conv || !Array.isArray(conv.websocket_messages)) return [conv];

  // Pair client `response.create` frames with the streamed server events that
  // follow them (frames are stored in wire order on one connection).
  const requests = [];
  let cur = null;
  conv.websocket_messages.forEach(m => {
    let ev;
    try { ev = JSON.parse(m.text); } catch (e) { return; }
    if (m.from_client) {
      if (ev.type === 'response.create') {
        cur = { create: ev, ts: m.ts, outputs: [], completed: null };
        requests.push(cur);
      }
      return;
    }
    if (!cur) return;
    if (ev.type === 'response.output_item.done' && ev.item) {
      cur.outputs.push(ev.item);
    } else if (ev.type === 'response.completed' && ev.response) {
      cur.completed = ev.response;
      if (Array.isArray(ev.response.output) && ev.response.output.length) {
        cur.outputs = ev.response.output;
      }
    }
  });
  if (!requests.length) return [conv];

  // Newer captures carry a real timestamp per frame ('ts', taken from the
  // wire). Older captures do not — there conv.timestamp is the END of the
  // session, so synthesize per-request timestamps one second apart to
  // preserve ordering.
  const endTs = conv.timestamp ? Date.parse(conv.timestamp) : Date.now();

  const cumulative = [];
  return requests.map((r, i) => {
    cumulative.push(...(r.create.input || []).flatMap(wsInputItemToMessages));
    const messages = cumulative.slice();
    const blocks = r.outputs.map(wsOutputItemToBlock).filter(Boolean);
    if (blocks.length) cumulative.push({ role: 'assistant', content: blocks });

    const usage = r.completed && r.completed.usage;
    return {
      timestamp: r.ts || new Date(endTs - (requests.length - i) * 1000).toISOString(),
      method: 'WEBSOCKET',
      url: conv.url,
      parsed_request: {
        model: r.create.model || (r.completed && r.completed.model),
        messages
      },
      parsed_response: {
        id: r.completed && r.completed.id,
        model: (r.completed && r.completed.model) || r.create.model,
        content: blocks,
        usage: usage ? {
          prompt_tokens: usage.input_tokens || 0,
          completion_tokens: usage.output_tokens || 0,
          total_tokens: usage.total_tokens,
          prompt_tokens_details: {
            cached_tokens: (usage.input_tokens_details && usage.input_tokens_details.cached_tokens) || 0
          }
        } : undefined
      }
    };
  });
}

// --- Codex/Pi HTTP captures (OpenAI Responses API over plain POST) -----------
// Codex CLI (and Pi, which reuses the Codex ChatGPT auth) can also talk to the
// Responses API over ordinary HTTP POSTs instead of a WebSocket. The request
// carries the whole cumulative history in `input` (not `messages`) and the
// response is a Responses-API SSE stream, so the Anthropic-SSE and OpenAI-chat
// code paths both fail to parse it (empty content, null usage → no user text,
// no cache, and every request lands in its own session). Normalize such a
// capture into the same shape expandWebSocketConversation produces, reusing the
// same item mappers, so message rendering, prefix-based session grouping and
// token/cache accounting all work unchanged. Captures that already carry
// `messages` (Claude, OpenAI chat, OpenCode, …) pass through untouched.

function parseResponsesApiSse(body) {
  if (typeof body !== 'string') return { outputs: [], completed: null };
  let outputs = [];
  let completed = null;
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let ev;
    try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
    if (ev.type === 'response.output_item.done' && ev.item) {
      outputs.push(ev.item);
    } else if (ev.type === 'response.completed' && ev.response) {
      completed = ev.response;
      // The final event usually repeats the full output; prefer it when present.
      if (Array.isArray(ev.response.output) && ev.response.output.length) {
        outputs = ev.response.output;
      }
    }
  }
  return { outputs, completed };
}

function normalizeResponsesApiConversation(conv) {
  if (!conv || conv.method === 'WEBSOCKET') return conv;
  // Anything already parsed into messages (Claude/OpenAI-chat/OpenCode) is left
  // as-is; only Responses-API captures lack messages.
  if (Array.isArray(conv.parsed_request && conv.parsed_request.messages)) return conv;

  let reqBody;
  try { reqBody = JSON.parse(conv.body || (conv.request && conv.request.body) || ''); }
  catch (e) { return conv; }
  if (!reqBody || !Array.isArray(reqBody.input)) return conv;  // not a Responses-API request

  const messages = reqBody.input.flatMap(wsInputItemToMessages);
  const { outputs, completed } = parseResponsesApiSse(conv.response && conv.response.body);
  const blocks = outputs.map(wsOutputItemToBlock).filter(Boolean);
  const usage = completed && completed.usage;

  return {
    ...conv,
    parsed_request: {
      model: reqBody.model || (conv.parsed_request && conv.parsed_request.model),
      messages
    },
    parsed_response: {
      id: (completed && completed.id) || (conv.parsed_response && conv.parsed_response.id),
      model: (completed && completed.model) || reqBody.model,
      content: blocks,
      // Remap Responses-API usage into the OpenAI-chat shape computeUsage reads,
      // so cache_read (input_tokens_details.cached_tokens) is accounted for.
      usage: usage ? {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: usage.total_tokens,
        prompt_tokens_details: {
          cached_tokens: (usage.input_tokens_details && usage.input_tokens_details.cached_tokens) || 0
        }
      } : undefined
    }
  };
}

function generateDocumentationFromConversations(conversations, format = 'markdown', type = 'clean') {
  conversations = (conversations || [])
    .flatMap(expandWebSocketConversation)
    .map(normalizeResponsesApiConversation);
  if (format === 'markdown') {
    if (type === 'detailed') {
      return generateDetailedMarkdownDocumentation(conversations);
    } else {
      return generateCleanMarkdownDocumentation(conversations);
    }
  } else if (format === 'json') {
    return generateJSONDocumentation(conversations);
  }
  throw new Error(`Unsupported format: ${format}`);
}

function generateCleanMarkdownDocumentation(conversations) {
  const sessions = prepareSessions(conversations);
  let markdown = renderDocHeader('Clean', 'Clean (User/Assistant conversation only)', sessions, conversations);
  markdown += `## Conversation History\n\n`;

  sessions.forEach((session, idx) => {
    markdown += renderSessionHeader(session, idx);
    markdown += renderMessagesMarkdown(session.canonical.parsed_request?.messages, false);

    const finalBody = formatResponseBody(session.finalResponse, false);
    if (finalBody) {
      markdown += `**assistant:**\n\`\`\`\n${finalBody}\n\`\`\`\n\n`;
    }
    markdown += `---\n\n`;
  });

  return markdown;
}

function generateDetailedMarkdownDocumentation(conversations) {
  const sessions = prepareSessions(conversations);
  let markdown = renderDocHeader('Detailed', 'Detailed (Complete technical details)', sessions, conversations);
  markdown += `## Conversation History\n\n`;

  sessions.forEach((session, idx) => {
    markdown += renderSessionHeader(session, idx);

    markdown += `#### Dialog\n\n`;
    markdown += renderMessagesMarkdown(session.canonical.parsed_request?.messages, true);

    const finalBody = formatResponseBody(session.finalResponse, true);
    if (finalBody) {
      markdown += `**Final Response (assistant):**\n\`\`\`\n${finalBody}\n\`\`\`\n\n`;
    } else {
      markdown += `**Final Response (assistant):**\n_(No text — tool call only.)_\n\n`;
    }

    markdown += renderRequestBreakdown(session);
    markdown += `---\n\n`;
  });

  return markdown;
}

function generateJSONDocumentation(conversations) {
  const sessions = prepareSessions(conversations);
  return {
    generated: new Date().toISOString(),
    sessionCount: sessions.length,
    apiRequestCount: conversations.length,
    summary: {
      models: [...new Set(conversations.map(c => c.parsed_request?.model).filter(Boolean))],
      totalTokens: conversations.reduce((sum, c) =>
        sum + (usageOf(c)?.total || 0), 0
      )
    },
    sessions: sessions.map(session => ({
      models: session.models,
      firstTime: session.firstTime,
      lastTime: session.lastTime,
      apiRequestCount: session.requests.length,
      tokens: session.tokens,
      messages: session.canonical.parsed_request?.messages,
      finalResponse: extractResponse(session.finalResponse)
    }))
  };
}

function extractResponse(parsedResponse) {
  if (parsedResponse?.choices) {
    return parsedResponse.choices[0]?.message?.content ||
           parsedResponse.choices[0]?.text;
  } else if (parsedResponse?.content) {
    if (Array.isArray(parsedResponse.content)) {
      // Handle Anthropic's content blocks
      return parsedResponse.content
        .filter(block => block.type === 'text' && block.text)
        .map(block => block.text)
        .join('\n');
    } else if (typeof parsedResponse.content === 'string') {
      return parsedResponse.content;
    }
  }
  return null;
}

module.exports = {
  generateDocumentationFromConversations
};
