import { AgentToolDeclaration, AgentToolCall, ProviderConfig } from '../../../types';

export class OpenCodeProviderService {
  public static async callModel(
    config: ProviderConfig,
    systemInstruction: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    tools: AgentToolDeclaration[],
    modelOverride?: string
  ): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
    const baseUrl = config.baseUrl || 'https://api.opencode.go/v1/chat/completions';
    const model = modelOverride || config.model || 'opencode-v1-pro';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

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
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenCode / OpenAI-Compatible Error (${res.status}): ${errText}`);
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
          // Ignore parse errors
        }
      }
    }

    return { text: responseText, toolCalls };
  }
}
