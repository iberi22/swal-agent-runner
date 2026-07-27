import { ProviderConfig } from '../../../types';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface OAuthState {
  codeVerifier: string;
  state: string;
}

export class GeminiOAuthService {
  private static STORAGE_KEY = 'swal_gemini_oauth';

  public static getSavedConfig(): ProviderConfig | null {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public static saveConfig(config: ProviderConfig): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
  }

  public static async generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const codeVerifier = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');

    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return { codeVerifier, codeChallenge };
  }

  public static async startOAuthLogin(clientId: string): Promise<void> {
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const { codeVerifier, codeChallenge } = await this.generatePKCE();
    const state = crypto.randomUUID();

    sessionStorage.setItem('pkce_code_verifier', codeVerifier);
    sessionStorage.setItem('pkce_state', state);

    const scope = encodeURIComponent('https://www.googleapis.com/auth/generative-language.retrieval https://www.googleapis.com/auth/userinfo.email');

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}&access_type=offline&prompt=consent`;

    window.location.href = authUrl;
  }

  public static async handleCallback(code: string, returnedState: string, clientId: string, clientSecret?: string): Promise<ProviderConfig> {
    const savedVerifier = sessionStorage.getItem('pkce_code_verifier');
    const savedState = sessionStorage.getItem('pkce_state');

    if (savedState !== returnedState || !savedVerifier) {
      throw new Error('Invalid OAuth state or missing code verifier.');
    }

    const redirectUri = `${window.location.origin}/oauth/callback`;
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      code_verifier: savedVerifier,
    });
    if (clientSecret) {
      bodyParams.append('client_secret', clientSecret);
    }

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google OAuth Token exchange failed: ${errText}`);
    }

    const tokenData = await res.json();
    
    // Fetch user info for email
    let userEmail = 'Google AI Pro User';
    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userInfo = await userRes.json();
        userEmail = userInfo.email || userEmail;
      }
    } catch {
      // Non-fatal if userinfo fails
    }

    const config: ProviderConfig = {
      type: 'gemini-oauth',
      name: 'Google AI Pro (OAuth2)',
      enabled: true,
      oauthToken: tokenData.access_token,
      oauthRefreshToken: tokenData.refresh_token,
      oauthExpiresAt: Date.now() + tokenData.expires_in * 1000,
      userEmail: userEmail,
      model: 'gemini-2.5-pro',
    };

    this.saveConfig(config);
    sessionStorage.removeItem('pkce_code_verifier');
    sessionStorage.removeItem('pkce_state');

    return config;
  }
}
