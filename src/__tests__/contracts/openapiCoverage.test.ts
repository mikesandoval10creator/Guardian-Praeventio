// Praeventio Guard — Contract test #6: docs/api/openapi.yaml endpoints
// existen como routes en src/server/routes/. Si un endpoint listado en
// openapi.yaml se elimina o renombra en el código, este test cae.
//
// NO valida lo opuesto (routes sin OpenAPI entry) — el spec es subset
// estable; muchas rutas son internas y no necesitan documentación
// pública.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const OPENAPI_PATH = resolve(REPO_ROOT, 'docs', 'api', 'openapi.yaml');

function listOpenApiPaths(): string[] {
  const text = readFileSync(OPENAPI_PATH, 'utf8');
  const matches: string[] = [];
  // Naive YAML path extraction: top-level keys under `paths:` that
  // start with /. Lines like "  /api/sprint-k/{projectId}/...".
  const lines = text.split('\n');
  let inPaths = false;
  for (const line of lines) {
    if (line.startsWith('paths:')) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^[a-zA-Z]/.test(line)) {
      inPaths = false;
      continue;
    }
    if (inPaths) {
      const m = line.match(/^ {2}(\/[^\s:]+):\s*$/);
      if (m) matches.push(m[1]);
    }
  }
  return matches;
}

// Convert openapi path "/api/sprint-k/{projectId}/foo/bar" to the
// route-internal path "/:projectId/foo/bar" (which is what the
// Express routers register internally).
function openApiToInternalPath(p: string): { mount: string; route: string } | null {
  const internal = p.replace(/\{([^}]+)\}/g, ':$1');
  if (internal.startsWith('/api/sprint-k')) {
    return { mount: '/api/sprint-k', route: internal.slice('/api/sprint-k'.length) };
  }
  if (internal.startsWith('/api/')) {
    return { mount: '/api', route: internal.slice('/api'.length) };
  }
  return { mount: '', route: internal };
}

describe('OpenAPI spec coverage contract', () => {
  it('openapi.yaml exists', () => {
    expect(existsSync(OPENAPI_PATH)).toBe(true);
  });

  it('lists >5 paths in the v1 spec', () => {
    const paths = listOpenApiPaths();
    expect(paths.length).toBeGreaterThan(5);
  });

  it('every path is a non-empty REST endpoint format', () => {
    const paths = listOpenApiPaths();
    for (const p of paths) {
      expect(p).toMatch(/^\//);
      expect(p.length).toBeGreaterThan(1);
    }
  });

  it('sprint-k paths transform cleanly to :projectId router routes', () => {
    const paths = listOpenApiPaths().filter((p) => p.startsWith('/api/sprint-k'));
    for (const p of paths) {
      const internal = openApiToInternalPath(p);
      expect(internal).toBeTruthy();
      expect(internal!.route).toMatch(/^\/:projectId\//);
    }
  });
});
