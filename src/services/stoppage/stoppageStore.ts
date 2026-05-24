// SPDX-License-Identifier: MIT
// Praeventio Guard — §Sprint K UI wire (2026-05-22) stoppage store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa `createProjectScopedStore<T>`
// (factory genérica) en vez de duplicar el pattern save/patch/subscribe.
// La API pública (saveStoppage / updateStoppageStatus / subscribeStoppages)
// se preserva 1:1 para no romper los callers en StoppageMonitor.tsx.
//
// Schema: projects/{projectId}/stoppages/{stoppage.id}
// Rules: firestore.rules ya cubre lectura/escritura de subcollections de
//        projects con miembros del proyecto.
//
// activeFilter habilita `subscribeActiveStoppages` (where 'status' == 'active'
// server-side) — reduce reads a escala (Plan §B.5).

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type { Stoppage, StoppageStatus } from './stoppageEngine';

const store = createProjectScopedStore<Stoppage>('stoppages', {
  orderByField: 'declaredAt',
  activeFilter: { field: 'status', op: '==', value: 'active' },
});

/** Persiste un Stoppage. Idempotente (setDoc merge con `stoppage.id`). */
export async function saveStoppage(
  stoppage: Stoppage,
  projectId: string,
): Promise<void> {
  await store.save(projectId, stoppage);
}

/**
 * Patch parcial del Stoppage. Acepta solo el subset legal de campos que
 * mutan durante el lifecycle (status + timestamps + actor + preconditions).
 */
export async function updateStoppageStatus(
  projectId: string,
  stoppageId: string,
  patch: Partial<
    Pick<
      Stoppage,
      | 'status'
      | 'resumedAt'
      | 'resumedByUid'
      | 'cancelledAt'
      | 'cancelledByUid'
      | 'cancelledReason'
      | 'resumptionPreconditions'
    >
  >,
): Promise<void> {
  await store.patch(projectId, stoppageId, patch);
}

/** Live subscription a todos los stoppages del proyecto ordenados desc. */
export const subscribeStoppages = store.subscribe;

/**
 * Live subscription FILTRADO server-side a stoppages activos. Reduce reads
 * dramáticamente a escala (proyectos con cientos de stoppages históricos).
 * Plan 2026-05-23 §B.5.
 */
export const subscribeActiveStoppages = store.subscribeFiltered;

/** Read-once. Útil para reports / snapshots. */
export const listStoppages = store.list;

/** Filtro client-side puro — mantenido por backward-compat. */
export function filterByStatus(
  stoppages: Stoppage[],
  status: StoppageStatus,
): Stoppage[] {
  return stoppages.filter((s) => s.status === status);
}
