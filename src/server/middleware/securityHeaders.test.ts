import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  securityHeaders,
  __buildCspStringForTests,
  __generateNonceForTests,
  __connectSrcOriginsForTests,
  __scriptSrcFallbackOriginsForTests,
} from './securityHeaders.js';

// Build a mock req/res/next triple. We assert via the recorded `setHeader`
// calls instead of running an Express app — middleware is pure, the http
// layer is irrelevant to what we're proving.
function makeCtx(
  reqOverrides: Partial<Request> = {},
): { req: Request; res: Response; next: NextFunction; headers: Record<string, string>; locals: Record<string, unknown> } {
  const headers: Record<string, string> = {};
  const locals: Record<string, unknown> = {};
  const req = {
    headers: {},
    secure: false,
    ...reqOverrides,
  } as Request;
  const res = {
    locals,
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, headers, locals };
}

describe('securityHeaders middleware', () => {
  it('sets Content-Security-Policy with all expected directives', () => {
    const { req, res, next, headers } = makeCtx();
    securityHeaders(req, res, next);

    const csp = headers['Content-Security-Policy'];
    expect(csp).toBeDefined();
    // Defense-in-depth checks — directive presence, not exact string match
    // (so re-ordering keys in source does not break tests).
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).toContain('https://generativelanguage.googleapis.com');
    expect(csp).toContain('https://*.sentry.io');
    // USGS Earthquake API must be reachable — the seismic monitor (life-safety,
    // useSeismicMonitor → usgsEarthquakeAdapter) fetches earthquake.usgs.gov.
    // A missing entry silently blocked it in production (found by running the
    // deployed app; unit tests mock fetch so they never caught it).
    expect(csp).toContain('https://earthquake.usgs.gov');
    expect(__connectSrcOriginsForTests).toContain('https://earthquake.usgs.gov');
  });

  it('sets X-Content-Type-Options nosniff', () => {
    const { req, res, next, headers } = makeCtx();
    securityHeaders(req, res, next);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets Referrer-Policy strict-origin-when-cross-origin', () => {
    const { req, res, next, headers } = makeCtx();
    securityHeaders(req, res, next);
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets X-Frame-Options DENY', () => {
    const { req, res, next, headers } = makeCtx();
    securityHeaders(req, res, next);
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('sets Permissions-Policy with allow-self for camera, microphone, geolocation', () => {
    const { req, res, next, headers } = makeCtx();
    securityHeaders(req, res, next);
    const pp = headers['Permissions-Policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('camera=(self)');
    expect(pp).toContain('microphone=(self)');
    expect(pp).toContain('geolocation=(self)');
    expect(pp).toContain('accelerometer=(self)');
    expect(pp).toContain('gyroscope=(self)');
  });

  it('sets HSTS when request is HTTPS via X-Forwarded-Proto (Cloud Run)', () => {
    const { req, res, next, headers } = makeCtx({
      headers: { 'x-forwarded-proto': 'https' },
    });
    securityHeaders(req, res, next);
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('sets HSTS when req.secure is true (direct TLS)', () => {
    const { req, res, next, headers } = makeCtx({ secure: true });
    securityHeaders(req, res, next);
    expect(headers['Strict-Transport-Security']).toBeDefined();
  });

  it('does NOT set HSTS on plain HTTP (preserves local dev)', () => {
    const { req, res, next, headers } = makeCtx({
      headers: { 'x-forwarded-proto': 'http' },
      secure: false,
    });
    securityHeaders(req, res, next);
    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('calls next() exactly once', () => {
    const { req, res, next } = makeCtx();
    securityHeaders(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('keeps non-script directives stable across invocations (only the nonce varies)', () => {
    // Sprint 20 13th wave Bucket C — the per-request nonce means the FULL
    // CSP string is no longer byte-stable. We assert that the parts that
    // SHOULD be deterministic (everything outside the script-src nonce
    // token) are unchanged across calls. The nonce itself is asserted to
    // VARY in the dedicated test below.
    const { req, res, next, headers } = makeCtx({
      headers: { 'x-forwarded-proto': 'https' },
    });
    securityHeaders(req, res, next);
    const firstCsp = headers['Content-Security-Policy'];
    const firstHsts = headers['Strict-Transport-Security'];
    securityHeaders(req, res, next);
    const secondCsp = headers['Content-Security-Policy'];

    expect(headers['Strict-Transport-Security']).toBe(firstHsts);
    // Strip the nonce token from both and compare the remainder.
    const stripNonce = (s: string) => s.replace(/'nonce-[A-Za-z0-9+/=]+'/, "'nonce-X'");
    expect(stripNonce(secondCsp)).toBe(stripNonce(firstCsp));
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('CSP string contains the required Firebase / Vertex AI / Sentry connect-src origins', () => {
    // Pass a deterministic nonce; the assertions don't depend on it.
    const csp = __buildCspStringForTests('test-nonce');
    // Assert origins listed in the threat-model TM-I03/TM-I05 are reachable
    // — explicit subdomain list, not wildcards (twelfth wave Bucket A).
    expect(csp).toContain('https://firestore.googleapis.com');
    expect(csp).toContain('https://identitytoolkit.googleapis.com');
    expect(csp).toContain('https://securetoken.googleapis.com');
    expect(csp).toContain('https://storage.googleapis.com');
    expect(csp).toContain('https://generativelanguage.googleapis.com');
    expect(csp).toContain('https://aiplatform.googleapis.com');
    expect(csp).toContain('https://oauth2.googleapis.com');
    expect(csp).toContain('https://*.sentry.io');
    expect(csp).toContain('wss://*.firebaseio.com');
  });

  it('CSP no longer carries the broad `*.googleapis.com` wildcard (TM-I05)', () => {
    const csp = __buildCspStringForTests('test-nonce');
    // The whole point of the twelfth wave Bucket A is to NOT have this token.
    // Use a regex with word-ish boundaries so a future legitimate
    // `https://maps.googleapis.com` substring does not accidentally match.
    expect(csp).not.toMatch(/\*\.googleapis\.com/);
  });

  it('script-src no longer carries the `*.firebaseio.com` token (was unreachable)', () => {
    // Firebase JS SDK loads from gstatic; the `*.firebaseio.com` in
    // script-src was a copy-paste from connect-src and never matched a
    // real script load. Removed in twelfth wave Bucket A.
    expect(__scriptSrcFallbackOriginsForTests).not.toContain(
      'https://*.firebaseio.com',
    );
  });

  it('every connect-src origin is either an exact host or an explicitly-allowed wildcard', () => {
    // Belt-and-braces: any future copy-paste of `https://*.googleapis.com`
    // into the list will fail this test. The only wildcards we tolerate
    // are sentry.io (multi-region ingest) and firebaseio websockets.
    const ALLOWED_WILDCARDS = new Set([
      'https://*.sentry.io',
      'wss://*.firebaseio.com',
    ]);
    for (const origin of __connectSrcOriginsForTests) {
      if (origin.includes('*')) {
        expect(ALLOWED_WILDCARDS.has(origin)).toBe(true);
      }
    }
  });

  it('declares report-uri /api/csp-report so violations land in Sentry', () => {
    const csp = __buildCspStringForTests('test-nonce');
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('CSP forbids object embedding and arbitrary frame ancestors', () => {
    const csp = __buildCspStringForTests('test-nonce');
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sprint 20 13th wave Bucket C — nonce migration tests.
  // ───────────────────────────────────────────────────────────────────────

  it('script-src no longer contains \'unsafe-inline\' (Sprint 20 13th wave Bucket C)', () => {
    // The whole point of the nonce migration is to remove this token.
    // A regression that re-adds it for "convenience" must fail loudly.
    const csp = __buildCspStringForTests('test-nonce');
    // Match script-src segment specifically — 'unsafe-inline' may still
    // appear in style-src (Tailwind runtime injects styles).
    const scriptSrcSegment = csp.match(/script-src [^;]+/)?.[0] ?? '';
    expect(scriptSrcSegment).not.toContain("'unsafe-inline'");
  });

  it('script-src declares a nonce + strict-dynamic + explicit fallback', () => {
    const csp = __buildCspStringForTests('abc123');
    const scriptSrcSegment = csp.match(/script-src [^;]+/)?.[0] ?? '';
    expect(scriptSrcSegment).toContain("'self'");
    expect(scriptSrcSegment).toContain("'nonce-abc123'");
    expect(scriptSrcSegment).toContain("'strict-dynamic'");
    // Fallback for browsers that ignore strict-dynamic.
    expect(scriptSrcSegment).toContain('https://www.gstatic.com');
    expect(scriptSrcSegment).toContain('https://apis.google.com');
  });

  it('each request gets a different nonce (per-request randomness)', () => {
    const ctx1 = makeCtx();
    const ctx2 = makeCtx();
    securityHeaders(ctx1.req, ctx1.res, ctx1.next);
    securityHeaders(ctx2.req, ctx2.res, ctx2.next);

    const nonce1 = ctx1.locals.cspNonce as string;
    const nonce2 = ctx2.locals.cspNonce as string;

    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    // 16 random bytes have ≈2^128 entropy — collision is astronomical.
    expect(nonce1).not.toBe(nonce2);

    // The CSP header must embed the nonce that landed in res.locals so
    // the HTML response can stamp the matching value into <script nonce="">.
    expect(ctx1.headers['Content-Security-Policy']).toContain(`'nonce-${nonce1}'`);
    expect(ctx2.headers['Content-Security-Policy']).toContain(`'nonce-${nonce2}'`);
  });

  it('nonce is at least 128 bits (≥22 base64 chars)', () => {
    // CSP Level 3 §6.7.1 RECOMMENDS ≥128 bits. 16 random bytes base64-encode
    // to 24 chars (with padding); without padding it's 22. Either is OK,
    // but we MUST NOT regress to a shorter nonce.
    for (let i = 0; i < 10; i++) {
      const nonce = __generateNonceForTests();
      expect(nonce.length).toBeGreaterThanOrEqual(22);
      // Must be base64-charset only (no spaces, no quotes, no slashes
      // would break the CSP token format).
      expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    }
  });

  it('exposes the nonce on res.locals.cspNonce for HTML templates', () => {
    const { req, res, next, locals } = makeCtx();
    securityHeaders(req, res, next);
    expect(typeof locals.cspNonce).toBe('string');
    expect((locals.cspNonce as string).length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sprint 48 D.13.b — wasm + workers + HF tests
// ────────────────────────────────────────────────────────────────────────

describe('CSP D.13.b — WASM + workers + Hugging Face SLM', () => {
  function getCspForEnv(env: string): string {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = env;
    try {
      return __buildCspStringForTests('TEST_NONCE');
    } finally {
      process.env.NODE_ENV = prev;
    }
  }

  it("prod tiene 'wasm-unsafe-eval' (ONNX SLM + MediaPipe Pose lo requieren)", () => {
    const csp = getCspForEnv('production');
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  it("prod NO tiene 'unsafe-eval' (estrictamente más seguro que wasm-unsafe-eval)", () => {
    const csp = getCspForEnv('production');
    expect(csp).not.toMatch(/'unsafe-eval'(?!-)/); // 'unsafe-eval' a secas no debe aparecer
  });

  it("prod tiene 'strict-dynamic' + nonce", () => {
    const csp = getCspForEnv('production');
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("'nonce-TEST_NONCE'");
  });

  it("dev tiene 'unsafe-eval' (HMR/Vite necesita)", () => {
    const csp = getCspForEnv('development');
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("'unsafe-inline'");
  });

  it("worker-src 'self' blob: para Comlink/Workbox/MediaPipe workers", () => {
    const csp = getCspForEnv('production');
    expect(csp).toMatch(/worker-src 'self' blob:/);
  });

  it('connect-src incluye Hugging Face para SLM model fetch (C.9)', () => {
    expect(__connectSrcOriginsForTests).toContain('https://huggingface.co');
    expect(__connectSrcOriginsForTests).toContain('https://cdn-lfs.huggingface.co');
  });

  it('connect-src NO incluye wildcard *.huggingface.co (anti-exfil)', () => {
    const hasWildcard = __connectSrcOriginsForTests.some((o) => o.includes('*.huggingface.co'));
    expect(hasWildcard).toBe(false);
  });

  it("script-src-elem incluido para WASM module loading", () => {
    const csp = getCspForEnv('production');
    expect(csp).toMatch(/script-src-elem/);
  });
});
