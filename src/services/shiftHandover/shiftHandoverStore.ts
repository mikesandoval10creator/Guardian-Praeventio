// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) shift handover store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory.
//
// CRUD client-side para `ShiftRecord`s. Schema:
//   projects/{projectId}/shifts/{shift.id}

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type { ShiftRecord } from './shiftHandoverService';

const store = createProjectScopedStore<ShiftRecord>('shifts', {
  defaultLimit: 50,
  orderByField: 'startedAt',
});

export async function saveShift(
  projectId: string,
  shift: ShiftRecord,
): Promise<void> {
  await store.save(projectId, shift);
}

export async function patchShift(
  projectId: string,
  shiftId: string,
  patch: Partial<ShiftRecord>,
): Promise<void> {
  await store.patch(projectId, shiftId, patch);
}

export const subscribeShifts = store.subscribe;
export const listShifts = store.list;
