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
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const input = usage.prompt_tokens || usage.input_tokens || 0;
  const output = usage.completion_tokens || usage.output_tokens || 0;
  const prompt = input + cacheRead + cacheCreation;
  const total = usage.total_tokens || (prompt + output);
  return { input, cacheRead, cacheCreation, prompt, output, total };
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
      const u = computeUsage(r.parsed_response?.usage);
      if (u) { acc.prompt += u.prompt; acc.output += u.output; acc.total += u.total; }
      return acc;
    }, { prompt: 0, output: 0, total: 0 });
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
      sum + (computeUsage(c.parsed_response?.usage)?.total || 0), 0
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
  md += `Completion: ${session.tokens.output}, Total: ${session.tokens.total}\n\n`;
  return md;
}

function renderRequestBreakdown(session) {
  let md = `#### API Request Breakdown (${session.requests.length})\n\n`;
  md += `| # | Time | Prompt | Completion | Total | Request ID |\n`;
  md += `|---|------|--------|------------|-------|------------|\n`;
  session.requests.forEach((r, i) => {
    const u = computeUsage(r.parsed_response?.usage) || { prompt: 0, output: 0, total: 0 };
    const t = r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/A';
    const id = r.parsed_response?.id || 'N/A';
    md += `| ${i + 1} | ${t} | ${u.prompt} | ${u.output} | ${u.total} | ${id} |\n`;
  });
  md += `\n`;
  return md;
}

function generateDocumentationFromConversations(conversations, format = 'markdown', type = 'clean') {
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
        sum + (computeUsage(c.parsed_response?.usage)?.total || 0), 0
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
