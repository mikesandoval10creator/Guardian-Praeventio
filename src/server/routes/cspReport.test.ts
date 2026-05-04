// SPDX-License-Identifier: MIT
// Sprint 20 twelfth wave Bucket A — CSP violation report endpoint tests.
//
// Coverage:
//   - happy path: valid csp-report → 204 + breadcrumb fired
//   - missing `csp-report` key → 204 (no Sentry interaction)
//   - missing body entirely (express.json with empty payload) → 204
//   - blocked-uri with query string → query stripped before Sentry
//   - browser-token blocked-uri (e.g. "inline", "eval") → passed through
//   - Sentry SDK throwing → still 204 (no leaked exception)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const addBreadcrumbMock = vi.fn();
const captureMessageMock = vi.fn();

// Mock @sentry/node BEFORE importing the route — vi.mock is hoisted.
vi.mock('@sentry/node', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

import { cspReportHandler, __originAndPathForTests } from './cspReport.js';

function buildApp(): express.Express {
  const app = express();
  // Mirror server.ts: parse `application/csp-report` AND `application/json`
  // bodies through the same JSON parser so the handler sees `req.body` as a
  // plain object regardless of which MIME the browser used.
  app.use(express.json({ type: ['application/csp-report', 'application/json'] }));
  app.post('/api/csp-report', cspReportHandler);
  return app;
}

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    addBreadcrumbMock.mockReset();
    captureMessageMock.mockReset();
  });

  it('returns 204 and fires a Sentry breadcrumb on a valid violation report', async () => {
    const app = buildApp();
    // Serialize manually — supertest auto-stringifies on application/json,
    // but for application/csp-report it forwards the object verbatim and
    // superagent's byteLength chokes. Manual JSON.stringify mirrors what
    // browsers actually send.
    const payload = JSON.stringify({
      'csp-report': {
        'violated-directive': "script-src 'self'",
        'blocked-uri': 'https://evil.example.com/payload.js',
        'document-uri': 'https://app.praeventio.cl/dashboard',
        'source-file': 'https://app.praeventio.cl/main.js',
        'line-number': 42,
        'column-number': 7,
        disposition: 'enforce',
      },
    });
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(payload);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
    expect(addBreadcrumbMock.mock.calls[0]?.[0]).toMatchObject({
      category: 'security.csp',
      level: 'warning',
      data: expect.objectContaining({
        violated: "script-src 'self'",
        blocked: 'https://evil.example.com/payload.js',
        line: 42,
        column: 7,
      }),
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      'csp.violation',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('returns 204 without firing Sentry when the body is missing the csp-report key', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/json')
      .send({ unrelated: true });
    expect(res.status).toBe(204);
    expect(addBreadcrumbMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it('returns 204 when the body is empty', async () => {
    const app = buildApp();
    // No body at all — express.json leaves req.body as {}.
    const res = await request(app).post('/api/csp-report');
    expect(res.status).toBe(204);
    expect(addBreadcrumbMock).not.toHaveBeenCalled();
  });

  it('strips query params and fragment from blocked-uri before logging (PII guard)', async () => {
    const app = buildApp();
    const payload = JSON.stringify({
      'csp-report': {
        'violated-directive': "connect-src 'self'",
        'blocked-uri':
          'https://leak.example.com/track?email=alice%40host.com&rut=12345678-9#section',
        'document-uri': 'https://app.praeventio.cl/iper?token=secret',
        'source-file': 'https://app.praeventio.cl/iper.js?v=1',
        'line-number': 1,
      },
    });
    await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(payload);
    const data = addBreadcrumbMock.mock.calls[0]?.[0]?.data ?? {};
    expect(data.blocked).toBe('https://leak.example.com/track');
    expect(data.blocked).not.toContain('email');
    expect(data.blocked).not.toContain('rut');
    expect(data.blocked).not.toContain('#section');
    expect(data.document).toBe('https://app.praeventio.cl/iper');
    expect(data.document).not.toContain('token');
    expect(data.source).toBe('https://app.praeventio.cl/iper.js');

    // captureMessage must receive the same scrubbed values, never the raw
    // payload. Critical — extras are searchable in Sentry.
    const extra = captureMessageMock.mock.calls[0]?.[1]?.extra ?? {};
    expect(extra.blocked).toBe('https://leak.example.com/track');
    expect(extra.document).toBe('https://app.praeventio.cl/iper');
  });

  it('passes through CSP keyword tokens (inline/eval/data) unchanged', async () => {
    expect(__originAndPathForTests('inline')).toBe('inline');
    expect(__originAndPathForTests('eval')).toBe('eval');
    expect(__originAndPathForTests('data')).toBe('data');
    expect(__originAndPathForTests('')).toBe('');
    expect(__originAndPathForTests(null)).toBe('');
    expect(__originAndPathForTests(undefined)).toBe('');
  });

  it('falls back to effective-directive when violated-directive is absent', async () => {
    const app = buildApp();
    const payload = JSON.stringify({
      'csp-report': {
        'effective-directive': 'img-src',
        'blocked-uri': 'https://imgur.com/x.png',
      },
    });
    await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(payload);
    const data = addBreadcrumbMock.mock.calls[0]?.[0]?.data ?? {};
    expect(data.violated).toBe('img-src');
  });

  it('still returns 204 when Sentry.addBreadcrumb throws', async () => {
    addBreadcrumbMock.mockImplementationOnce(() => {
      throw new Error('sentry-down');
    });
    captureMessageMock.mockImplementationOnce(() => {
      throw new Error('sentry-down');
    });
    const app = buildApp();
    const payload = JSON.stringify({
      'csp-report': {
        'violated-directive': "default-src 'self'",
        'blocked-uri': 'https://x.test/y',
      },
    });
    const res = await request(app)
      .post('/api/csp-report')
      .set('Content-Type', 'application/csp-report')
      .send(payload);
    // Most important assertion — no 500, no leaked exception.
    expect(res.status).toBe(204);
  });

  it('does not throw on a malformed blocked-uri', async () => {
    // The URL constructor throws on bad input — handler must trap that.
    expect(__originAndPathForTests('not a url')).toBe('not a url');
    expect(__originAndPathForTests('https://')).toBe('https://');
  });
});
