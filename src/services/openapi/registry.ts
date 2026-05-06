// SPDX-License-Identifier: MIT
// Sprint 36 — Auto-OpenAPI registry.
//
// Central registry where each route module registers its OpenAPI metadata.
// The registry is **additive**: existing `validate(schema)` middleware in
// routes is untouched. Routes opt-in by calling `registerRoute(...)` at
// module load. The spec generator (specGenerator.ts) walks this registry
// to emit an OpenAPI 3.1 document.
//
// Why a side-channel registry instead of decorating the Express layer:
//   - Express has no introspectable schema layer.
//   - Existing routes use a mix of `validate(zodSchema)` and hand-rolled
//     `safeParse`. Registering metadata explicitly avoids guessing.
//   - Keeps zod-to-openapi conversion off the hot path; only invoked
//     when the openapi router serves the spec.
//
// Audit traceability: closes audit hallazgo §1.3 (Auto-OpenAPI from Zod).

import type { z } from 'zod';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RegisteredParam {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  description?: string;
  schema?: z.ZodTypeAny;
  /** Override schema with a raw JSON-Schema fragment when Zod is overkill. */
  rawSchema?: Record<string, unknown>;
}

export interface RegisteredRoute {
  /** Full path including parent mount, e.g. '/api/b2d/v1/climate/current'. */
  path: string;
  method: HttpMethod;
  /** Short title shown in Swagger UI. */
  summary: string;
  /** Long description. Markdown supported by Swagger UI. */
  description?: string;
  /** Logical grouping for Swagger UI sidebar. */
  tags?: string[];
  /** Request body Zod schema (if any). */
  requestBody?: { schema: z.ZodTypeAny; description?: string; contentType?: string };
  /** Path / query / header parameters. */
  parameters?: RegisteredParam[];
  /** Response definitions keyed by status code. */
  responses?: Record<string, { description: string; schema?: z.ZodTypeAny; rawSchema?: Record<string, unknown> }>;
  /** Security scheme name(s) required, or [] for public. */
  security?: ('bearerAuth' | 'b2dApiKey')[];
  /** Documentation that this route exposes B2D scopes. */
  b2dScopes?: string[];
  /** Mark internal-only routes that should NOT appear in public spec. */
  internalOnly?: boolean;
}

export interface RegisteredComponent {
  name: string;
  schema: z.ZodTypeAny;
}

const routes: RegisteredRoute[] = [];
const components = new Map<string, RegisteredComponent>();

export function registerRoute(route: RegisteredRoute): void {
  routes.push(route);
}

export function registerComponent(name: string, schema: z.ZodTypeAny): void {
  if (!components.has(name)) {
    components.set(name, { name, schema });
  }
}

export function getRegisteredRoutes(): readonly RegisteredRoute[] {
  return routes;
}

export function getRegisteredComponents(): readonly RegisteredComponent[] {
  return Array.from(components.values());
}

/**
 * Test-only: clear all registrations. Real production code must never
 * call this. Exposed so the spec generator unit tests can build a clean
 * registry per test.
 */
export function __resetRegistryForTests(): void {
  routes.length = 0;
  components.clear();
}
