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
          theme_color: '#58D66D',
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
          // Vendor split: pin large deps into dedicated chunks so
          // .size-limit.json budgets can watch them individually instead
          // of dumping everything into the main bundle.
          manualChunks: {
            // React + ReactDOM + react-router (~150KB gzip)
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],

            // Firebase client SDK surface used by the web app (~120KB gzip).
            // firebase-admin is server-side only and stays externalised above.
            'vendor-firebase': [
              'firebase/app',
              'firebase/auth',
              'firebase/firestore',
              'firebase/storage',
              'firebase/functions',
            ],

            // Animations (framer-motion ~30KB gzip)
            'vendor-motion': ['framer-motion'],

            // Gantt (gantt-task-react ~30KB gzip)
            'vendor-gantt': ['gantt-task-react'],

            // Notes:
            // - lucide-react is tree-shakeable; no manual split needed.
            // - recharts / d3 / three / react-force-graph stay in app code
            //   so they get lazy-loaded with their consuming routes.
            // - Health Connect / HealthKit are native Capacitor plugins and
            //   never enter the web bundle.
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
        'pdfkit'
      ]
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
