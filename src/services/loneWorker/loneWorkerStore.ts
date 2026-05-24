// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-23).
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory `createProjectScopedStore`.
//
// CRUD client-side para `LoneWorkerSession`s. Storage path:
//   projects/{projectId}/lone_worker_sessions/{session.id}
//
// activeFilter habilita subscribeActiveLoneWorkerSessions (where status==active).

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type { LoneWorkerSession } from './loneWorkerService';

const store = createProjectScopedStore<LoneWorkerSession>('lone_worker_sessions', {
  orderByField: 'startedAt',
  activeFilter: { field: 'status', op: '==', value: 'active' },
});

export async function saveLoneWorkerSession(
  projectId: string,
  session: LoneWorkerSession,
): Promise<void> {
  await store.save(projectId, session);
}

export async function patchLoneWorkerSession(
  projectId: string,
  sessionId: string,
  patch: Partial<LoneWorkerSession>,
): Promise<void> {
  await store.patch(projectId, sessionId, patch);
}

export const subscribeLoneWorkerSessions = store.subscribe;
export const subscribeActiveLoneWorkerSessions = store.subscribeFiltered;
export const listLoneWorkerSessions = store.list;
