import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('LLMProviderManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return default providers when nothing is saved', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const providers = LLMProviderManager.getProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);
    expect(providers[0].type).toBe('gemini-key');
  });

  it('should save and retrieve provider configs', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const configs = [
      { type: 'gemini-key' as const, name: 'Gemini Test', enabled: true, model: 'gemini-2.5-flash' },
      { type: 'openrouter' as const, name: 'OpenRouter Test', enabled: true, apiKey: 'sk-or-test', model: 'claude-3.5', baseUrl: 'https://openrouter.ai/api/v1/chat/completions' },
    ];
    LLMProviderManager.saveProviders(configs);
    const loaded = LLMProviderManager.getProviders();
    expect(loaded).toEqual(configs);
  });

  it('should return default on corrupted localStorage', async () => {
    localStorage.setItem('swal_llm_providers_config', 'BROKEN_JSON{{{');
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const providers = LLMProviderManager.getProviders();
    // Should fall back to defaults
    expect(providers.length).toBeGreaterThanOrEqual(3);
  });

  it('should manage active provider type', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    expect(LLMProviderManager.getActiveProviderType()).toBe('gemini-key');
    LLMProviderManager.setActiveProviderType('openrouter');
    expect(LLMProviderManager.getActiveProviderType()).toBe('openrouter');
  });

  it('should get active provider config', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const active = LLMProviderManager.getActiveProvider();
    expect(active.type).toBe('gemini-key');
    expect(active.name).toBe('Google Gemini API (Key)');
  });

  it('should return default provider when active type not in saved list', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    LLMProviderManager.setActiveProviderType('custom');
    const active = LLMProviderManager.getActiveProvider();
    // Should fall back to first available provider
    expect(active).toBeDefined();
  });

  it('should update provider config (add new)', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const newConfig = { type: 'custom' as const, name: 'Custom Provider', enabled: true, baseUrl: 'http://localhost:8080/v1', model: 'custom-model' };
    LLMProviderManager.updateProvider(newConfig);
    const providers = LLMProviderManager.getProviders();
    const found = providers.find((p) => p.type === 'custom');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Custom Provider');
  });

  it('should update existing provider config', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const updated = LLMProviderManager.getDefaultProviders()[0];
    updated.apiKey = 'new-test-key';
    LLMProviderManager.updateProvider(updated);
    const providers = LLMProviderManager.getProviders();
    expect(providers.find((p) => p.type === 'gemini-key')?.apiKey).toBe('new-test-key');
  });

  it('should throw on unsupported provider type in executeAgentStep', async () => {
    const { LLMProviderManager } = await import('../llm-provider-manager');
    await expect(
      LLMProviderManager.executeAgentStep('system', [], [], { type: 'imaginary-vendor' as any, name: 'bad', enabled: true })
    ).rejects.toThrow('Unsupported provider type');
  });

  it('should include gemini-oauth fallback in defaults when saved', async () => {
    // Simulate saved OAuth config (using the correct storage key from GeminiOAuthService)
    localStorage.setItem('swal_gemini_oauth', JSON.stringify({
      type: 'gemini-oauth', name: 'Google AI Pro', enabled: true, oauthToken: 'tok', userEmail: 'test@test.com', model: 'gemini-2.5-pro',
    }));
    const { LLMProviderManager } = await import('../llm-provider-manager');
    const providers = LLMProviderManager.getDefaultProviders();
    const oauth = providers.find((p) => p.type === 'gemini-oauth');
    expect(oauth).toBeDefined();
    expect(oauth?.userEmail).toBe('test@test.com');
  });
});
