// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) audit portal store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory.
//
// Schema: tenants/{tid}/audit_portals — adapter formal vive en
// `auditPortalFirestoreAdapter.ts`. Acá usamos `projects/{projectId}/
// audit_portals/{portal.id}` (path simplificado, consistente con otros
// stores client-side).

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type { AuditPortalConfig } from './externalAuditPortal';

const store = createProjectScopedStore<AuditPortalConfig>('audit_portals', {
  defaultLimit: 50,
  orderByField: 'createdAt',
});

export async function savePortal(
  projectId: string,
  portal: AuditPortalConfig,
): Promise<void> {
  await store.save(projectId, portal);
}

export async function patchPortal(
  projectId: string,
  portalId: string,
  patch: Partial<AuditPortalConfig>,
): Promise<void> {
  await store.patch(projectId, portalId, patch);
}

export const subscribePortals = store.subscribe;
export const listPortals = store.list;
