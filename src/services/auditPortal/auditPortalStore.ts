// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) audit portal store.
//
// Schema: tenants/{tid}/audit_portals — adapter formal vive en
// `auditPortalFirestoreAdapter.ts`. Acá usamos `projects/{projectId}/
// audit_portals/{portal.id}` (path simplificado, consistente con otros
// stores client-side).

import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from '../firebase';
import type { AuditPortalConfig } from './externalAuditPortal';

function portalsPath(projectId: string): string {
  return `projects/${projectId}/audit_portals`;
}

export async function savePortal(
  projectId: string,
  portal: AuditPortalConfig,
): Promise<void> {
  if (!projectId) throw new Error('savePortal: projectId vacío');
  if (!portal?.id) throw new Error('savePortal: id vacío');
  const ref = doc(db, portalsPath(projectId), portal.id);
  await setDoc(ref, { ...portal, updatedAt: Date.now() }, { merge: true });
}

export async function patchPortal(
  projectId: string,
  portalId: string,
  patch: Partial<AuditPortalConfig>,
): Promise<void> {
  const ref = doc(db, portalsPath(projectId), portalId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribePortals(
  projectId: string,
  onSnap: (portals: AuditPortalConfig[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 50,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, portalsPath(projectId));
  const q = query(col, orderBy('createdAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 200))));
  return onSnapshot(
    q,
    (snap) => {
      const out: AuditPortalConfig[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as AuditPortalConfig), id: d.id });
        } catch {
          /* skip */
        }
      });
      onSnap(out);
    },
    (err) => {
      onError?.(err as Error);
      onSnap([]);
    },
  );
}
