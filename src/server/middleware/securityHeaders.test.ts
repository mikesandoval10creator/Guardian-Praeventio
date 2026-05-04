import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  securityHeaders,
  __buildCspStringForTests,
  __connectSrcOriginsForTests,
  __scriptSrcOriginsForTests,
} from './securityHeaders.js';

// Build a mock req/res/next triple. We assert via the recorded `setHeader`
// calls instead of running an Express app — middleware is pure, the http
// layer is irrelevant to what we're proving.
function makeCtx(
  reqOverrides: Partial<Request> = {},
): { req: Request; res: Response; next: NextFunction; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const req = {
    headers: {},
    secure: false,
    ...reqOverrides,
  } as Request;
  const res = {
    setHeader: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, headers };
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

  it('is idempotent across multiple invocations on the same response', () => {
    const { req, res, next, headers } = makeCtx({
      headers: { 'x-forwarded-proto': 'https' },
    });
    securityHeaders(req, res, next);
    const firstCsp = headers['Content-Security-Policy'];
    const firstHsts = headers['Strict-Transport-Security'];

    // Second call must produce identical headers (no mutation of module state).
    securityHeaders(req, res, next);
    expect(headers['Content-Security-Policy']).toBe(firstCsp);
    expect(headers['Strict-Transport-Security']).toBe(firstHsts);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('CSP string contains the required Firebase / Vertex AI / Sentry connect-src origins', () => {
    const csp = __buildCspStringForTests();
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
    const csp = __buildCspStringForTests();
    // The whole point of the twelfth wave Bucket A is to NOT have this token.
    // Use a regex with word-ish boundaries so a future legitimate
    // `https://maps.googleapis.com` substring does not accidentally match.
    expect(csp).not.toMatch(/\*\.googleapis\.com/);
  });

  it('script-src no longer carries the `*.firebaseio.com` token (was unreachable)', () => {
    // Firebase JS SDK loads from gstatic; the `*.firebaseio.com` in
    // script-src was a copy-paste from connect-src and never matched a
    // real script load. Removed in twelfth wave Bucket A.
    expect(__scriptSrcOriginsForTests).not.toContain(
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
    const csp = __buildCspStringForTests();
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('CSP forbids object embedding and arbitrary frame ancestors', () => {
    const csp = __buildCspStringForTests();
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });
});
