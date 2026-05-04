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
 */

/*
 * CSP directives — strict-but-compatible.
 *
 * 'unsafe-inline' for script-src is REQUIRED for Vite + React inline bootstrap
 * (until we add nonces; see csp-policy.md, Sprint 22+ tracker).
 *
 * connect-src includes:
 *   - googleapis.com (Firestore, Identity Toolkit, Vertex AI Gemini fallback)
 *   - firebaseio.com (Realtime DB)
 *   - firestore.googleapis.com (explicit, helps caches)
 *   - sentry.io (Sentry ingest endpoint per src/lib/sentry.ts)
 *   - generativelanguage.googleapis.com (Gemini API direct calls)
 *   - wss for Firebase Realtime DB subscriptions
 */
const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'script-src':
    "'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://*.firebaseio.com",
  'style-src': "'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src': "'self' https://fonts.gstatic.com data:",
  'img-src': "'self' data: blob: https:",
  'connect-src':
    "'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://*.sentry.io wss://*.firebaseio.com https://generativelanguage.googleapis.com",
  'frame-src': "'self' https://accounts.google.com",
  'frame-ancestors': "'none'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'upgrade-insecure-requests': '',
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
