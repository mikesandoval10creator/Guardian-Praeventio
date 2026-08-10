// Contract test — Ticket 3a4aa66d-73fe-81a7-9759-d8c5d965a86e [P2][observabilidad].
//
// Verify cmd de Notion:
//   "existe docs/observability/SLO.md con los 4 SLOs + error budget explícito;
//    al menos una alerta P0 usa multi-burn-rate (1h+6h) en sentry-alerts.yaml"
//
// El SLO.md es el contrato de confiabilidad de Guardian: sin doc formal,
// no hay base para medir error budget ni congelar deploys.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('SLO formal doc + multi-burn-rate alert (P2 observabilidad)', () => {
  it('docs/observability/SLO.md existe', () => {
    const slo = read('docs/observability/SLO.md');
    expect(slo.length).toBeGreaterThan(500);
  });

  it('SLO.md define los 4 SLOs con valores explícitos', () => {
    const slo = read('docs/observability/SLO.md');
    // SLO 1 — SOS delivery 99.95% mensual
    expect(slo).toMatch(/99\.95%/);
    expect(slo).toMatch(/SOS/i);
    // SLO 2 — crash-free path-SOS 99.99% (four nines)
    expect(slo).toMatch(/99\.99%/);
    // SLO 3 — crash-free general >= 99.9% (target interno <= 0.5%)
    expect(slo).toMatch(/99\.9%/);
    expect(slo).toMatch(/0\.5%/);
    // SLO 4 — latencia p95 check-in <= 2s en 3G
    expect(slo).toMatch(/2\s*s|2000\s*ms/i);
    expect(slo).toMatch(/p95/i);
  });

  it('SLO.md tiene error budget mensual explícito', () => {
    const slo = read('docs/observability/SLO.md');
    expect(slo).toMatch(/error budget|error_budget/i);
    expect(slo).toMatch(/21\.6|4\.32|minutos|budget/i);
  });

  it('SLO.md documenta política de congelar deploys al 50% en 7 días', () => {
    const slo = read('docs/observability/SLO.md');
    expect(slo).toMatch(/50%/);
    expect(slo).toMatch(/7\s*d[ií]as|7\s*days/i);
    expect(slo).toMatch(/congelar|freeze|deploy/i);
  });

  it('sentry-alerts.yaml tiene al menos una alerta P0 con multi-burn-rate (1h+6h)', () => {
    const yaml = read('docs/observability/sentry-alerts.yaml');
    // Multi-window burn-rate: la alerta P0 SLO debe declarar ventanas 1h y 6h.
    expect(yaml).toMatch(/P0-sos-delivery-burn/i);
    expect(yaml).toMatch(/burn.?rate/i);
    expect(yaml).toMatch(/1h/i);
    expect(yaml).toMatch(/6h/i);
  });
});
