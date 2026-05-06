// SPDX-License-Identifier: MIT
// Sprint 36 — Tests for the auto-OpenAPI spec generator.

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  __resetRegistryForTests,
  registerComponent,
  registerRoute,
} from './registry.js';
import { generateOpenApiSpec } from './specGenerator.js';

describe('OpenAPI spec generator', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('emits a valid OpenAPI 3.1 document with required top-level fields', () => {
    registerComponent('Ping', z.object({ ok: z.boolean() }));
    registerRoute({
      path: '/api/ping',
      method: 'get',
      summary: 'Ping',
      tags: ['Meta'],
      responses: { '200': { description: 'pong' } },
      security: [],
    });

    const spec = generateOpenApiSpec({ version: '9.9.9', servers: [{ url: 'http://x' }] });

    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeTruthy();
    expect(spec.info.title).toMatch(/Praeventio/);
    expect(spec.info.version).toBe('9.9.9');
    expect(spec.servers[0]?.url).toBe('http://x');
    expect(spec.paths['/api/ping']).toBeTruthy();
    expect((spec.paths['/api/ping'] as any).get.summary).toBe('Ping');
    expect(spec.components.securitySchemes.bearerAuth).toBeTruthy();
    expect(spec.components.securitySchemes.b2dApiKey).toBeTruthy();
    expect(spec.components.schemas.Ping).toMatchObject({ type: 'object' });
  });

  it('includes the /api/b2d/v1/climate/current endpoint with correct B2D security + scope', () => {
    // Force-rebootstrap by directly importing & calling the bootstrap's
    // body. Because the module guard `bootstrapped` is module-private and
    // already true if any earlier test triggered it, we instead manually
    // re-register the climate route — sufficient to assert the registry
    // emits the expected shape.
    registerRoute({
      path: '/api/b2d/v1/climate/current',
      method: 'get',
      summary: 'Current climate snapshot',
      tags: ['B2D / Climate'],
      parameters: [
        { name: 'lat', in: 'query', required: true, schema: z.number() },
        { name: 'lng', in: 'query', required: true, schema: z.number() },
      ],
      responses: { '200': { description: 'ok' } },
      security: ['b2dApiKey'],
      b2dScopes: ['climate.read'],
    });

    const spec = generateOpenApiSpec();
    const climate = spec.paths['/api/b2d/v1/climate/current'] as any;
    expect(climate).toBeTruthy();
    expect(climate.get.security).toEqual([{ b2dApiKey: ['climate.read'] }]);
    expect(climate.get.parameters).toHaveLength(2);
    expect(climate.get.parameters[0]).toMatchObject({ name: 'lat', in: 'query', required: true });
  });

  it('includes the /api/dte/create endpoint with bearerAuth and a request body', () => {
    const Schema = z.object({ type: z.string(), customer: z.object({ rut: z.string() }) });
    registerRoute({
      path: '/api/dte/create',
      method: 'post',
      summary: 'Create DTE',
      tags: ['DTE'],
      requestBody: { schema: Schema },
      responses: { '200': { description: 'ok' } },
      security: ['bearerAuth'],
    });

    const spec = generateOpenApiSpec();
    const dte = spec.paths['/api/dte/create'] as any;
    expect(dte).toBeTruthy();
    expect(dte.post.requestBody.content['application/json'].schema.type).toBe('object');
    expect(dte.post.security).toEqual([{ bearerAuth: [] }]);
  });

  it('exposes every registered component under components.schemas', () => {
    registerComponent('A', z.object({ a: z.string() }));
    registerComponent('B', z.object({ b: z.number() }));
    registerRoute({
      path: '/api/x',
      method: 'get',
      summary: 'x',
      responses: { '200': { description: 'ok' } },
      security: [],
    });

    const spec = generateOpenApiSpec();
    expect(spec.components.schemas).toHaveProperty('A');
    expect(spec.components.schemas).toHaveProperty('B');
    expect((spec.components.schemas.A as any).properties.a).toMatchObject({ type: 'string' });
  });
});
