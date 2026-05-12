import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import viteCompression from 'vite-plugin-compression';

/*
 * Sprint 20 13th wave Bucket C — CSP nonce placeholder injection.
 *
 * Vite transforms the source `<script type="module" src="/src/main.tsx">`
 * into the final `<script type="module" crossorigin src="/assets/index-XXX.js">`
 * during the build, REPLACING the original tag. Any `nonce` attribute on the
 * source tag is therefore lost — Vite owns the emit. This plugin runs after
 * Vite emits its scripts and stamps `nonce="__CSP_NONCE__"` onto every
 * `<script>` tag in the output HTML so the Express middleware's per-request
 * substitution finds them. Idempotent: tags that already carry a nonce are
 * left alone.
 */
function cspNoncePlaceholder(): Plugin {
  return {
    name: 'csp-nonce-placeholder',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html: string): string {
        return html.replace(
          /<script(?![^>]*\snonce=)([^>]*)>/g,
          '<script$1 nonce="__CSP_NONCE__">',
        );
      },
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      cspNoncePlaceholder(),
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
        // Sprint 30 Bucket II — local workspace alias for the
        // @praeventio/capacitor-mesh plugin scaffold (ADR 0013). The
        // plugin lives in packages/ and is not yet npm-published; the
        // alias lets `import { Mesh } from '@praeventio/capacitor-mesh'`
        // resolve without setting up workspaces.
        '@praeventio/capacitor-mesh': path.resolve(
          __dirname,
          'packages/capacitor-mesh/src/index.ts',
        ),
        // Sprint 32 audit P0 build fix — redirect server-only error
        // tracker adapters to browser stubs in the client bundle.
        // `services/observability/index.ts` statically imports
        // `sentryAdapter` and `cloudErrorReportingAdapter` so it can
        // dispatch by ERROR_TRACKER env var; in production server
        // those resolve normally (server.ts isn't Vite-bundled),
        // but in the browser the real adapters drag `@sentry/node`
        // (which imports `node:diagnostics_channel`) and
        // `@google-cloud/error-reporting` into the client bundle —
        // Vite then errors with "X not exported by __vite-browser-
        // external". Aliasing to no-op stubs keeps the static import
        // graph valid without leaking Node-only deps into the browser.
        // Browser surfaces use `@sentry/react` directly via
        // `src/lib/sentry.ts` — independent path.
        './sentryAdapter': path.resolve(
          __dirname,
          'src/services/observability/sentryAdapter.browser-stub.ts',
        ),
        './cloudErrorReportingAdapter': path.resolve(
          __dirname,
          'src/services/observability/cloudErrorReportingAdapter.browser-stub.ts',
        ),
        './noopErrorTrackingAdapter': path.resolve(
          __dirname,
          'src/services/observability/noopErrorTrackingAdapter.browser-stub.ts',
        ),
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
            // Sprint 36 audit P1 §1.4 — first-party heavy service chunks.
            // Sprint 34 E6 (DTE) + Sprint 35 F1 (Aptitude/DS109) added
            // generators/signers/PDF renderers that are only consumed by
            // a single lazy route. Pinning them to dedicated chunks keeps
            // `index-*.js` from re-pulling them when the lazy route's
            // dependency graph overlaps the main bundle (e.g. shared
            // utils/logger). Resolves the size-limit creep that bumped
            // 340→380KB in Sprint 34 and was about to bump to 420KB in
            // Sprint 35.
            if (id.includes('/src/services/sii/')) return 'lazy-sii';
            if (id.includes('/src/utils/aptitudeCertificate') ||
                id.includes('/src/utils/ds109Certificate') ||
                id.includes('/src/utils/ds67Certificate') ||
                id.includes('/src/utils/ds67Notification') ||
                id.includes('/src/utils/ds76Certificate') ||
                id.includes('/src/utils/ds76MiningContractor') ||
                id.includes('/src/utils/susesoCertificate') ||
                id.includes('/src/utils/trainingCertificate') ||
                id.includes('/src/services/privacy/dpiaTemplate')) return 'lazy-cert-pdf';
            if (id.includes('/src/services/iot/edgeFilter') ||
                id.includes('/src/services/ergonomics/poseEdgeFilter')) return 'lazy-edgefilter';

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
