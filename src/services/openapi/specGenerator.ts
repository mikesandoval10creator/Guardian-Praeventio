// SPDX-License-Identifier: MIT
// Sprint 36 — OpenAPI 3.1 spec generator.
//
// Walks the registry (registry.ts) and emits a valid OpenAPI 3.1 document.
// Uses Zod 4's built-in `z.toJSONSchema()` so we don't add a third-party
// dependency that lags Zod releases. The repo is on Zod ^4.3.6 and the
// candidate library `@asteasolutions/zod-to-openapi` only supports Zod 3,
// so we converged on the in-house path per the audit's pivot clause.
//
// Output is OpenAPI 3.1.0 — the version that adopts JSON Schema
// 2020-12 (which is exactly what Zod 4 emits). This means we can copy
// the JSON Schema produced by Zod into `components.schemas` without
// needing a Swagger 2 down-conversion.
//
// The spec is **public** (mounted via /api/openapi.json without auth)
// because B2D integrators (Postman, Stoplight, etc.) need it to bootstrap.
// Internal-only routes (admin, scheduler) are filtered via `internalOnly`.

import { z } from 'zod';

import {
  getRegisteredRoutes,
  getRegisteredComponents,
  type HttpMethod,
  type RegisteredRoute,
  type RegisteredParam,
} from './registry.js';

export interface OpenApiSpec {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
    contact?: { name: string; url?: string; email?: string };
    license?: { name: string; url?: string };
  };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

interface GenerateOpts {
  /** Override package.json version (mainly for tests). */
  version?: string;
  /** Override server list. */
  servers?: Array<{ url: string; description?: string }>;
  /** If true, include routes flagged `internalOnly`. Default false. */
  includeInternal?: boolean;
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // z.toJSONSchema returns a `$schema`-tagged object. Strip the meta key
  // so it can be embedded in OpenAPI components without polluting the
  // doc with redundant `$schema` fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (z as any).toJSONSchema(schema) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...rest } = raw;
  return rest;
}

function paramToOpenApi(p: RegisteredParam): Record<string, unknown> {
  const schema = p.rawSchema ?? (p.schema ? zodToJsonSchema(p.schema) : { type: 'string' });
  return {
    name: p.name,
    in: p.in,
    required: p.required ?? p.in === 'path',
    description: p.description,
    schema,
  };
}

function buildPathItem(route: RegisteredRoute): Record<string, unknown> {
  const op: Record<string, unknown> = {
    summary: route.summary,
    description: route.description,
    tags: route.tags ?? [],
  };

  if (route.parameters && route.parameters.length > 0) {
    op.parameters = route.parameters.map(paramToOpenApi);
  }

  if (route.requestBody) {
    const ct = route.requestBody.contentType ?? 'application/json';
    op.requestBody = {
      description: route.requestBody.description,
      required: true,
      content: {
        [ct]: { schema: zodToJsonSchema(route.requestBody.schema) },
      },
    };
  }

  if (route.responses) {
    const responses: Record<string, unknown> = {};
    for (const [code, def] of Object.entries(route.responses)) {
      const schema = def.rawSchema ?? (def.schema ? zodToJsonSchema(def.schema) : undefined);
      responses[code] = schema
        ? {
            description: def.description,
            content: { 'application/json': { schema } },
          }
        : { description: def.description };
    }
    op.responses = responses;
  } else {
    op.responses = { '200': { description: 'OK' } };
  }

  if (route.security && route.security.length > 0) {
    op.security = route.security.map((s) => ({ [s]: route.b2dScopes ?? [] }));
  } else {
    op.security = [];
  }

  return op;
}

/**
 * Convert path placeholders from Express style (`:id`) to OpenAPI style
 * (`{id}`). Both syntaxes are accepted in `registerRoute` but the spec
 * must use OpenAPI's brace notation.
 */
function normalizePath(p: string): string {
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

export function generateOpenApiSpec(opts: GenerateOpts = {}): OpenApiSpec {
  const includeInternal = opts.includeInternal ?? false;
  const allRoutes = getRegisteredRoutes().filter(
    (r) => includeInternal || !r.internalOnly,
  );

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of allRoutes) {
    const path = normalizePath(route.path);
    if (!paths[path]) paths[path] = {};
    (paths[path] as Record<HttpMethod, unknown>)[route.method] = buildPathItem(route);
  }

  const schemas: Record<string, unknown> = {};
  for (const c of getRegisteredComponents()) {
    schemas[c.name] = zodToJsonSchema(c.schema);
  }

  // Collect tags from all routes for the top-level tags array (gives
  // Swagger UI a sidebar grouping order).
  const tagSet = new Map<string, string | undefined>();
  for (const r of allRoutes) {
    for (const t of r.tags ?? []) {
      if (!tagSet.has(t)) tagSet.set(t, undefined);
    }
  }
  const tags = Array.from(tagSet.entries()).map(([name, description]) => ({
    name,
    description,
  }));

  const version = opts.version ?? readPackageVersion();

  const servers =
    opts.servers ??
    (() => {
      const base = process.env.PUBLIC_API_BASE_URL || 'https://api.praeventio.guard';
      return [
        { url: base, description: 'Production' },
        { url: 'http://localhost:5173', description: 'Local dev' },
      ];
    })();

  return {
    openapi: '3.1.0',
    info: {
      title: 'Praeventio Guard B2D API',
      version,
      description:
        'Public B2D API surface (Climate / Hazmat / Normativa / Suite). ' +
        'Authentication: `Authorization: Bearer pk_*` for B2D endpoints, ' +
        '`Authorization: Bearer <Firebase ID token>` for in-app endpoints. ' +
        'See PRICING.md for tiers and quotas. The Zettelkasten is NEVER exposed.',
      contact: {
        name: 'Praeventio Guard',
        url: 'https://praeventio.guard',
        email: 'soporte@praeventio.guard',
      },
      license: { name: 'Proprietary — see EULA' },
    },
    servers,
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Firebase ID token (in-app endpoints).',
        },
        b2dApiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'pk_*',
          description: 'B2D API key (`pk_live_*` / `pk_test_*`).',
        },
      },
    },
    tags: tags.length > 0 ? tags : undefined,
  };
}

function readPackageVersion(): string {
  try {
    // Lazy + best-effort. If anything fails we fall back to the package
    // version we know at code-write time (1.0.0 in package.json).
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return process.env.npm_package_version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}
