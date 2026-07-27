import { ProviderConfig, AgentToolDeclaration, AgentToolCall, LLMProviderType } from '../../types';
import { GeminiOAuthService } from './providers/gemini-oauth';
import { GeminiProviderService } from './providers/gemini-provider';
import { OpenRouterProviderService } from './providers/openrouter-provider';
import { OpenCodeProviderService } from './providers/opencode-provider';

const STORAGE_KEY_PROVIDERS = 'swal_llm_providers_config';
const STORAGE_KEY_ACTIVE = 'swal_llm_active_provider';

export class LLMProviderManager {
  public static getProviders(): ProviderConfig[] {
    const raw = localStorage.getItem(STORAGE_KEY_PROVIDERS);
    if (!raw) {
      return this.getDefaultProviders();
    }
    try {
      return JSON.parse(raw);
    } catch {
      return this.getDefaultProviders();
    }
  }

  public static saveProviders(configs: ProviderConfig[]): void {
    localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(configs));
  }

  public static getActiveProviderType(): LLMProviderType {
    return (localStorage.getItem(STORAGE_KEY_ACTIVE) as LLMProviderType) || 'gemini-key';
  }

  public static setActiveProviderType(type: LLMProviderType): void {
    localStorage.setItem(STORAGE_KEY_ACTIVE, type);
  }

  public static getActiveProvider(): ProviderConfig {
    const activeType = this.getActiveProviderType();
    const providers = this.getProviders();
    const found = providers.find((p) => p.type === activeType);
    if (found) return found;

    // Check Gemini OAuth as fallback
    const oauth = GeminiOAuthService.getSavedConfig();
    if (oauth && activeType === 'gemini-oauth') return oauth;

    return providers[0] || this.getDefaultProviders()[0];
  }

  public static updateProvider(config: ProviderConfig): void {
    const providers = this.getProviders();
    const idx = providers.findIndex((p) => p.type === config.type);
    if (idx >= 0) {
      providers[idx] = config;
    } else {
      providers.push(config);
    }
    this.saveProviders(providers);

    if (config.type === 'gemini-oauth') {
      GeminiOAuthService.saveConfig(config);
    }
  }

  public static getDefaultProviders(): ProviderConfig[] {
    const oauthSaved = GeminiOAuthService.getSavedConfig();

    return [
      {
        type: 'gemini-key',
        name: 'Google Gemini API (Key)',
        enabled: true,
        apiKey: '',
        model: 'gemini-2.5-flash',
      },
      oauthSaved || {
        type: 'gemini-oauth',
        name: 'Google AI Pro (OAuth2)',
        enabled: false,
        model: 'gemini-2.5-pro',
        userEmail: undefined,
      },
      {
        type: 'openrouter',
        name: 'OpenRouter Unified API',
        enabled: false,
        apiKey: '',
        model: 'anthropic/claude-3.5-sonnet',
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      },
      {
        type: 'opencode',
        name: 'OpenCodeGo / Custom OpenAI API',
        enabled: false,
        apiKey: '',
        model: 'opencode-v1-pro',
        baseUrl: 'https://api.opencode.go/v1/chat/completions',
      },
    ];
  }

  public static async executeAgentStep(
    systemPrompt: string,
    history: { role: 'user' | 'assistant' | 'model'; content: string }[],
    tools: AgentToolDeclaration[],
    overrideProvider?: ProviderConfig
  ): Promise<{ text: string; toolCalls: AgentToolCall[] }> {
    const provider = overrideProvider || this.getActiveProvider();

    switch (provider.type) {
      case 'gemini-oauth':
      case 'gemini-key': {
        const formattedMessages = history.map((h) => ({
          role: h.role === 'assistant' ? ('model' as const) : ('user' as const),
          parts: [{ text: h.content }],
        }));
        return await GeminiProviderService.callModel(
          provider,
          systemPrompt,
          formattedMessages,
          tools
        );
      }

      case 'openrouter': {
        const formattedMessages = history.map((h) => ({
          role: h.role === 'model' ? ('assistant' as const) : (h.role as 'user' | 'assistant'),
          content: h.content,
        }));
        return await OpenRouterProviderService.callModel(
          provider,
          systemPrompt,
          formattedMessages,
          tools
        );
      }

      case 'opencode':
      case 'custom': {
        const formattedMessages = history.map((h) => ({
          role: h.role === 'model' ? ('assistant' as const) : (h.role as 'user' | 'assistant'),
          content: h.content,
        }));
        return await OpenCodeProviderService.callModel(
          provider,
          systemPrompt,
          formattedMessages,
          tools
        );
      }

      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }
}
