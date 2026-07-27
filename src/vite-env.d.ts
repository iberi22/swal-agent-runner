/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORS_PROXY_URL: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID: string;
  readonly VITE_DEFAULT_XAVIER_PEER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
