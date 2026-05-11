import { describe, it, expect } from 'vitest';
import {
  deriveStatus,
  computeProgress,
  buildStandardOnboardingTemplate,
  buildActionFromObservation,
  type OnboardingBundle,
  type OnboardingRequirement,
} from './faenaOnboardingBundle.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function bundle(over: Partial<OnboardingBundle> = {}): OnboardingBundle {
  return {
    id: 'ob-1',
    workerUid: 'w1',
    workerFullName: 'Juan Pérez',
    projectId: 'p1',
    requirements: buildStandardOnboardingTemplate(),
    status: 'pending',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

describe('buildStandardOnboardingTemplate', () => {
  it('genera 8 requirements canónicos', () => {
    const tpl = buildStandardOnboardingTemplate();
    expect(tpl).toHaveLength(8);
    const cats = new Set(tpl.map((r) => r.category));
    expect(cats.has('contract')).toBe(true);
    expect(cats.has('medical_exam')).toBe(true);
    expect(cats.has('induction')).toBe(true);
    expect(cats.has('epp')).toBe(true);
    expect(cats.has('training')).toBe(true);
    expect(cats.has('document_read')).toBe(true);
  });

  it('inicialmente todos fulfilled=false', () => {
    expect(buildStandardOnboardingTemplate().every((r) => !r.fulfilled)).toBe(true);
  });
});

describe('deriveStatus', () => {
  it('pending si nada fulfilled', () => {
    expect(deriveStatus(bundle())).toBe('pending');
  });

  it('partial si algunos fulfilled', () => {
    const b = bundle();
    b.requirements[0].fulfilled = true;
    b.requirements[1].fulfilled = true;
    expect(deriveStatus(b)).toBe('partial');
  });

  it('ready_for_review cuando todos fulfilled sin reviewer', () => {
    const b = bundle();
    b.requirements.forEach((r) => (r.fulfilled = true));
    expect(deriveStatus(b)).toBe('ready_for_review');
  });

  it('observed si algún requirement tiene observación', () => {
    const b = bundle();
    b.requirements.forEach((r) => (r.fulfilled = true));
    b.requirements[2].observation = 'Falta fecha de vigencia en el certificado';
    expect(deriveStatus(b)).toBe('observed');
  });

  it('approved cuando reviewer aprueba', () => {
    const b = bundle();
    b.requirements.forEach((r) => (r.fulfilled = true));
    expect(
      deriveStatus({
        ...b,
        reviewedAt: NOW.toISOString(),
        reviewerDecision: 'approved',
      }),
    ).toBe('approved');
  });

  it('rejected cuando reviewer rechaza', () => {
    const b = bundle();
    expect(
      deriveStatus({
        ...b,
        reviewedAt: NOW.toISOString(),
        reviewerDecision: 'rejected',
      }),
    ).toBe('rejected');
  });
});

describe('computeProgress', () => {
  it('% completion + next requirement', () => {
    const b = bundle();
    b.requirements[0].fulfilled = true;
    b.requirements[1].fulfilled = true;
    const p = computeProgress(b);
    expect(p.fulfilledCount).toBe(2);
    expect(p.completionPercent).toBe(25); // 2/8
    expect(p.nextRequirement?.category).toBe('induction'); // index 2
  });

  it('100% cuando todo fulfilled', () => {
    const b = bundle();
    b.requirements.forEach((r) => (r.fulfilled = true));
    const p = computeProgress(b);
    expect(p.completionPercent).toBe(100);
    expect(p.nextRequirement).toBeUndefined();
  });

  it('lista observed items', () => {
    const b = bundle();
    b.requirements[0].observation = 'falta hoja firmada';
    b.requirements[4].observation = 'EPP entregado pero parcial';
    const p = computeProgress(b);
    expect(p.observedItems).toHaveLength(2);
    expect(p.observedCount).toBe(2);
  });
});

describe('buildActionFromObservation', () => {
  it('genera payload de acción correctiva por observación', () => {
    const b = bundle();
    const req: OnboardingRequirement = {
      category: 'medical_exam',
      label: 'Examen ocupacional pre-ingreso',
      fulfilled: false,
      observation: 'Examen vencido hace 2 meses',
    };
    const payload = buildActionFromObservation(b, req, NOW);
    expect(payload.type).toBe('onboarding_observation');
    expect(payload.bundleId).toBe('ob-1');
    expect(payload.workerUid).toBe('w1');
    expect(payload.requirementCategory).toBe('medical_exam');
    expect(payload.observation).toContain('vencido');
  });

  it('rechaza requirement sin observación', () => {
    const req: OnboardingRequirement = {
      category: 'contract',
      label: 'Contrato',
      fulfilled: false,
    };
    expect(() => buildActionFromObservation(bundle(), req, NOW)).toThrow();
  });
});
