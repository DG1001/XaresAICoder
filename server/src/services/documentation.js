/**
 * Generate project documentation from LLM conversation history
 */

function generateDocumentationFromConversations(conversations, format = 'markdown') {
  if (format === 'markdown') {
    return generateMarkdownDocumentation(conversations);
  } else if (format === 'json') {
    return generateJSONDocumentation(conversations);
  }
  throw new Error(`Unsupported format: ${format}`);
}

function generateMarkdownDocumentation(conversations) {
  let markdown = `# AI Coding Session Documentation\n\n`;
  markdown += `**Generated:** ${new Date().toISOString()}\n`;
  markdown += `**Total Conversations:** ${conversations.length}\n\n`;
  markdown += `---\n\n`;

  // Summary by model
  const byModel = {};
  conversations.forEach(conv => {
    const model = conv.parsed_request?.model || 'unknown';
    if (!byModel[model]) byModel[model] = [];
    byModel[model].push(conv);
  });

  markdown += `## Summary\n\n`;
  Object.entries(byModel).forEach(([model, convs]) => {
    const totalTokens = convs.reduce((sum, c) =>
      sum + (c.parsed_response?.usage?.total_tokens || 0), 0
    );
    markdown += `- **${model}**: ${convs.length} conversations, ${totalTokens} tokens\n`;
  });
  markdown += `\n---\n\n`;

  // Conversation details
  markdown += `## Conversation History\n\n`;

  conversations.forEach((conv, idx) => {
    markdown += `### Conversation ${idx + 1}\n\n`;
    markdown += `**Time:** ${new Date(conv.timestamp).toLocaleString()}\n`;
    markdown += `**Model:** ${conv.parsed_request?.model || 'N/A'}\n`;
    markdown += `**Endpoint:** ${conv.url}\n\n`;

    // Request
    markdown += `#### Request\n\n`;
    if (conv.parsed_request?.messages) {
      conv.parsed_request.messages.forEach(msg => {
        let content = '';
        if (Array.isArray(msg.content)) {
          // Extract text from content blocks
          content = msg.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
        } else if (typeof msg.content === 'string') {
          content = msg.content;
        }
        if (content) {
          markdown += `**${msg.role}:**\n\`\`\`\n${content}\n\`\`\`\n\n`;
        }
      });
    } else if (conv.parsed_request?.prompt) {
      markdown += `\`\`\`\n${conv.parsed_request.prompt}\n\`\`\`\n\n`;
    }

    // Response
    markdown += `#### Response\n\n`;
    if (conv.parsed_response?.choices) {
      const content = conv.parsed_response.choices[0]?.message?.content ||
                     conv.parsed_response.choices[0]?.text || 'N/A';
      markdown += `\`\`\`\n${content}\n\`\`\`\n\n`;
    } else if (conv.parsed_response?.content) {
      let content = 'N/A';
      if (Array.isArray(conv.parsed_response.content)) {
        // Handle Anthropic's content blocks
        content = conv.parsed_response.content
          .filter(block => block.type === 'text' && block.text)
          .map(block => block.text)
          .join('\n');
      } else if (typeof conv.parsed_response.content === 'string') {
        content = conv.parsed_response.content;
      }
      markdown += `\`\`\`\n${content}\n\`\`\`\n\n`;
    }

    // Token usage
    if (conv.parsed_response?.usage) {
      const usage = conv.parsed_response.usage;
      // Handle both OpenAI format (prompt_tokens) and Anthropic format (input_tokens)
      const promptTokens = usage.prompt_tokens || usage.input_tokens || 'N/A';
      const completionTokens = usage.completion_tokens || usage.output_tokens || 'N/A';
      const totalTokens = usage.total_tokens ||
                         ((usage.input_tokens && usage.output_tokens) ?
                          usage.input_tokens + usage.output_tokens : 'N/A');
      markdown += `**Tokens:** Prompt: ${promptTokens}, `;
      markdown += `Completion: ${completionTokens}, `;
      markdown += `Total: ${totalTokens}\n\n`;
    }

    markdown += `---\n\n`;
  });

  return markdown;
}

function generateJSONDocumentation(conversations) {
  return {
    generated: new Date().toISOString(),
    conversationCount: conversations.length,
    summary: {
      models: [...new Set(conversations.map(c => c.parsed_request?.model).filter(Boolean))],
      totalTokens: conversations.reduce((sum, c) =>
        sum + (c.parsed_response?.usage?.total_tokens || 0), 0
      )
    },
    conversations: conversations.map(conv => ({
      timestamp: conv.timestamp,
      model: conv.parsed_request?.model,
      messages: conv.parsed_request?.messages,
      response: extractResponse(conv.parsed_response),
      usage: conv.parsed_response?.usage
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
