import { AgentToolDeclaration, AgentToolCall, ProviderConfig } from '../../../types';

export class OpenRouterProviderService {
  public static async callModel(
    config: ProviderConfig,
    systemInstruction: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    tools: AgentToolDeclaration[],
    modelOverride?: string
  ): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
    if (!config.apiKey) {
      throw new Error('OpenRouter API Key is missing.');
    }

    const model = modelOverride || config.model || 'anthropic/claude-3.5-sonnet';
    const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1/chat/completions';

    const formattedMessages = [
      { role: 'system', content: systemInstruction },
      ...messages,
    ];

    const formattedTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const payload: Record<string, unknown> = {
      model,
      messages: formattedMessages,
      temperature: 0.2,
    };

    if (formattedTools.length > 0) {
      payload.tools = formattedTools;
    }

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'SWAL Agent Runner PWA',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    const responseText = choice?.content || '';

    const toolCalls: AgentToolCall[] = [];
    if (choice?.tool_calls) {
      for (const tc of choice.tool_calls) {
        try {
          toolCalls.push({
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
          });
        } catch {
          // Ignore invalid json
        }
      }
    }

    return { text: responseText, toolCalls };
  }
}
