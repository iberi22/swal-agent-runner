import React, { useState, useEffect } from 'react';
import { Key, Shield, LogIn, Check, Cpu, ExternalLink, Globe } from 'lucide-react';
import { ProviderConfig, LLMProviderType } from '../types';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { GeminiOAuthService } from '../services/llm/providers/gemini-oauth';

interface AuthSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="bg-[#0f1117] border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-2xl w-full shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">LLM Provider & Authentication Settings</h3>
              <p className="text-xs text-slate-400">Configure Google AI Pro OAuth2, Gemini, OpenRouter & OpenCodeGo API Keys</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-sm font-semibold">
            ✕
          </button>
        </div>

        {/* Active Provider Radio */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Select Active Default LLM Provider
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {providers.map((p) => (
              <button
                key={p.type}
                type="button"
                onClick={() => handleProviderSelect(p.type)}
                className={`p-3.5 rounded-2xl border text-left flex items-start justify-between transition-all ${
                  activeType === p.type
                    ? 'border-indigo-500 bg-indigo-500/10 text-slate-100'
                    : 'border-slate-800 bg-[#0a0a0f] text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-semibold text-xs text-slate-200">{p.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">{p.model}</div>
                </div>
                {activeType === p.type && (
                  <span className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Provider Config Tabs */}
        <div className="space-y-6 pt-2">
          {/* Google AI Pro OAuth2 */}
          <div className="border border-slate-800 bg-[#0a0a0f] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-slate-200 flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" /> Google AI Pro / Gemini (OAuth2 PKCE Flow)
              </span>
              <span className="text-[10px] text-slate-500">Google Account Login</span>
            </div>
            <p className="text-xs text-slate-400">
              Use your Google AI Pro / One Ultra subscription directly by signing in with Google OAuth2 (PKCE).
            </p>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="Google OAuth Client ID (e.g. 1234...apps.googleusercontent.com)"
                value={googleClientId}
                onChange={(e) => setGoogleClientId(e.target.value)}
                className="w-full bg-[#0f1117] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleStartGoogleOAuth}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-all"
              >
                <LogIn className="w-4 h-4" /> Sign In with Google AI Pro
              </button>
            </div>
          </div>

          {/* Gemini API Key */}
          <div className="border border-slate-800 bg-[#0a0a0f] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-slate-200">Google Gemini API Key</span>
            </div>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={providers.find((p) => p.type === 'gemini-key')?.apiKey || ''}
              onChange={(e) => handleConfigChange('gemini-key', { apiKey: e.target.value })}
              className="w-full bg-[#0f1117] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* OpenRouter API Key */}
          <div className="border border-slate-800 bg-[#0a0a0f] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-slate-200">OpenRouter API Key</span>
            </div>
            <input
              type="password"
              placeholder="sk-or-v1-..."
              value={providers.find((p) => p.type === 'openrouter')?.apiKey || ''}
              onChange={(e) => handleConfigChange('openrouter', { apiKey: e.target.value })}
              className="w-full bg-[#0f1117] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* OpenCodeGo & Custom API */}
          <div className="border border-slate-800 bg-[#0a0a0f] rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-slate-200">OpenCodeGo / Custom OpenAI API</span>
            </div>
            <input
              type="password"
              placeholder="API Key"
              value={providers.find((p) => p.type === 'opencode')?.apiKey || ''}
              onChange={(e) => handleConfigChange('opencode', { apiKey: e.target.value })}
              className="w-full bg-[#0f1117] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 mb-2"
            />
            <input
              type="url"
              placeholder="Base URL Endpoint (default: https://api.opencode.go/v1/chat/completions)"
              value={providers.find((p) => p.type === 'opencode')?.baseUrl || ''}
              onChange={(e) => handleConfigChange('opencode', { baseUrl: e.target.value })}
              className="w-full bg-[#0f1117] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-xs"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
