// Praeventio Guard — F.30 Aggregate Telemetry router contract tests.

import { describe, it, expect } from 'vitest';
import aggregateTelemetryRouter from './aggregateTelemetry';

describe('aggregateTelemetryRouter (F.30 wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(aggregateTelemetryRouter).toBeDefined();
    expect(typeof aggregateTelemetryRouter).toBe('function');
  });

  it('registers GET /:projectId/telemetry/aggregate', () => {
    const layers = (aggregateTelemetryRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/:projectId/telemetry/aggregate' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /tenants/:tenantId/telemetry/rollup', () => {
    const layers = (aggregateTelemetryRouter as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const layer = layers.find(
      (l) =>
        l.route?.path === '/tenants/:tenantId/telemetry/rollup' &&
        l.route?.methods.get === true,
    );
    expect(layer).toBeDefined();
  });
});
