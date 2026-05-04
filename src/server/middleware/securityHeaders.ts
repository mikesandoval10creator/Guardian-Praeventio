import type { Request, Response, NextFunction } from 'express';

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
] as const;

/*
 * script-src — Firebase JS SDK is served from gstatic, NOT firebaseio.
 * The previous `https://*.firebaseio.com` token was a copy-paste from
 * connect-src and was never reachable for script loads. Removed.
 *
 * `'unsafe-inline'` for script-src is REQUIRED for Vite + React inline
 * bootstrap (until we add nonces; see csp-policy.md, Sprint 22+ tracker).
 */
const SCRIPT_SRC_ORIGINS = [
  "'self'",
  "'unsafe-inline'",
  'https://www.gstatic.com',
  'https://apis.google.com',
] as const;

const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'script-src': SCRIPT_SRC_ORIGINS.join(' '),
  'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src': "'self' https://fonts.gstatic.com data:",
  'img-src': "'self' data: blob: https:",
  'connect-src': CONNECT_SRC_ORIGINS.join(' '),
  'frame-src': "'self' https://accounts.google.com",
  'frame-ancestors': "'none'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'upgrade-insecure-requests': '',
  // TM-I05 mitigation: violations POST here, the route hands them to
  // Sentry as a breadcrumb so we notice if we accidentally clipped a
  // legitimate origin. `report-uri` is technically deprecated in favour
  // of `report-to`, but every shipping browser still honours it; the
  // newer mechanism needs a `Reporting-Endpoints` header + JSON object
  // and gives us no extra signal.
  'report-uri': '/api/csp-report',
};

function buildCspString(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([k, v]) => (v ? `${k} ${v}` : k))
    .join('; ');
}

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Content-Security-Policy', buildCspString());
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
export const __cspDirectivesForTests = CSP_DIRECTIVES;
export const __buildCspStringForTests = buildCspString;
export const __connectSrcOriginsForTests = CONNECT_SRC_ORIGINS;
export const __scriptSrcOriginsForTests = SCRIPT_SRC_ORIGINS;
