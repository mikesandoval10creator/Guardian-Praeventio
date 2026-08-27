/**
 * CORS middleware — Bug 2 (Bundle-Verify-2026-08-27).
 *
 * Per Daniel 2026-08-27: frontend y API viven en mismo host
 * (`app.praeventio.net`), entonces same-origin cubre el caso normal.
 * Pero este middleware es defensa en profundidad para:
 *   - Subdominios autorizados (ej. panel admin `admin.praeventio.net`).
 *   - Capacitor WebView que podría correr en un origin móvil distinto.
 *   - Localhost durante desarrollo.
 *
 * Reglas (RFC 7231 + CORS spec):
 *   1. La whitelist es EXPLICITA. No usamos `*` porque necesitamos
 *      `Access-Control-Allow-Credentials: true` y el browser prohíbe
 *      `*` con credentials.
 *   2. Si el Origin del request NO está en la whitelist, NO emitimos
 *      `Access-Control-Allow-Origin`. El browser bloquea la response.
 *   3. Para requests con credentials (cookies, auth headers) DEBEMOS
 *      hacer echo del Origin exacto (no `*`) y setear `Vary: Origin`
 *      para que caches no mezclen responses entre origins.
 *   4. Preflight (OPTIONS + Access-Control-Request-Method) responde
 *      204 con los headers `Access-Control-Allow-*` negociados.
 *   5. Solo se aplica a rutas `/api/*`. Las rutas estáticas no
 *      necesitan CORS.
 *
 * [Hy3-audit 3c4aa66d-73fe-81fe-a5dd-f0325e5ff5e3 2026-08-27]:
 * before this middleware the server returned NO ACOO header for any
 * origin. Cross-origin requests from a non-whitelisted origin would
 * be blocked by the browser (fail-closed). Functional same-origin
 * worked. This middleware adds an explicit whitelist so future
 * subdomains / mobile shells / staging environments can be added
 * without code surgery.
 */

import type { Express, Request, Response, NextFunction } from 'express';

/**
 * Origins autorizados. Editar aquí cuando se agregue un subdominio
 * nuevo. Mantener en sync con `firebase.json` rewrites + `assetlinks.json`.
 *
 * - Producción: app.praeventio.net (frontend + API same-origin)
 * - Staging (futuro): staging.praeventio.net
 * - Local dev: localhost:57335 / 127.0.0.1:57335 (Vite dev server)
 * - Capacitor mobile shell (futuro): capacitor://localhost, http://localhost
 */
export const CORS_ALLOWED_ORIGINS: readonly string[] = [
  'https://app.praeventio.net',
  'https://praeventio.net',
  'https://www.praeventio.net',
  'https://staging.praeventio.net',
  // Mobile / desktop shells
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  // Dev servers
  'http://localhost:57335',
  'http://127.0.0.1:57335',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/**
 * Routes that opt-in to CORS. Static assets, .well-known/ assetlinks.json,
 * and security.txt do NOT need CORS — they're meant to be public.
 */
function isApiRoute(req: Request): boolean {
  return req.path.startsWith('/api/');
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return CORS_ALLOWED_ORIGINS.includes(origin);
}

function setCorsHeaders(_req: Request, res: Response, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', appendVary(res.getHeader('Vary'), 'Origin'));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, X-Idempotency-Key, X-Client-Version',
  );
  res.setHeader('Access-Control-Max-Age', '600'); // 10 min preflight cache
  // Expose non-simple headers (idempotency key, etc.) to browser JS
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Client-Version, X-Idempotency-Key, X-RateLimit-Remaining',
  );
}

function appendVary(existing: string | number | string[] | undefined, add: string): string {
  let list: string[];
  if (Array.isArray(existing)) {
    list = existing;
  } else if (typeof existing === 'string') {
    list = existing.split(',').map((s: string) => s.trim());
  } else {
    list = [];
  }
  if (!list.includes(add)) list.push(add);
  return list.join(', ');
}

/**
 * Apply CORS middleware to an Express app. Only `/api/*` routes
 * receive CORS headers; static asset paths are unaffected.
 */
export function applyCors(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isApiRoute(req)) {
      return next();
    }

    const origin = req.headers.origin;

    // Handle preflight explicitly so we can return 204 without dispatcher overhead
    if (req.method === 'OPTIONS') {
      if (isOriginAllowed(origin)) {
        setCorsHeaders(req, res, origin!);
        return res.status(204).end();
      }
      // Non-whitelisted origin: respond with CORS headers missing so browser blocks
      return res.status(204).end();
    }

    if (isOriginAllowed(origin)) {
      setCorsHeaders(req, res, origin!);
    }
    // If origin is not allowed: do NOT set ACOO; browser will block.
    next();
  });
}
