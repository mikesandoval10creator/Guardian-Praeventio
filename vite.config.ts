import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import viteCompression from 'vite-plugin-compression';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      viteCompression({
        algorithm: 'brotliCompress',
        ext: '.br',
        threshold: 1024,
      }),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Guardian Praeventio',
          short_name: 'Praeventio',
          description: 'Plataforma de Prevención de Riesgos Laborales con IA — Cumplimiento DS 54, DS 40, Ley 16.744',
          theme_color: '#4db6ac',
          background_color: '#18181b',
          display: 'standalone',
          lang: 'es-CL',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
          maximumFileSizeToCacheInBytes: 100 * 1024 * 1024, // 100MB for offline assets
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/picsum\.photos\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'placeholder-images',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
               urlPattern: ({ request }) => request.destination === 'image' || request.destination === 'font',
               handler: 'StaleWhileRevalidate',
               options: {
                 cacheName: 'static-assets',
                 expiration: {
                   maxEntries: 200,
                   maxAgeSeconds: 60 * 60 * 24 * 30
                 }
               }
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        mangle: {
          toplevel: true, // Ofuscación fuerte
          keep_classnames: false,
          keep_fnames: false,
        },
        format: {
          comments: false,
        }
      },
      rollupOptions: {
        external: [
          'express',
          'firebase-admin',
          'cookie-parser',
          'express-session',
          'pdfkit'
        ],
        output: {
          // Vendor split: route id-based matching so transitive deps
          // (e.g. scheduler pulled in by react) land in the right chunk
          // and size-limit can budget each vendor independently.
          // firebase-admin / pdfkit / express stay externalised above.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;

            // React core + router (~150KB gzip)
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/react-router') ||
              id.includes('/node_modules/scheduler/')
            ) return 'vendor-react';

            // Firebase client SDK (~120KB gzip)
            if (id.includes('/node_modules/firebase/') ||
                id.includes('/node_modules/@firebase/')) return 'vendor-firebase';

            // Three.js + react-three-fiber/drei
            if (id.includes('/node_modules/three/') ||
                id.includes('/node_modules/@react-three/')) return 'vendor-three';

            // MediaPipe (vision/camera utils, WASM workers)
            if (id.includes('/node_modules/@mediapipe/')) return 'vendor-mediapipe';

            // Visualization / animation grab-bag
            if (id.includes('/node_modules/d3') ||
                id.includes('/node_modules/recharts/') ||
                id.includes('/node_modules/framer-motion/') ||
                id.includes('/node_modules/gsap/') ||
                id.includes('/node_modules/@gsap/')) return 'vendor-viz';

            // Sentry SDK
            if (id.includes('/node_modules/@sentry/')) return 'vendor-sentry';

            // Gantt (kept separate since it lazy-loads with planning routes)
            if (id.includes('/node_modules/gantt-task-react/')) return 'vendor-gantt';

            return undefined;
          },
        },
      }
    },
    optimizeDeps: {
      exclude: [
        'express',
        'firebase-admin',
        'cookie-parser',
        'express-session',
        'pdfkit',
        // Sprint 20 Bucket Epsilon T-1.2 — `onnxruntime-web` ships a WASM
        // bundle that Vite's pre-bundler should NOT try to rewrite; it
        // also pulls `comlink` transitively from the worker source. Excl.
        'onnxruntime-web'
      ]
    },
    // Sprint 20 Bucket Epsilon T-1.2 — emit Web Workers as ES modules
    // so `new Worker(new URL('./worker/slmWorker.ts', import.meta.url),
    // { type: 'module' })` works in dev and prod alike. Without
    // `format: 'es'` Vite bundles workers as classic scripts and the
    // worker's top-level `import * as Comlink` fails at runtime.
    worker: {
      format: 'es' as const,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
