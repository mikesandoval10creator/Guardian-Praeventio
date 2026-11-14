// SPDX-License-Identifier: MIT
/**
 * JSON 404 for the whole `/api` namespace (TestSprite TC075).
 *
 * Express' default 404 answers with `text/html` (`<pre>Cannot GET /api/…</pre>`)
 * and the production SPA catch-all (`app.get('/{*splat}')`) answers unmatched
 * `/api/*` GETs with the SPA shell (HTTP 200 HTML). Either way an API client
 * that parses errors as JSON receives HTML, and the framework stack leaks in
 * the body.
 *
 * This middleware is mounted AFTER every `/api` router and BEFORE the SPA
 * catch-all, so it only sees requests no router claimed:
 *   • unknown path under `/api`  → 404 `{"error":"not_found"}` (JSON);
 *   • existing path, wrong method → 404 `{"error":"not_found"}` (JSON);
 *   • existing path, right method → the router already answered, this
 *     middleware is never reached.
 *
 * The response shape matches the other 4xx responses of the API
 * (`{"error": "…"}`), so clients keep parsing a single error contract.
 */
import type { NextFunction, Request, Response } from 'express';

const API_NAMESPACE = '/api';

/**
 * True when the request path belongs to the `/api` namespace.
 * `/api` and `/api/…` belong to it; `/apifoo` or `/api-docs` do not.
 */
function isApiPath(pathname: string): boolean {
  return pathname === API_NAMESPACE || pathname.startsWith(`${API_NAMESPACE}/`);
}

/**
 * Express terminal 404 for the API namespace. Mount it with
 * `app.use('/api', apiNotFoundJson)` AFTER the API routers.
 */
export function apiNotFoundJson(req: Request, res: Response, next: NextFunction): void {
  // `req.path` is relative to the mount point when mounted with
  // `app.use('/api', …)`, so the original URL is the reliable source here.
  const pathname = req.originalUrl.split('?')[0];
  if (!isApiPath(pathname)) {
    next();
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({ error: 'not_found' });
}
