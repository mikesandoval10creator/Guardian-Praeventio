// SPDX-License-Identifier: MIT
// Praeventio Guard — §Sprint K UI wire (2026-05-22) stoppage store.
//
// CRUD client-side para `Stoppage`s del proyecto. El adapter formal
// (`stoppageFirestoreAdapter.ts`) usa `tenants/{tid}/projects/{pid}/...`
// pero el UI cliente típicamente trabaja directo con `projects/{pid}/...`
// (consistente con placedObjectsStore.ts, fatigue subs, etc.).
//
// Schema: projects/{projectId}/stoppages/{stoppage.id}
// Rules: firestore.rules ya cubre lectura/escritura de subcollections de
//        projects con miembros del proyecto.

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
import type { Stoppage, StoppageStatus } from './stoppageEngine';

function stoppagesPath(projectId: string): string {
  return `projects/${projectId}/stoppages`;
}

export async function saveStoppage(stoppage: Stoppage, projectId: string): Promise<void> {
  if (!projectId) throw new Error('saveStoppage: projectId vacío');
  if (!stoppage?.id) throw new Error('saveStoppage: stoppage.id vacío');
  const ref = doc(db, stoppagesPath(projectId), stoppage.id);
  // Idempotente (setDoc con id determinista). merge para no perder campos
  // escritos por otros servicios (audit chain, ZK linking).
  await setDoc(ref, { ...stoppage, updatedAt: Date.now() }, { merge: true });
}

export async function updateStoppageStatus(
  projectId: string,
  stoppageId: string,
  patch: Partial<Pick<Stoppage, 'status' | 'resumedAt' | 'resumedByUid' | 'cancelledAt' | 'cancelledByUid' | 'cancelledReason' | 'resumptionPreconditions'>>,
): Promise<void> {
  if (!projectId || !stoppageId) throw new Error('updateStoppageStatus: projectId/id vacíos');
  const ref = doc(db, stoppagesPath(projectId), stoppageId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeStoppages(
  projectId: string,
  onSnap: (stoppages: Stoppage[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 100,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, stoppagesPath(projectId));
  const q = query(col, orderBy('declaredAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 500))));
  return onSnapshot(
    q,
    (snap) => {
      const stoppages: Stoppage[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as Stoppage;
          stoppages.push({ ...data, id: d.id });
        } catch {
          /* skip malformed */
        }
      });
      onSnap(stoppages);
    },
    (err) => {
      onError?.(err as Error);
      onSnap([]);
    },
  );
}

export function filterByStatus(
  stoppages: Stoppage[],
  status: StoppageStatus,
): Stoppage[] {
  return stoppages.filter((s) => s.status === status);
}
