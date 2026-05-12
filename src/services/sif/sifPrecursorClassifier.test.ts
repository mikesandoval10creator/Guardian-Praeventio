import { describe, it, expect } from 'vitest';
import {
  classifyAsSIF,
  summarizeSIFPrecursors,
  type NearMissContext,
} from './sifPrecursorClassifier.js';

const baseCtx: NearMissContext = {
  description: 'evento',
  categoryTags: [],
  involvedMobileEquipment: false,
  inRestrictedZone: false,
  exposedWorkerCount: 0,
};

describe('classifyAsSIF', () => {
  it('caída evitada 2m → serious (no fatal)', () => {
    const r = classifyAsSIF({ ...baseCtx, categoryTags: ['altura'], fallHeightMeters: 2 });
    expect(r?.kind).toBe('altura_sin_lesion');
    expect(r?.potential).toBe('serious');
    expect(r?.executiveReviewRequired).toBe(true);
    expect(r?.mandanteNotificationRequired).toBe(false);
  });

  it('caída evitada 6m → fatal + mandante notification', () => {
    const r = classifyAsSIF({ ...baseCtx, categoryTags: ['altura'], fallHeightMeters: 6 });
    expect(r?.potential).toBe('fatal');
    expect(r?.mandanteNotificationRequired).toBe(true);
  });

  it('caída < 1.8m → NO es SIF', () => {
    const r = classifyAsSIF({ ...baseCtx, categoryTags: ['altura'], fallHeightMeters: 1.5 });
    expect(r).toBeNull();
  });

  it('energía eléctrica 220V → energia_liberada serious', () => {
    const r = classifyAsSIF({
      ...baseCtx,
      energyMagnitude: { kind: 'voltage', value: 220, unit: 'V' },
    });
    expect(r?.kind).toBe('energia_liberada');
    expect(r?.potential).toBe('serious');
  });

  it('energía eléctrica 1500V → fatal', () => {
    const r = classifyAsSIF({
      ...baseCtx,
      energyMagnitude: { kind: 'voltage', value: 1500, unit: 'V' },
    });
    expect(r?.potential).toBe('fatal');
  });

  it('voltaje <= 50V → NO es SIF', () => {
    const r = classifyAsSIF({
      ...baseCtx,
      energyMagnitude: { kind: 'voltage', value: 24, unit: 'V' },
    });
    expect(r).toBeNull();
  });

  it('presión > 7 bar → energia_liberada', () => {
    const r = classifyAsSIF({
      ...baseCtx,
      energyMagnitude: { kind: 'pressure', value: 12, unit: 'bar' },
    });
    expect(r?.kind).toBe('energia_liberada');
  });

  it('casi golpe móvil con 3 expuestos → casi_golpe_movil fatal', () => {
    const r = classifyAsSIF({ ...baseCtx, involvedMobileEquipment: true, exposedWorkerCount: 3 });
    expect(r?.kind).toBe('casi_golpe_movil');
    expect(r?.potential).toBe('fatal');
    expect(r?.mandanteNotificationRequired).toBe(true);
  });

  it('derrame químico 250L → fatal', () => {
    const r = classifyAsSIF({
      ...baseCtx,
      categoryTags: ['quimico'],
      spillVolumeLiters: 250,
    });
    expect(r?.kind).toBe('perdida_contencion_quimica');
    expect(r?.potential).toBe('fatal');
  });

  it('derrame químico 10L → moderate (sin executive review)', () => {
    const r = classifyAsSIF({
      ...baseCtx,
      categoryTags: ['quimico'],
      spillVolumeLiters: 10,
    });
    expect(r?.potential).toBe('moderate');
    expect(r?.executiveReviewRequired).toBe(false);
  });

  it('ingreso no autorizado a zona crítica → serious', () => {
    const r = classifyAsSIF({ ...baseCtx, inRestrictedZone: true, exposedWorkerCount: 1 });
    expect(r?.kind).toBe('ingreso_no_autorizado_critico');
    expect(r?.potential).toBe('serious');
  });

  it('descripción con "explosión" → fuego_explosion_evitada', () => {
    const r = classifyAsSIF({ ...baseCtx, description: 'Casi hubo una explosión en el área X' });
    expect(r?.kind).toBe('fuego_explosion_evitada');
  });

  it('descripción con "colapso" → fatal', () => {
    const r = classifyAsSIF({ ...baseCtx, description: 'Casi colapso de estructura' });
    expect(r?.kind).toBe('colapso_estructural_evitado');
    expect(r?.potential).toBe('fatal');
  });

  it('near-miss sin disparadores → null (NO es SIF)', () => {
    const r = classifyAsSIF({ ...baseCtx, description: 'tropiezo menor sin consecuencias' });
    expect(r).toBeNull();
  });
});

describe('summarizeSIFPrecursors', () => {
  it('cuenta y detecta pendientes de revisión', () => {
    const summary = summarizeSIFPrecursors([
      {
        kind: 'altura_sin_lesion',
        potential: 'fatal',
        rationale: ['x'],
        executiveReviewRequired: true,
        mandanteNotificationRequired: true,
      },
      {
        kind: 'altura_sin_lesion',
        potential: 'serious',
        rationale: ['x'],
        executiveReviewRequired: true,
        mandanteNotificationRequired: false,
        reviewedAt: '2026-05-11T10:00:00Z', // ya revisado
      },
      {
        kind: 'casi_golpe_movil',
        potential: 'serious',
        rationale: ['x'],
        executiveReviewRequired: false,
        mandanteNotificationRequired: false,
      },
    ]);
    expect(summary.totalPrecursors).toBe(3);
    expect(summary.byPotential.fatal).toBe(1);
    expect(summary.byPotential.serious).toBe(2);
    expect(summary.pendingExecutiveReview).toBe(1); // solo el primero (segundo ya revisado)
    expect(summary.pendingMandanteNotification).toBe(1);
  });
});
