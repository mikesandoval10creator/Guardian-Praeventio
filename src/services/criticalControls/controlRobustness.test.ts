import { describe, it, expect } from 'vitest';
import {
  controlRobustnessScore,
  findControlSuperiorTo,
  buildBarrierAnalysis,
  detectSingleBarrierRisks,
  computeVerificationStatus,
  controlsByEnergy,
  getEnergyTypeForControl,
} from './controlRobustness.js';
import { CRITICAL_CONTROLS_LIBRARY } from './criticalControlsLibrary.js';
import type { ControlValidation } from './criticalControlsLibrary.js';

function validation(controlId: string, present: boolean): ControlValidation {
  return {
    controlId,
    present,
    validatedByUid: 'sup1',
    validatedAt: '2026-05-11T10:00:00Z',
  };
}

describe('controlRobustnessScore', () => {
  it('elimination > engineering > epp', () => {
    expect(controlRobustnessScore({ level: 'elimination' })).toBe(100);
    expect(controlRobustnessScore({ level: 'engineering' })).toBe(60);
    expect(controlRobustnessScore({ level: 'epp' })).toBe(10);
  });
});

describe('findControlSuperiorTo', () => {
  it('desde epp sugiere subir toda la jerarquía', () => {
    expect(findControlSuperiorTo('epp')).toEqual([
      'elimination',
      'substitution',
      'engineering',
      'administrative',
    ]);
  });

  it('desde elimination no hay nada superior', () => {
    expect(findControlSuperiorTo('elimination')).toEqual([]);
  });

  it('desde engineering solo elimination + substitution', () => {
    expect(findControlSuperiorTo('engineering')).toEqual(['elimination', 'substitution']);
  });
});

describe('buildBarrierAnalysis', () => {
  it('cuenta solo controles present=true', () => {
    const r = buildBarrierAnalysis('altura', CRITICAL_CONTROLS_LIBRARY, [
      validation('alt-eng-baranda', true),
      validation('alt-epp-arnes', true),
      validation('alt-adm-permit', false),
    ]);
    expect(r.barrierCount).toBe(2);
    expect(r.layersByLevel.engineering).toBe(1);
    expect(r.layersByLevel.epp).toBe(1);
    expect(r.isSingleBarrier).toBe(false);
  });

  it('detecta barrera única', () => {
    const r = buildBarrierAnalysis('altura', CRITICAL_CONTROLS_LIBRARY, [
      validation('alt-epp-arnes', true),
    ]);
    expect(r.isSingleBarrier).toBe(true);
    expect(r.liveBarrierLabels[0]).toContain('Arnés');
  });

  it('0 barreras vivas si todo es present=false', () => {
    const r = buildBarrierAnalysis('altura', CRITICAL_CONTROLS_LIBRARY, [
      validation('alt-eng-baranda', false),
    ]);
    expect(r.barrierCount).toBe(0);
    expect(r.isSingleBarrier).toBe(false);
  });
});

describe('detectSingleBarrierRisks', () => {
  it('filtra solo categorías con 1 barrera', () => {
    const result = detectSingleBarrierRisks(
      ['altura', 'electric', 'confinado'],
      CRITICAL_CONTROLS_LIBRARY,
      [
        validation('alt-epp-arnes', true), // altura → 1
        validation('elec-elim-corte', true),
        validation('elec-eng-loto', true), // electric → 2
        // confinado → 0
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0].riskCategory).toBe('altura');
  });
});

describe('computeVerificationStatus', () => {
  it('sin verificación previa → needsEscalation=true', () => {
    const s = computeVerificationStatus('c1', 'weekly', undefined, '2026-05-11T10:00:00Z');
    expect(s.daysSinceLastVerification).toBe(Infinity);
    expect(s.needsEscalation).toBe(true);
  });

  it('verificación reciente dentro del SLA → isInWindow=true', () => {
    const s = computeVerificationStatus(
      'c1',
      'weekly',
      '2026-05-10T10:00:00Z',
      '2026-05-11T10:00:00Z',
    );
    expect(s.daysSinceLastVerification).toBe(1);
    expect(s.isInWindow).toBe(true);
    expect(s.needsEscalation).toBe(false);
  });

  it('verificación >1.5x el SLA → needsEscalation=true', () => {
    // weekly SLA = 7d, 1.5x = 10.5d, 11d > umbral
    const s = computeVerificationStatus(
      'c1',
      'weekly',
      '2026-04-30T10:00:00Z',
      '2026-05-11T10:00:00Z',
    );
    expect(s.daysSinceLastVerification).toBe(11);
    expect(s.isInWindow).toBe(false);
    expect(s.needsEscalation).toBe(true);
  });
});

describe('controlsByEnergy', () => {
  it('agrupa correctamente altura → gravity, electric → electric', () => {
    const grouped = controlsByEnergy(CRITICAL_CONTROLS_LIBRARY);
    expect(grouped.gravity.length).toBeGreaterThan(0);
    expect(grouped.electric.length).toBeGreaterThan(0);
    expect(grouped.chemical.length).toBeGreaterThan(0);
    expect(grouped.thermal.length).toBeGreaterThan(0);
    // Confirmamos que un control específico está en el bucket correcto
    expect(grouped.gravity.some((c) => c.id === 'alt-epp-arnes')).toBe(true);
    expect(grouped.electric.some((c) => c.id === 'elec-eng-loto')).toBe(true);
  });
});

describe('getEnergyTypeForControl', () => {
  it('devuelve la energía correcta', () => {
    expect(getEnergyTypeForControl('alt-epp-arnes')).toBe('gravity');
    expect(getEnergyTypeForControl('cal-eng-extintor')).toBe('thermal');
    expect(getEnergyTypeForControl('control-no-existe')).toBeUndefined();
  });
});
