/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import crypto from 'crypto';

function cspPlugin() {
  return {
    name: 'vite-plugin-csp',
    transformIndexHtml(html: string) {
      // Find inline scripts and hash them
      const inlineScriptHashes: string[] = [];
      const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(html)) !== null) {
        const attrs = match[1];
        const content = match[2];
        // If it doesn't have a src attribute, it's inline
        if (!/\bsrc\s*=/i.test(attrs) && content.trim().length > 0) {
          const hash = crypto.createHash('sha256').update(content).digest('base64');
          inlineScriptHashes.push(`'sha256-${hash}'`);
        }
      }

      // Base CSP
      const scriptSrc = [
        "'self'",
        "'unsafe-eval'",
        "'wasm-unsafe-eval'",
        "https://cdn.jsdelivr.net",
        ...inlineScriptHashes
      ].join(' ');

      const connectSrc = [
        "'self'",
        "https://api.search.brave.com",
        "https://generativelanguage.googleapis.com",
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        "https://www.googleapis.com",
        "https://openrouter.ai",
        "https://api.opencode.go",
        "https://cors-proxy.swal.dev",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "http://localhost:8006",
        "ws://localhost:*",
        "ws://127.0.0.1:*",
        "ws:",
        "wss:",
      ].join(' ');

      const csp = [
        `default-src 'self'`,
        `script-src ${scriptSrc}`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' data: https://api.qrserver.com`,
        `font-src 'self'`,
        `connect-src ${connectSrc}`,
        `worker-src 'self' blob:`,
        `frame-src 'self' blob:`,
        `object-src 'none'`,
        `base-uri 'self'`,
      ].join('; ');

      const metaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

      if (html.includes('<head>')) {
        return html.replace('<head>', `<head>\n    ${metaTag}`);
      }
      return html;
    }
  };
}

const securityHeadersDev = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https://api.qrserver.com`,
    `font-src 'self'`,
    `connect-src 'self' https://api.search.brave.com https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://openrouter.ai https://api.opencode.go https://cors-proxy.swal.dev https://cdn.jsdelivr.net https://unpkg.com http://localhost:8006 ws://localhost:* ws://127.0.0.1:* ws: wss:`,
    `worker-src 'self' blob:`,
    `frame-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ].join('; '),
};

const securityHeadersProd = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https://api.qrserver.com`,
    `font-src 'self'`,
    `connect-src 'self' https://api.search.brave.com https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://openrouter.ai https://api.opencode.go https://cors-proxy.swal.dev https://cdn.jsdelivr.net https://unpkg.com http://localhost:8006 ws://localhost:* ws://127.0.0.1:* ws: wss:`,
    `worker-src 'self' blob:`,
    `frame-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ].join('; '),
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeManifestIcons: true,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/api\.search\.brave\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'brave-search-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
            },
          },
          {
            urlPattern: /^https?:\/\/localhost:8006\/.*/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'xavier-api-cache',
            },
          },
          {
            urlPattern: /^https?:\/\/unpkg\.com\/cdn\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'unpkg-cdn-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
      manifest: {
        name: 'SWAL Agent Runner',
        short_name: 'SWAL Agent',
        theme_color: '#090a10',
        background_color: '#090a10',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test/a11y/**',
      '**/test/visual/**',
      '**/test/e2e/**',
      '**/.{git,cache,temp}/**'
    ],
  },
  server: {
    headers: securityHeadersDev,
  },
  preview: {
    headers: securityHeadersProd,
  },
});
