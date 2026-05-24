// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase C.3.
//
// Emulator round-trip para `controlValidationsStore` — NO usa el factory
// genérico porque el doc key es composite `${controlId}__${taskId}`
// (permite que un mismo control se valide independientemente por tarea).
// Verifica el save + subscribe con composite keys reales.

import { describe, it, expect, beforeEach } from 'vitest';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';
import {
  saveControlValidation,
  subscribeControlValidations,
} from './controlValidationsStore';
import type { ControlValidation } from './criticalControlsLibrary';

const PROJECT_ID = 'p-controls-test';

function sampleValidation(
  controlId: string,
  validatedAt: string = new Date().toISOString(),
): ControlValidation {
  return {
    controlId,
    present: true,
    validatedByUid: 'demo-supervisor',
    validatedAt,
    notes: `Validación ${controlId}`,
  };
}

describe('controlValidationsStore — emulator round-trip', () => {
  it('saveControlValidation usa composite id controlId__taskId', async () => {
    const validation = sampleValidation('hca-altura-arnes');
    await saveControlValidation(PROJECT_ID, 'task-001', validation);

    const admin = getEmulatorAdminFirestore();
    const ref = admin
      .collection(`projects/${PROJECT_ID}/control_validations`)
      .doc('hca-altura-arnes__task-001');
    const snap = await ref.get();
    expect(snap.exists).toBe(true);
    const data = snap.data();
    expect(data?.controlId).toBe('hca-altura-arnes');
    expect(data?.taskId).toBe('task-001');
    expect(data?.present).toBe(true);
    expect(data?.projectId).toBe(PROJECT_ID);
  });

  it('mismo controlId con taskId distinto crea docs separados', async () => {
    await saveControlValidation(
      PROJECT_ID,
      'task-A',
      sampleValidation('hca-electric-bloqueo'),
    );
    await saveControlValidation(
      PROJECT_ID,
      'task-B',
      sampleValidation('hca-electric-bloqueo'),
    );

    const admin = getEmulatorAdminFirestore();
    const colSnap = await admin
      .collection(`projects/${PROJECT_ID}/control_validations`)
      .get();
    expect(colSnap.size).toBe(2);
    const ids = colSnap.docs.map((d) => d.id).sort();
    expect(ids).toEqual([
      'hca-electric-bloqueo__task-A',
      'hca-electric-bloqueo__task-B',
    ]);
  });

  it('validación para "project" scope usa taskId=project', async () => {
    await saveControlValidation(
      PROJECT_ID,
      'project',
      sampleValidation('hca-global-equipo'),
    );

    const admin = getEmulatorAdminFirestore();
    const snap = await admin
      .collection(`projects/${PROJECT_ID}/control_validations`)
      .doc('hca-global-equipo__project')
      .get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.taskId).toBe('project');
  });

  it('subscribeControlValidations emite todos los docs ordenados desc por validatedAt', async () => {
    const admin = getEmulatorAdminFirestore();
    const colPath = `projects/${PROJECT_ID}/control_validations`;

    await admin.collection(colPath).doc('ctrl-1__task-X').set({
      controlId: 'ctrl-1',
      taskId: 'task-X',
      present: true,
      validatedAt: '2026-05-20T10:00:00Z',
      validatedByUid: 'u1',
      projectId: PROJECT_ID,
      updatedAt: Date.now(),
    });
    await admin.collection(colPath).doc('ctrl-2__task-Y').set({
      controlId: 'ctrl-2',
      taskId: 'task-Y',
      present: false,
      validatedAt: '2026-05-22T10:00:00Z',
      validatedByUid: 'u2',
      projectId: PROJECT_ID,
      updatedAt: Date.now(),
    });

    const snaps: ControlValidation[][] = [];
    const unsub = subscribeControlValidations(PROJECT_ID, (items) =>
      snaps.push(items),
    );
    await new Promise((r) => setTimeout(r, 250));
    unsub();

    const last = snaps[snaps.length - 1] ?? [];
    expect(last).toHaveLength(2);
    // orderBy validatedAt desc → ctrl-2 (más reciente) primero
    expect(last[0].controlId).toBe('ctrl-2');
    expect(last[1].controlId).toBe('ctrl-1');
  });

  it('subscribeControlValidations: projectId vacío → emite [] sin subscription', () => {
    const snaps: ControlValidation[][] = [];
    const unsub = subscribeControlValidations('', (items) => snaps.push(items));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual([]);
    unsub();
  });
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  ).catch(() => {});
});
