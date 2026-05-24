// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) operational change store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory.

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type { OperationalChange } from './operationalChangeService';

const store = createProjectScopedStore<OperationalChange>('operational_changes', {
  orderByField: 'declaredAt',
});

export async function saveChange(
  projectId: string,
  change: OperationalChange,
): Promise<void> {
  await store.save(projectId, change);
}

export async function patchChange(
  projectId: string,
  changeId: string,
  patch: Partial<OperationalChange>,
): Promise<void> {
  await store.patch(projectId, changeId, patch);
}

export const subscribeChanges = store.subscribe;
export const listChanges = store.list;
