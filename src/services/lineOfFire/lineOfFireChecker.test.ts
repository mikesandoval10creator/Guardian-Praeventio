import { describe, it, expect } from 'vitest';
import {
  validateLineOfFire,
  summarizeLineOfFire,
  getRequiredMitigationsForKind,
  type LineOfFireExposure,
} from './lineOfFireChecker.js';

function exposure(over: Partial<LineOfFireExposure> = {}): LineOfFireExposure {
  return {
    kind: over.kind ?? 'suspended_load',
    description: over.description ?? 'izaje de viga 5t',
    proximityMeters: over.proximityMeters ?? 8,
    personnelInPath: over.personnelInPath ?? false,
  };
}

describe('getRequiredMitigationsForKind', () => {
  it('suspended_load incluye zona exclusión + tag-line + señalero', () => {
    const ms = getRequiredMitigationsForKind('suspended_load');
    expect(ms.length).toBeGreaterThanOrEqual(3);
    expect(ms.some((m) => /exclusión/i.test(m))).toBe(true);
  });

  it('electric_arc incluye distancia + EPP + desenergización', () => {
    const ms = getRequiredMitigationsForKind('electric_arc');
    expect(ms.some((m) => /distancia/i.test(m))).toBe(true);
    expect(ms.some((m) => /EPP|faceshield/i.test(m))).toBe(true);
  });
});

describe('validateLineOfFire', () => {
  it('todas las mitigaciones declaradas → passes', () => {
    const r = validateLineOfFire(exposure({ kind: 'suspended_load' }), [
      'zona de exclusión bajo carga delimitada',
      'tag-line para guiar la carga',
      'señalero entrenado en posición',
    ]);
    expect(r.passes).toBe(true);
    expect(r.missingMitigations).toEqual([]);
    expect(r.blockTask).toBe(false);
  });

  it('falta una mitigación pero sin personnelInPath → no bloquea', () => {
    const r = validateLineOfFire(exposure({ kind: 'suspended_load', personnelInPath: false }), [
      'zona de exclusión delimitada',
    ]);
    expect(r.passes).toBe(false);
    expect(r.blockTask).toBe(false); // sin personnelInPath
  });

  it('falta mitigación CON personnelInPath → bloquea', () => {
    const r = validateLineOfFire(exposure({ kind: 'suspended_load', personnelInPath: true }), []);
    expect(r.blockTask).toBe(true);
    expect(r.message).toMatch(/BLOQUEO/);
  });

  it('múltiples kinds: rotating_machinery exige guarda + LOTO + ropa', () => {
    const r = validateLineOfFire(exposure({ kind: 'rotating_machinery' }), ['guarda física instalada']);
    expect(r.missingMitigations.length).toBeGreaterThan(0);
  });

  it('matching de mitigaciones es por palabra clave (case-insensitive)', () => {
    const r = validateLineOfFire(exposure({ kind: 'falling_object' }), [
      'rodapié instalado',
      'herramientas con cuerdas',
      'casco con barbiquejo activo',
    ]);
    expect(r.passes).toBe(true);
  });
});

describe('summarizeLineOfFire', () => {
  it('cuenta byKind + blocking + passes', () => {
    const results = [
      validateLineOfFire(exposure({ kind: 'suspended_load', personnelInPath: true }), []),
      validateLineOfFire(exposure({ kind: 'electric_arc', personnelInPath: false }), [
        'distancia mínima',
        'EPP arc-rated',
        'desenergización',
      ]),
      validateLineOfFire(exposure({ kind: 'suspended_load' }), [
        'zona de exclusión',
        'tag-line',
        'señalero',
      ]),
    ];
    const s = summarizeLineOfFire(results);
    expect(s.totalExposures).toBe(3);
    expect(s.byKind.suspended_load).toBe(2);
    expect(s.byKind.electric_arc).toBe(1);
    expect(s.blockingCount).toBe(1);
    expect(s.passesCount).toBe(2);
  });
});
