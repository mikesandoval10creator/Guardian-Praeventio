import type { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';

/**
 * Praeventio security headers — defense in depth on top of nginx.conf.
 *
 * Express may serve some routes directly (preview, dev, certain paths,
 * SSR fallbacks, error responses bypassing the SPA shell) so the headers
 * MUST be set here too. Order: this runs BEFORE auth / route handlers so
 * unprotected error paths still get the headers.
 *
 * Layered with helmet: helmet's CSP middleware runs after this, but res
 * headers set here win when downstream middleware uses `res.setHeader`
 * with the same key (Express overwrites). For the headers helmet does
 * NOT cover, ours stand alone. See docs/security/csp-policy.md for the
 * directive rationale and the change process.
 *
 * Sprint 20 eleventh wave Bucket D — additive layer over the
 * conservative nginx CSP shipped in the 8th wave Bucket A.
 *
 * Sprint 20 twelfth wave Bucket A (TM-I05) — wildcards on
 * `*.googleapis.com` (connect-src) and `*.firebaseio.com` (script-src)
 * tightened to an explicit allow-list. `report-uri /api/csp-report`
 * added so violations land as Sentry breadcrumbs (alarm if we
 * accidentally clipped a legitimate origin). `report-to` is the modern
 * spec but requires a `Reporting-Endpoints` header + a JSON object —
 * `report-uri` still works in every shipping browser and is one less
 * moving part to misconfigure.
 *
 * Sprint 20 thirteenth wave Bucket C — `'unsafe-inline'` removed from
 * `script-src`. Replaced with a per-request 128-bit base64 nonce plus
 * `'strict-dynamic'`. `strict-dynamic` (https://content-security-policy.com
 * /strict-dynamic/) lets a nonce-trusted script load further scripts
 * WITHOUT each child needing its own nonce — critical for SPAs whose entry
 * chunk dynamic-imports lazy chunks at runtime. Modern browsers
 * (Chrome 52+/Firefox 52+/Safari 15.4+) honour strict-dynamic and ignore
 * the explicit host allowlist that follows; older browsers ignore
 * strict-dynamic and fall back to the host allowlist. The nonce is
 * exposed at `res.locals.cspNonce` so HTML response generators can stamp
 * it onto inline `<script>` tags via the `__CSP_NONCE__` placeholder.
 */

/*
 * connect-src allow-list — every entry is justified by a real call site.
 * We deliberately list each subdomain because the wildcard form
 * `https://*.googleapis.com` would also allow exfiltration to
 * `attacker-controlled.googleapis.com` if a Google project is ever
 * spun up to host one (cheap to do — Cloud Run + custom domain). The
 * concrete list below is what the SDKs actually contact in production.
 *
 *   - firestore.googleapis.com           Firestore REST + Listen
 *   - identitytoolkit.googleapis.com     Firebase Auth sign-in/up
 *   - securetoken.googleapis.com         Firebase Auth ID-token refresh
 *   - storage.googleapis.com             Firebase Storage downloads
 *   - firebaseinstallations.googleapis.com   FCM/Installations registration
 *   - firebaseremoteconfig.googleapis.com    Remote Config fetches (if used)
 *   - fcmregistrations.googleapis.com    FCM token registration
 *   - generativelanguage.googleapis.com  Gemini API direct
 *   - aiplatform.googleapis.com          Vertex AI Gemini
 *   - oauth2.googleapis.com              OAuth token exchange
 *   - maps.googleapis.com                Geocoding (locationNormativa)
 *   - <region>-firestore.googleapis.com  regional Firestore endpoints — kept as
 *                                        a single explicit pair (sa-east1, us-central1)
 *
 * `wss://*.firebaseio.com` retained because the Firebase JS SDK still
 * opens a websocket against firebaseio when Realtime DB is configured.
 * Audit: drop this entirely once the project is Firestore-only.
 */
const CONNECT_SRC_ORIGINS = [
  "'self'",
  'https://firestore.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://storage.googleapis.com',
  'https://firebaseinstallations.googleapis.com',
  'https://firebaseremoteconfig.googleapis.com',
  'https://fcmregistrations.googleapis.com',
  'https://generativelanguage.googleapis.com',
  'https://aiplatform.googleapis.com',
  'https://oauth2.googleapis.com',
  'https://maps.googleapis.com',
  'https://*.sentry.io',
  'wss://*.firebaseio.com',
  // Sprint 48 D.13.b: SLM offline models (Sprint 47 C.9). Phi-3 mini +
  // Gemma se descargan desde Hugging Face CDN (cdn-lfs.huggingface.co
  // resuelve a las URLs reales del LFS). Cap a esos dos hosts — no abrir
  // toda la HF org porque expone exfiltration surface.
  'https://huggingface.co',
  'https://cdn-lfs.huggingface.co',
  // Sprint F (2026-05-16) — NASA APIs (clima + eventos extremos).
  //  - power.larc.nasa.gov: NASA POWER hourly histórico (nasaPowerAdapter)
  //  - eonet.gsfc.nasa.gov: NASA EONET v3 eventos activos (eonetAdapter)
  // Sin estas entradas el `fetch` desde el cliente queda bloqueado por
  // CSP connect-src en prod y los services silenciosamente pierden la
  // evidencia NASA. Codex review PR #279 (POWER) + audit propio (EONET).
  'https://power.larc.nasa.gov',
  'https://eonet.gsfc.nasa.gov',
  // 2026-06-08 — USGS Earthquake API (monitor sísmico, life-safety). Real call
  // site: `usgsEarthquakeAdapter.ts` (DEFAULT_BASE_URL
  // `https://earthquake.usgs.gov/fdsnws/event/1/query` + the
  // `/earthquakes/feed/v1.0/summary/all_day.geojson` feed) via
  // `useSeismicMonitor`. This host was MISSING from the allow-list, so in
  // production the CSP connect-src SILENTLY blocked every USGS fetch and the
  // seismic monitor received no quake data. Found by running the DEPLOYED app
  // (the unit tests mock `fetch`, so they never caught it). Sibling of the NASA
  // entries above; same rationale.
  'https://earthquake.usgs.gov',
] as const;

/*
 * script-src — Firebase JS SDK is served from gstatic, NOT firebaseio.
 * The previous `https://*.firebaseio.com` token was a copy-paste from
 * connect-src and was never reachable for script loads. Removed.
 *
 * The list below is the EXPLICIT-HOST FALLBACK for older browsers that
 * ignore `'strict-dynamic'`. Modern browsers (Chrome 52+/Firefox 52+/
 * Safari 15.4+) ignore everything in this list as soon as they see
 * strict-dynamic and rely on the nonce alone — the explicit list is
 * dead weight for them but is not removed because we still need it for
 * the long tail of older browsers.
 *
 * `'self'`, `'nonce-X'`, and `'strict-dynamic'` are added by
 * `buildCspString(nonce)` because the nonce is per-request.
 */
const SCRIPT_SRC_FALLBACK_ORIGINS = [
  'https://www.gstatic.com',
  'https://apis.google.com',
] as const;

/*
 * Static directive map. `script-src` is intentionally NOT here — it
 * depends on the per-request nonce and is computed in buildCspString.
 */
const CSP_STATIC_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src': "'self' https://fonts.gstatic.com data:",
  // Sprint 48 D.13.b: blob: img-src para object URLs de fotos cámara
  // (F.19 photo evidence) + thumbnails generados client-side.
  'img-src': "'self' data: blob: https:",
  'connect-src': CONNECT_SRC_ORIGINS.join(' '),
  'frame-src': "'self' https://accounts.google.com",
  'frame-ancestors': "'none'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  // Sprint 48 D.13.b: Web Workers (Comlink SLM, Workbox SW, MediaPipe).
  // 'self' permite todos los workers servidos desde nuestro origin;
  // blob: necesario para workers creados con Blob URLs en runtime.
  'worker-src': "'self' blob:",
  // Sprint 48 D.13.b: ONNX Runtime Web instanciaba el módulo WASM con
  // WebAssembly.instantiate() — modernos browsers requieren
  // 'wasm-unsafe-eval' explícito post-CSP Level 3. Esta directiva habilita
  // solo WASM (no JS eval) y es estrictamente más segura que mantener
  // 'unsafe-eval'. Sin ella, MediaPipe Pose + ONNX SLM fallan en prod.
  'script-src-elem': "'self' 'wasm-unsafe-eval' https://www.gstatic.com https://apis.google.com",
  'upgrade-insecure-requests': '',
  // TM-I05 mitigation: violations POST here, the route hands them to
  // Sentry as a breadcrumb so we notice if we accidentally clipped a
  // legitimate origin. `report-uri` is technically deprecated in favour
  // of `report-to`, but every shipping browser still honours it; the
  // newer mechanism needs a `Reporting-Endpoints` header + JSON object
  // and gives us no extra signal.
  'report-uri': '/api/csp-report',
};

/*
 * Generate a fresh base64-encoded 128-bit nonce. 16 bytes is the OWASP
 * minimum (CSP Level 3 §6.7.1 "the nonce SHOULD be at least 128 bits
 * long"). Default base64 yields 24 chars including padding — well above
 * the 22-char floor demanded by CSP-strict policy auditors.
 */
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

function buildCspString(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
  // Sprint 48 D.13.b: 'wasm-unsafe-eval' agregado en prod para que ONNX
  // Runtime Web (SLM Phi-3 / Gemma) + MediaPipe Pose puedan instanciar
  // sus módulos WASM con WebAssembly.instantiate(). Esta directiva es
  // estrictamente más segura que 'unsafe-eval' — habilita solo WASM,
  // no JS eval.
  const devDirectives = isDev
    ? "'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
    : `'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`;
  const scriptSrc = `script-src 'self' ${devDirectives} ${SCRIPT_SRC_FALLBACK_ORIGINS.join(' ')}`;

  const directives = { ...CSP_STATIC_DIRECTIVES };
  if (isDev) {
    directives['connect-src'] = `${directives['connect-src']} ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*`;
  }

  const otherDirectives = Object.entries(directives)
    .map(([k, v]) => (v ? `${k} ${v}` : k))
    .join('; ');

  return `${scriptSrc}; ${otherDirectives}`;
}

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Per-request nonce. Exposed on res.locals so any downstream HTML
  // response generator (the SPA fallback that serves index.html) can
  // stamp it onto inline <script> tags via the __CSP_NONCE__ placeholder.
  const nonce = generateNonce();
  res.locals.cspNonce = nonce;

  res.setHeader('Content-Security-Policy', buildCspString(nonce));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // Allow-self for sensors/camera/mic/geo because the app legitimately uses
  // them (fall detection, SOS button, IPER photos, commute geolocation).
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(self), accelerometer=(self), gyroscope=(self)',
  );
  // HSTS only on HTTPS — Cloud Run sets X-Forwarded-Proto, and req.secure
  // covers direct TLS termination. Skipped on HTTP so local `npm run dev`
  // (http://localhost:3000) does not pin browsers to HTTPS.
  if (req.headers['x-forwarded-proto'] === 'https' || req.secure) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }
  next();
}

// Test-only export: lets tests assert directives without re-parsing the
// header string. Not part of the public middleware API.
export const __cspStaticDirectivesForTests = CSP_STATIC_DIRECTIVES;
export const __buildCspStringForTests = buildCspString;
export const __generateNonceForTests = generateNonce;
export const __connectSrcOriginsForTests = CONNECT_SRC_ORIGINS;
export const __scriptSrcFallbackOriginsForTests = SCRIPT_SRC_FALLBACK_ORIGINS;
