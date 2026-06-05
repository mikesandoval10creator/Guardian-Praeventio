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

describe('validateLineOfFire — exact full-phrase matching (safety gate)', () => {
  it('declarar las frases canónicas COMPLETAS → passes', () => {
    const r = validateLineOfFire(
      exposure({ kind: 'suspended_load' }),
      getRequiredMitigationsForKind('suspended_load'),
    );
    expect(r.passes).toBe(true);
    expect(r.missingMitigations).toEqual([]);
    expect(r.blockTask).toBe(false);
  });

  it('matching es case- y acento-insensible pero de FRASE COMPLETA', () => {
    const r = validateLineOfFire(exposure({ kind: 'suspended_load' }), [
      '  ZONA  DE EXCLUSION BAJO CARGA ', // mayúsculas, sin acento, espacios
      'Tag-Line Para Guiar Carga',
      'SEÑALERO ENTRENADO',
    ]);
    expect(r.passes).toBe(true);
    expect(r.missingMitigations).toEqual([]);
  });

  it('declarar 1 de 3 frases exactas (sin personnelInPath) → no pasa, no bloquea', () => {
    const r = validateLineOfFire(
      exposure({ kind: 'suspended_load', personnelInPath: false }),
      ['zona de exclusión bajo carga'],
    );
    expect(r.passes).toBe(false);
    expect(r.missingMitigations).toHaveLength(2);
    expect(r.blockTask).toBe(false); // sin personnelInPath
  });

  it('falta mitigación CON personnelInPath → bloquea', () => {
    const r = validateLineOfFire(exposure({ kind: 'suspended_load', personnelInPath: true }), []);
    expect(r.blockTask).toBe(true);
    expect(r.message).toMatch(/BLOQUEO/);
  });

  // ── Regresión del bug "match por primera palabra" (B2, Fase 5) ──────────
  it('NO limpia un control con una declaración que sólo comparte la primera palabra', () => {
    // El bug previo: "guardarropa" satisfacía "guarda física en partes móviles"
    // porque el match era `dm.includes(em.split(" ")[0])` (primera palabra).
    const r = validateLineOfFire(exposure({ kind: 'rotating_machinery' }), [
      'guardarropa del personal',
      'loto company swag', // comparte 'loto' como token suelto
    ]);
    expect(r.passes).toBe(false);
    expect(r.missingMitigations).toContain('guarda física en partes móviles');
    expect(r.missingMitigations).toContain('LOTO si intervención');
  });

  it('NO limpia con una frase PARCIAL (subconjunto incompleto del control)', () => {
    // "rodapié instalado" NO cubre "rodapié + malla en niveles superiores":
    // declarar sólo el rodapié deja la malla/red sin verificar → debe faltar.
    const r = validateLineOfFire(exposure({ kind: 'falling_object' }), [
      'rodapié instalado',
      'herramientas con cuerdas',
      'casco con barbiquejo activo',
    ]);
    expect(r.passes).toBe(false);
    expect(r.missingMitigations).toContain('rodapié + malla en niveles superiores');
  });
});

describe('summarizeLineOfFire', () => {
  it('cuenta byKind + blocking + passes', () => {
    const results = [
      validateLineOfFire(exposure({ kind: 'suspended_load', personnelInPath: true }), []),
      validateLineOfFire(
        exposure({ kind: 'electric_arc', personnelInPath: false }),
        getRequiredMitigationsForKind('electric_arc'),
      ),
      validateLineOfFire(
        exposure({ kind: 'suspended_load' }),
        getRequiredMitigationsForKind('suspended_load'),
      ),
    ];
    const s = summarizeLineOfFire(results);
    expect(s.totalExposures).toBe(3);
    expect(s.byKind.suspended_load).toBe(2);
    expect(s.byKind.electric_arc).toBe(1);
    expect(s.blockingCount).toBe(1);
    expect(s.passesCount).toBe(2);
  });
});
