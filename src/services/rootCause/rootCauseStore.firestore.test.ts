// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase C.3.
//
// Emulator round-trip para `rootCauseStore` — NO usa el factory genérico
// porque el doc key es `incidentId` (no `id`). Verifica que el save +
// subscribe siguen funcionando contra Firestore real.

import { describe, it, expect, beforeEach } from 'vitest';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';
import {
  saveRootCauseAnalysis,
  subscribeRootCauseAnalyses,
} from './rootCauseStore';
import type { RootCauseAnalysis } from './rootCauseClassifier';

const PROJECT_ID = 'p-rootcause-test';

function sampleAnalysis(incidentId: string): RootCauseAnalysis {
  return {
    incidentId,
    analyzedAt: new Date().toISOString(),
    analyzedByUid: 'demo-supervisor',
    fiveWhys: [
      'El operador no usó EPP',
      'No tenía a mano el casco',
      'El armario estaba vacío',
      'No se rellenó tras última entrega',
      'Falta un proceso de reposición',
    ],
    factors: ['falla_supervision', 'falla_epp'],
    primaryFactor: 'falla_epp',
    suggestedActions: ['Establecer SLA reposición EPP semanal'],
  };
}

describe('rootCauseStore — emulator round-trip', () => {
  it('saveRootCauseAnalysis persiste con incidentId como key', async () => {
    const analysis = sampleAnalysis('incident-001');
    await saveRootCauseAnalysis(PROJECT_ID, analysis);

    // Verificamos directamente con admin que el doc se guardó con
    // doc key = incidentId.
    const admin = getEmulatorAdminFirestore();
    const ref = admin
      .collection(`projects/${PROJECT_ID}/root_cause_analyses`)
      .doc('incident-001');
    const snap = await ref.get();
    expect(snap.exists).toBe(true);
    const data = snap.data();
    expect(data?.incidentId).toBe('incident-001');
    expect(data?.primaryFactor).toBe('falla_epp');
    // updatedAt es agregado por el store.
    expect(data?.updatedAt).toBeGreaterThan(0);
  });

  it('saveRootCauseAnalysis es idempotente (merge:true)', async () => {
    const analysis = sampleAnalysis('incident-002');
    await saveRootCauseAnalysis(PROJECT_ID, analysis);

    // Re-guardar con factor distinto debe MERGE (preserva fiveWhys).
    const updated: RootCauseAnalysis = {
      ...analysis,
      primaryFactor: 'falla_supervision',
    };
    await saveRootCauseAnalysis(PROJECT_ID, updated);

    const admin = getEmulatorAdminFirestore();
    const snap = await admin
      .collection(`projects/${PROJECT_ID}/root_cause_analyses`)
      .doc('incident-002')
      .get();
    expect(snap.data()?.primaryFactor).toBe('falla_supervision');
    expect(snap.data()?.fiveWhys).toHaveLength(5);
  });

  it('subscribeRootCauseAnalyses emite snapshot con incidentId reasignado', async () => {
    // Sembramos 2 analyses vía admin.
    const admin = getEmulatorAdminFirestore();
    const colPath = `projects/${PROJECT_ID}/root_cause_analyses`;
    await admin.collection(colPath).doc('inc-A').set({
      ...sampleAnalysis('inc-A'),
      analyzedAt: '2026-05-20T10:00:00Z',
      updatedAt: Date.now(),
    });
    await admin.collection(colPath).doc('inc-B').set({
      ...sampleAnalysis('inc-B'),
      analyzedAt: '2026-05-22T10:00:00Z',
      updatedAt: Date.now(),
    });

    const snaps: RootCauseAnalysis[][] = [];
    const unsub = subscribeRootCauseAnalyses(PROJECT_ID, (items) => snaps.push(items));
    await new Promise((r) => setTimeout(r, 250));
    unsub();

    const last = snaps[snaps.length - 1] ?? [];
    expect(last).toHaveLength(2);
    // orderBy analyzedAt desc → inc-B primero
    expect(last[0].incidentId).toBe('inc-B');
    expect(last[1].incidentId).toBe('inc-A');
  });

  it('subscribeRootCauseAnalyses: projectId vacío → emite [] sin subscription', async () => {
    const snaps: RootCauseAnalysis[][] = [];
    const unsub = subscribeRootCauseAnalyses('', (items) => snaps.push(items));
    // Sincrónico: el callback se invoca antes de retornar.
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual([]);
    unsub();
  });
});

// Limpieza: setup file ya hace afterEach DELETE de todo el proyecto.
// Pero para mantener un PROJECT_ID dedicado evitamos cross-contamination
// con otros tests del mismo fork.
beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  ).catch(() => {});
});
