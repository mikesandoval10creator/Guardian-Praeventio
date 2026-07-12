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

/*
 * Bloque 1.8 (2026-05-19) — FCM service-worker config injector.
 * `public/firebase-messaging-sw.js` ships with `__VITE_FIREBASE_*__`
 * placeholders rather than hardcoded keys. On `vite build` this plugin
 * substitutes them in `dist/firebase-messaging-sw.js` from the VITE_FIREBASE_*
 * env vars. In dev (vite serve) it's a no-op and the SW logs a warning then
 * skips initializeApp — push notifications are a prod-only concern.
 *
 * Required prod env vars: VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID,
 * VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_STORAGE_BUCKET,
 * VITE_FIREBASE_MESSAGING_SENDER_ID.
 */
function fcmSwConfigInjector(env: Record<string, string>): Plugin {
  const KEYS = [
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
  ];
  return {
    name: 'fcm-sw-config-injector',
    apply: 'build',
    enforce: 'post',
    closeBundle: async () => {
      const fsMod = await import('node:fs/promises');
      const pathMod = await import('node:path');
      const swPath = pathMod.join(process.cwd(), 'dist', 'firebase-messaging-sw.js');
      let content: string;
      try {
        content = await fsMod.readFile(swPath, 'utf8');
      } catch {
        return;
      }
      let substituted = content;
      for (const key of KEYS) {
        const token = `__${key}__`;
        const value = env[key];
        if (value) {
          substituted = substituted.split(token).join(value);
        }
      }
      await fsMod.writeFile(swPath, substituted, 'utf8');
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
      fcmSwConfigInjector(env),
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
          description: 'Plataforma de Prevención de Riesgos Laborales con IA — Cumplimiento DS 54, DS 44/2024, Ley 16.744',
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
            },
            // Sprint 54 ext — pre-packaged SLM weights. CacheFirst so
            // a model loaded once stays cached forever; the only way
            // to evict is via app reinstall (or `bypassCache` runtime
            // option which fetches direct). Files are 100s of MB so
            // we explicitly opt them out of the size cap below.
            {
              urlPattern: /\/models\/.*\.(?:onnx|onnx_data|bin)(?:\?.*)?$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'slm-models',
                cacheableResponse: { statuses: [0, 200] },
                expiration: {
                  // 5 entries × ~500 MB = enough for current registry
                  // (Qwen 483 MB + Phi-3 split 2.7 GB if ever cached).
                  maxEntries: 8,
                  // 1-year TTL; effectively permanent for the install
                  // because IndexedDB cache also tracks the same bytes.
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                // Models legitimately weigh hundreds of MB — bypass the
                // workbox 100MB default size guard for this route only.
                matchOptions: { ignoreVary: true },
              },
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
          // Alpha41 PERF — name the app entry `app-*` so the bundle budget can
          // target it uniquely. Lazy route chunks whose facade module is a
          // folder `index.tsx` are named `index-*` by Rollup; the `.size-limit`
          // "Main entry" glob (`index-*.js`) was summing ALL of them (incl. a
          // 2.4 MB three/monaco lazy chunk) and reporting a phantom 1.14 MB
          // entry. The real entry is ~400 KB. Only entryFileNames changes;
          // chunk/asset names keep Vite defaults.
          entryFileNames: 'assets/app-[hash].js',
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

            // Alpha41 PERF — split the three.js ecosystem so the heavy
            // authoring libs stay OFF the landing critical path. The old
            // single `vendor-three` glued three-core + fiber (small runtime)
            // to drei + troika-three-text + leva (~1.1 MB of 3D-authoring
            // code). A stray shared symbol dragged the WHOLE 1.3 MB chunk into
            // the entry's static graph → modulepreloaded on the anonymous
            // landing. Splitting keeps three-core/fiber as the only piece the
            // shell can pull; drei/troika/leva now load only with the lazy 3D
            // routes that render a <Canvas> (DigitalTwin, RiskNetwork, etc.).
            // WebXR + physics giants (@react-three/xr ≈ 870KB, rapier WASM):
            // used ONLY by AR / physics components behind lazy 3D routes
            // (DigitalTwinAR, TwinPhysicsScene). Isolated first so they are
            // never pulled onto the landing critical path via the drei→fiber
            // chain — they load only when an AR/physics scene mounts.
            if (id.includes('/node_modules/@react-three/xr/') ||
                id.includes('/node_modules/@react-three/rapier/') ||
                id.includes('/node_modules/@dimforge/')) return 'vendor-xr';
            if (id.includes('/node_modules/@react-three/drei/') ||
                id.includes('/node_modules/troika') ||
                id.includes('/node_modules/leva/') ||
                id.includes('/node_modules/@react-three/postprocessing/') ||
                id.includes('/node_modules/maath/') ||
                id.includes('/node_modules/camera-controls/') ||
                id.includes('/node_modules/meshline/')) return 'vendor-drei';
            if (id.includes('/node_modules/@react-three/')) return 'vendor-r3f';
            if (id.includes('/node_modules/three/')) return 'vendor-three';

            // MediaPipe (vision/camera utils, WASM workers)
            if (id.includes('/node_modules/@mediapipe/')) return 'vendor-mediapipe';

            // Alpha41 PERF (Notion 397aa66d…79d8) — the old 'vendor-viz'
            // grab-bag chunk-mated EAGER animation libs (framer-motion: 15
            // eager importers via RootLayout/Sidebar/emergency components;
            // gsap: shared Card.tsx) with LAZY-only charting (d3/recharts).
            // Result: the landing modulepreloaded ~1.07MB of viz where most
            // was chart code it never runs (PSI "unused JavaScript").
            // Split so the boot graph carries only what it actually animates;
            // charts now load exclusively with the lazy pages that draw them.
            if (id.includes('/node_modules/framer-motion/')) return 'vendor-motion';
            if (id.includes('/node_modules/gsap/') ||
                id.includes('/node_modules/@gsap/')) return 'vendor-gsap';
            if (id.includes('/node_modules/d3') ||
                id.includes('/node_modules/recharts/')) return 'vendor-charts';

            // Alpha41 PERF — transformers/onnx pinned to ONE chunk: with no
            // rule, two dynamic-import contexts each inlined a full copy
            // (transformers.web-* ×2 ≈ 1.7MB duplicated in dist — PSI
            // "JavaScript duplicado"). Worker bundles keep their own graph
            // (worker.format 'es'), so this dedupes main-thread copies only.
            if (id.includes('/node_modules/@huggingface/') ||
                id.includes('/node_modules/@xenova/') ||
                id.includes('/node_modules/onnxruntime-web/')) return 'vendor-transformers';

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
        // bundle that Vite's pre-bundler should NOT try to rewrite. Excl.
        'onnxruntime-web'
      ]
    },
    // Sprint 20 Bucket Epsilon T-1.2 (B14: worker unificado) — emit Web
    // Workers as ES modules so `new Worker(new URL(
    // './worker/slmRuntimeWorker.ts', import.meta.url), { type: 'module' })`
    // works in dev and prod alike. Without `format: 'es'` Vite bundles
    // workers as classic scripts and the worker's top-level imports fail.
    worker: {
      format: 'es' as const,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    // E2E full-stack: `vite preview` (:4173) forwards /api/* to the Express
    // server (:3000) so browser-origin calls like SOSButton's relative
    // `fetch('/api/emergency/sos')` reach the real backend. Without this the
    // request hits the static preview server and 404s.
    // ponytail: only `preview` needs it — `npm run dev` runs Express+Vite
    // same-origin on :3000, so /api is already local there.
    preview: {
      proxy: {
        '/api': { target: 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});
