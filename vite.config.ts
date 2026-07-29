/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  base: '/swal-agent-runner/',
  worker: {
    format: 'es',
  },
  plugins: [
    {
      name: 'replace-sw-path',
      enforce: 'pre' as const,
      transform(code, id) {
        if (id.endsWith('src/main.tsx')) {
          return {
            code: code.replace("'/sw.js'", "import.meta.env.BASE_URL + 'sw.js'"),
            map: null,
          };
        }
      }
    },
    react(),
    tailwindcss(),
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
      '../wasm/gestalt_wasm.js': 'data:text/javascript,export default async function init(){}; export class GestaltEngine{}',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
