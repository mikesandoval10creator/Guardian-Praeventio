// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) tests.
//
// Test del builder que consolida Firestore collections en `ConsistencyState`.
// Mockeamos `firebase` para no necesitar el SDK real ni emulador.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chain: getDocs devuelve un snapshot fake con forEach que itera
// sobre un array preconfigurado por test.
let mockSnaps: Record<string, Array<{ id: string; data: () => any }>> = {};
let lastCollectionPath = '';

vi.mock('../firebase', () => ({
  db: {} as unknown,
  collection: (_db: unknown, path: string) => {
    lastCollectionPath = path;
    return { __path: path };
  },
  query: (col: { __path: string }, ..._args: unknown[]) => col,
  limit: (n: number) => ({ __limit: n }),
  getDocs: async (col: { __path: string }) => {
    const docs = mockSnaps[col.__path] ?? [];
    return {
      forEach: (cb: (d: { id: string; data: () => any }) => void) => {
        for (const d of docs) cb(d);
      },
    };
  },
}));

import { buildConsistencyStateFromFirestore } from './consistencyStateBuilder';

function setMockSnap(path: string, docs: Array<Record<string, any>>) {
  mockSnaps[path] = docs.map((d) => ({
    id: d.id ?? `auto_${Math.random().toString(36).slice(2, 8)}`,
    data: () => d,
  }));
}

describe('buildConsistencyStateFromFirestore', () => {
  beforeEach(() => {
    mockSnaps = {};
    lastCollectionPath = '';
  });

  it('devuelve estado vacío si projectId vacío', async () => {
    const state = await buildConsistencyStateFromFirestore('');
    expect(state.workers).toEqual([]);
    expect(state.taskAssignments).toEqual([]);
    expect(state.documents).toEqual([]);
    expect(state.correctiveActions).toEqual([]);
    expect(state.workPermits).toEqual([]);
    expect(state.trainings).toEqual([]);
    expect(state.validRoles.length).toBeGreaterThan(0);
  });

  it('lee desde paths project-scoped esperados', async () => {
    const projectId = 'proj-abc';
    setMockSnap(`projects/${projectId}/workers`, [
      { uid: 'w1', role: 'trabajador', isActive: true },
    ]);
    const state = await buildConsistencyStateFromFirestore(projectId);
    expect(state.workers).toHaveLength(1);
    expect(state.workers[0].uid).toBe('w1');
  });

  it('aplica defaults sensibles cuando docs tienen campos faltantes', async () => {
    setMockSnap('projects/p1/workers', [
      { uid: 'w1' }, // sin role / isActive / trainings
    ]);
    const state = await buildConsistencyStateFromFirestore('p1');
    expect(state.workers[0].role).toBe('trabajador'); // default
    expect(state.workers[0].activeTrainings).toEqual([]);
    expect(state.workers[0].isActive).toBe(true); // default cuando no se especifica
  });

  it('filtra docs malformados (uid no string)', async () => {
    setMockSnap('projects/p1/workers', [
      { uid: 'w1', role: 'trabajador' },
      { role: 'sin-uid' }, // debe ser filtrado
      { uid: 42, role: 'numeric-uid' }, // uid no-string filtrado
    ]);
    const state = await buildConsistencyStateFromFirestore('p1');
    expect(state.workers).toHaveLength(1);
    expect(state.workers[0].uid).toBe('w1');
  });

  it('deriva activeApproverUids desde workers approvers (default)', async () => {
    setMockSnap('projects/p1/workers', [
      { uid: 'w1', role: 'trabajador', isActive: true },
      { uid: 'w2', role: 'supervisor', isActive: true },
      { uid: 'w3', role: 'gerente', isActive: true },
      { uid: 'w4', role: 'prevencionista', isActive: false }, // inactivo: no
    ]);
    const state = await buildConsistencyStateFromFirestore('p1');
    expect(state.activeApproverUids).toEqual(expect.arrayContaining(['w2', 'w3']));
    expect(state.activeApproverUids).not.toContain('w1'); // role no-approver
    expect(state.activeApproverUids).not.toContain('w4'); // inactivo
  });

  it('respeta activeApproverUids explícito (override)', async () => {
    setMockSnap('projects/p1/workers', [
      { uid: 'w-super', role: 'supervisor', isActive: true },
    ]);
    const state = await buildConsistencyStateFromFirestore('p1', {
      activeApproverUids: ['external-approver'],
    });
    expect(state.activeApproverUids).toEqual(['external-approver']);
  });

  it('respeta validRoles + eppByRole explícitos', async () => {
    const state = await buildConsistencyStateFromFirestore('p1', {
      validRoles: ['custom-role'],
      eppByRole: { 'custom-role': ['casco'] },
    });
    expect(state.validRoles).toEqual(['custom-role']);
    expect(state.eppByRole).toEqual({ 'custom-role': ['casco'] });
  });

  it('lee task_assignments con shape esperado', async () => {
    setMockSnap('projects/p1/task_assignments', [
      {
        taskId: 't1',
        workerUid: 'w1',
        riskType: 'altura',
        requiredTrainings: ['trabajo_altura_r1'],
        requiredEpp: ['arnes'],
      },
    ]);
    const state = await buildConsistencyStateFromFirestore('p1');
    expect(state.taskAssignments).toHaveLength(1);
    expect(state.taskAssignments[0].riskType).toBe('altura');
    expect(state.taskAssignments[0].requiredTrainings).toEqual(['trabajo_altura_r1']);
  });

  it('lee documents con status válido', async () => {
    setMockSnap('projects/p1/documents', [
      { id: 'd1', status: 'approved', signedBy: 'w-super' },
      { id: 'd2', status: 'draft' },
      { id: 'd3' }, // sin status → filtrado
    ]);
    const state = await buildConsistencyStateFromFirestore('p1');
    expect(state.documents).toHaveLength(2);
  });

  it('soporta paralelismo: lee todas las colecciones en una sola promesa', async () => {
    setMockSnap('projects/p1/workers', [{ uid: 'w1', role: 'trabajador' }]);
    setMockSnap('projects/p1/task_assignments', [{ taskId: 't1', workerUid: 'w1' }]);
    setMockSnap('projects/p1/documents', [{ id: 'd1', status: 'approved' }]);
    setMockSnap('projects/p1/corrective_actions', [{ id: 'c1', status: 'open' }]);
    setMockSnap('projects/p1/work_permits', [{ id: 'p1', approverUid: 'w-super', status: 'active' }]);
    setMockSnap('projects/p1/trainings', [{ id: 'tr1', workerUid: 'w1' }]);

    const state = await buildConsistencyStateFromFirestore('p1');
    expect(state.workers.length).toBe(1);
    expect(state.taskAssignments.length).toBe(1);
    expect(state.documents.length).toBe(1);
    expect(state.correctiveActions.length).toBe(1);
    expect(state.workPermits.length).toBe(1);
    expect(state.trainings.length).toBe(1);
  });
});
