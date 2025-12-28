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
        markdown += `**${msg.role}:**\n\`\`\`\n${msg.content}\n\`\`\`\n\n`;
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
      const content = Array.isArray(conv.parsed_response.content)
        ? conv.parsed_response.content.map(c => c.text).join('\n')
        : conv.parsed_response.content;
      markdown += `\`\`\`\n${content}\n\`\`\`\n\n`;
    }

    // Token usage
    if (conv.parsed_response?.usage) {
      markdown += `**Tokens:** Prompt: ${conv.parsed_response.usage.prompt_tokens}, `;
      markdown += `Completion: ${conv.parsed_response.usage.completion_tokens}, `;
      markdown += `Total: ${conv.parsed_response.usage.total_tokens}\n\n`;
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
    return Array.isArray(parsedResponse.content)
      ? parsedResponse.content.map(c => c.text).join('\n')
      : parsedResponse.content;
  }
  return null;
}

module.exports = {
  generateDocumentationFromConversations
};
