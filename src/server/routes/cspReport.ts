// Praeventio Guard — Sprint 20 twelfth wave Bucket A (TM-I05).
//
// CSP violation report endpoint. Browsers POST a JSON body with a
// `csp-report` key when a directive blocks a resource. We log to Sentry
// as a breadcrumb (so a noisy violation rate is visible on the issue
// timeline of any error that follows) AND emit a `captureMessage` so
// dashboards count violations even when no exception is thrown.
//
// Why an empty 204:
//   - The spec only requires that the browser see a successful HTTP
//     response. A 204 with no body avoids handing an attacker a
//     useful response (status code lookup, body-length oracle).
//
// Why query params are stripped from `blocked-uri`:
//   - Some browsers include the full URL (with query) of the blocked
//     resource. If a third-party form posts `?email=alice@host.com`
//     and the browser blocks it, the email lands in our Sentry feed.
//     `originAndPath(uri)` strips query+hash before logging.
//
// Why the handler never throws:
//   - This endpoint is hit by browsers we don't control with bodies
//     we don't fully trust. Any exception bubbles into the global
//     error handler and burns Sentry budget. We swallow everything
//     and 204 unconditionally.
//
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import * as Sentry from '@sentry/node';

/**
 * Strip query string + fragment from a URL before logging. The CSP
 * `blocked-uri` field can contain either a full URL or a token like
 * `inline`, `eval`, `data`, or the empty string. We only mutate it
 * when it parses as an absolute URL with a `://`; otherwise pass
 * through untouched.
 */
function originAndPath(uri: unknown): string {
  if (typeof uri !== 'string' || !uri) return '';
  // Cheap pre-filter — avoids URL constructor on every keyword/empty.
  if (!uri.includes('://')) return uri;
  try {
    const u = new URL(uri);
    return `${u.origin}${u.pathname}`;
  } catch {
    return uri;
  }
}

/** Shape of a browser CSP violation report (subset we log). */
interface CspReportPayload {
  'violated-directive'?: unknown;
  'effective-directive'?: unknown;
  'blocked-uri'?: unknown;
  'document-uri'?: unknown;
  'source-file'?: unknown;
  'line-number'?: unknown;
  'column-number'?: unknown;
  disposition?: unknown;
  'status-code'?: unknown;
}

/**
 * Express handler for `POST /api/csp-report`.
 *
 * Always 204. Body is parsed by the `application/csp-report` JSON parser
 * mounted in server.ts BEFORE this handler runs.
 */
export function cspReportHandler(req: Request, res: Response): void {
  try {
    const body = req.body as { 'csp-report'?: CspReportPayload } | null;
    const report = body && body['csp-report'];
    if (report && typeof report === 'object') {
      // Strip query strings BEFORE handing the value to Sentry. PII
      // contamination in `blocked-uri` is the dominant risk here —
      // the browser can ship a third-party URL with whatever the page
      // happened to be POSTing.
      const blocked = originAndPath(report['blocked-uri']);
      const document = originAndPath(report['document-uri']);
      const source = originAndPath(report['source-file']);
      const violated =
        (typeof report['violated-directive'] === 'string'
          ? report['violated-directive']
          : null) ??
        (typeof report['effective-directive'] === 'string'
          ? report['effective-directive']
          : null) ??
        'unknown';

      try {
        Sentry.addBreadcrumb({
          category: 'security.csp',
          message: 'CSP violation',
          level: 'warning',
          data: {
            violated,
            blocked,
            document,
            source,
            line: report['line-number'] ?? null,
            column: report['column-number'] ?? null,
            disposition: report.disposition ?? null,
          },
        });
      } catch {
        /* observability faults must not turn this 204 into a 500 */
      }

      try {
        // captureMessage so dashboards can count violations independently
        // of any error that may follow. We pass the SCRUBBED fields, not
        // the raw report, to keep PII out of the Sentry payload.
        Sentry.captureMessage('csp.violation', {
          level: 'warning',
          extra: {
            violated,
            blocked,
            document,
            source,
            line: report['line-number'] ?? null,
            column: report['column-number'] ?? null,
            disposition: report.disposition ?? null,
          },
        });
      } catch {
        /* swallow */
      }
    }
  } catch {
    /* never throw from a report endpoint */
  }
  res.status(204).end();
}

// Test-only re-export so `cspReport.test.ts` can hit the URL scrubber
// directly without round-tripping through the route handler.
export const __originAndPathForTests = originAndPath;
