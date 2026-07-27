import { AgentToolDeclaration, AgentToolCall, ProviderConfig } from '../../../types';

export class GeminiProviderService {
  public static async callModel(
    config: ProviderConfig,
    systemInstruction: string,
    messages: { role: 'user' | 'model'; parts: { text: string }[] }[],
    tools: AgentToolDeclaration[],
    modelOverride?: string
  ): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
    const model = modelOverride || config.model || 'gemini-2.5-flash';
    const isOAuth = config.type === 'gemini-oauth';

    let url: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isOAuth) {
      if (!config.oauthToken) {
        throw new Error('Google AI Pro OAuth token is missing. Please log in again.');
      }
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      headers['Authorization'] = `Bearer ${config.oauthToken}`;
    } else {
      if (!config.apiKey) {
        throw new Error('Gemini API key is required.');
      }
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    }

    const formattedTools = tools.length > 0 ? [
      {
        function_declarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ] : undefined;

    const payload = {
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: messages,
      tools: formattedTools,
      generationConfig: {
        temperature: 0.2,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let responseText = '';
    const toolCalls: AgentToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        responseText += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }

    return { text: responseText, toolCalls };
  }
}
