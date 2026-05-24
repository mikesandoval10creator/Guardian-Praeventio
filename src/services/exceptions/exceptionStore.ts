// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) exception store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory.
//
// CRUD client-side simplificado para `ExceptionRecord` con path
// `projects/{projectId}/exceptions/{id}`. El adapter formal
// (`exceptionFirestoreAdapter.ts`) usa `tenants/{tid}/projects/{pid}/...`
// y queda disponible para flujos server-side / cron jobs.
//
// activeFilter habilita subscribeActiveExceptions (where status==active).

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type { ExceptionRecord } from './exceptionEngine';

const store = createProjectScopedStore<ExceptionRecord>('exceptions', {
  orderByField: 'approvedAt',
  activeFilter: { field: 'status', op: '==', value: 'active' },
});

export async function saveException(
  projectId: string,
  record: ExceptionRecord,
): Promise<void> {
  await store.save(projectId, record);
}

export async function patchException(
  projectId: string,
  recordId: string,
  patch: Partial<ExceptionRecord>,
): Promise<void> {
  await store.patch(projectId, recordId, patch);
}

export const subscribeExceptions = store.subscribe;
export const subscribeActiveExceptions = store.subscribeFiltered;
export const listExceptions = store.list;
