import React, { useState, useEffect } from 'react';
import { Key, LogIn, Check, Globe, X, CircleCheck, CircleDashed } from 'lucide-react';
import { ProviderConfig, LLMProviderType } from '../types';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { GeminiOAuthService } from '../services/llm/providers/gemini-oauth';

interface AuthSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 font-mono text-xs text-fg placeholder-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

/** A provider counts as "configured" when it carries a credential. */
const isConfigured = (p?: ProviderConfig): boolean =>
  Boolean(p && (p.apiKey || p.oauthToken));

const ConfigBadge: React.FC<{ configured: boolean; label?: string }> = ({
  configured,
  label,
}) =>
  configured ? (
    <span className="flex items-center gap-1 rounded-full border border-ok/25 bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok">
      <CircleCheck className="h-3 w-3" />
      {label || 'Configured'}
    </span>
  ) : (
    <span className="flex items-center gap-1 rounded-full border border-line bg-elevated px-2 py-0.5 text-[10px] font-medium text-faint">
      <CircleDashed className="h-3 w-3" />
      Not configured
    </span>
  );

export const AuthSettingsModal: React.FC<AuthSettingsModalProps> = ({ isOpen, onClose }) => {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeType, setActiveType] = useState<LLMProviderType>('gemini-key');
  const [googleClientId, setGoogleClientId] = useState(
    import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || ''
  );

  useEffect(() => {
    if (isOpen) {
      setProviders(LLMProviderManager.getProviders());
      setActiveType(LLMProviderManager.getActiveProviderType());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleProviderSelect = (type: LLMProviderType) => {
    setActiveType(type);
    LLMProviderManager.setActiveProviderType(type);
  };

  const handleConfigChange = (type: LLMProviderType, updates: Partial<ProviderConfig>) => {
    const updated = providers.map((p) => (p.type === type ? { ...p, ...updates } : p));
    setProviders(updated);
    const target = updated.find((p) => p.type === type);
    if (target) {
      LLMProviderManager.updateProvider(target);
    }
  };

  const handleStartGoogleOAuth = () => {
    if (!googleClientId) {
      alert('Please enter a valid Google OAuth Client ID.');
      return;
    }
    GeminiOAuthService.startOAuthLogin(googleClientId);
  };

  const oauthProvider = providers.find((p) => p.type === 'gemini-oauth');
  const byType = (t: LLMProviderType) => providers.find((p) => p.type === t);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl animate-scale-in space-y-6 overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-safe shadow-2xl sm:rounded-3xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent-strong">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-fg md:text-lg">
                LLM Provider & Authentication
              </h3>
              <p className="text-[11px] text-muted md:text-xs">
                Google AI Pro OAuth2, Gemini, OpenRouter & OpenCodeGo API keys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-faint transition-colors hover:bg-elevated hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Active provider selector */}
        <div>
          <label className="mb-3 block text-[11px] font-semibold uppercase tracking-wider text-muted">
            Active Default LLM Provider
          </label>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {providers.map((p) => {
              const active = activeType === p.type;
              const configured = isConfigured(p);
              return (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => handleProviderSelect(p.type)}
                  className={`rounded-2xl border p-3.5 text-left transition-all duration-150 ${
                    active
                      ? 'border-accent bg-accent/10 shadow-glow-accent'
                      : 'border-line bg-base hover:border-line-strong'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={`truncate text-xs font-semibold ${active ? 'text-fg' : 'text-muted'}`}>
                        {p.name}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-faint">
                        {p.model}
                      </div>
                    </div>
                    {active ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : (
                      <span
                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                          configured ? 'bg-ok' : 'bg-line-strong'
                        }`}
                        title={configured ? 'Configured' : 'Not configured'}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Provider configuration sections */}
        <div className="space-y-4 pt-1">
          {/* Google AI Pro OAuth2 */}
          <div className="space-y-3 rounded-2xl border border-line bg-base p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-fg">
                <Globe className="h-4 w-4 text-accent-strong" />
                Google AI Pro / Gemini (OAuth2 PKCE)
              </span>
              <ConfigBadge
                configured={Boolean(oauthProvider?.oauthToken)}
                label={oauthProvider?.userEmail ? `Connected` : 'Configured'}
              />
            </div>
            {oauthProvider?.oauthToken && oauthProvider.userEmail && (
              <p className="font-mono text-[10px] text-ok">{oauthProvider.userEmail}</p>
            )}
            <p className="text-xs leading-relaxed text-muted">
              Use your Google AI Pro / One Ultra subscription directly by signing in with Google
              OAuth2 (PKCE).
            </p>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Google OAuth Client ID (e.g. 1234…apps.googleusercontent.com)"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                className={inputClass}
              />
              <button
                type="button"
                onClick={handleStartGoogleOAuth}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-xs font-semibold text-white shadow-glow-accent transition-all hover:bg-accent-strong active:scale-[0.98]"
              >
                <LogIn className="h-4 w-4" /> Sign In with Google AI Pro
              </button>
            </div>
          </div>

          {/* Gemini API Key */}
          <div className="space-y-3 rounded-2xl border border-line bg-base p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">Google Gemini API Key</span>
              <ConfigBadge configured={isConfigured(byType('gemini-key'))} />
            </div>
            <input
              type="password"
              placeholder="AIzaSy…"
              value={byType('gemini-key')?.apiKey || ''}
              onChange={(e) => handleConfigChange('gemini-key', { apiKey: e.target.value })}
              className={inputClass}
            />
          </div>

          {/* OpenRouter API Key */}
          <div className="space-y-3 rounded-2xl border border-line bg-base p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">OpenRouter API Key</span>
              <ConfigBadge configured={isConfigured(byType('openrouter'))} />
            </div>
            <input
              type="password"
              placeholder="sk-or-v1-…"
              value={byType('openrouter')?.apiKey || ''}
              onChange={(e) => handleConfigChange('openrouter', { apiKey: e.target.value })}
              className={inputClass}
            />
          </div>

          {/* OpenCodeGo / Custom API */}
          <div className="space-y-3 rounded-2xl border border-line bg-base p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-fg">OpenCodeGo / Custom OpenAI API</span>
              <ConfigBadge configured={isConfigured(byType('opencode'))} />
            </div>
            <input
              type="password"
              placeholder="API Key"
              value={byType('opencode')?.apiKey || ''}
              onChange={(e) => handleConfigChange('opencode', { apiKey: e.target.value })}
              className={inputClass}
            />
            <input
              type="url"
              placeholder="Base URL Endpoint (default: https://api.opencode.go/v1/chat/completions)"
              value={byType('opencode')?.baseUrl || ''}
              onChange={(e) => handleConfigChange('opencode', { baseUrl: e.target.value })}
              className={inputClass}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-line pt-4">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-accent px-6 py-3 text-xs font-semibold text-white shadow-glow-accent transition-all hover:bg-accent-strong active:scale-[0.98] sm:w-auto sm:py-2.5"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
