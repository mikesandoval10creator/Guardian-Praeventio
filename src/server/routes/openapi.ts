// SPDX-License-Identifier: MIT
// Sprint 36 — Public OpenAPI endpoint.
//
//   GET /api/openapi.json  → JSON OpenAPI 3.1 doc (auto-generated from Zod).
//   GET /api/openapi.html  → Swagger UI page pointing to /api/openapi.json.
//
// Both endpoints are PUBLIC (no auth) because integrators (Postman,
// Stoplight, internal partner scripts) need to fetch the spec to build
// clients. No tenant data is leaked: the spec only describes endpoint
// shapes, not row content.

import { Router, type Request, type Response } from 'express';

import { generateOpenApiSpec } from '../../services/openapi/specGenerator.js';
import { bootstrapOpenApiRegistry } from '../../services/openapi/bootstrap.js';

bootstrapOpenApiRegistry();

const openapiRouter = Router();

openapiRouter.get('/openapi.json', (_req: Request, res: Response) => {
  const spec = generateOpenApiSpec();
  res.set('Content-Type', 'application/json');
  res.set('Cache-Control', 'public, max-age=3600');
  return res.status(200).json(spec);
});

openapiRouter.get('/openapi.html', (_req: Request, res: Response) => {
  // Swagger UI loaded from a pinned CDN. Pinning the version (not @latest)
  // makes the doc deterministic and protects integrators from surprise
  // upstream UI breakage.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Praeventio Guard — API explorer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>body{margin:0;}#swagger-ui{max-width:1200px;margin:0 auto;}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        layout: 'BaseLayout',
      });
    };
  </script>
</body>
</html>`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  return res.status(200).send(html);
});

export default openapiRouter;
