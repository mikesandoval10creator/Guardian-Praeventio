// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) operational change store.

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
import type { OperationalChange } from './operationalChangeService';

function changesPath(projectId: string): string {
  return `projects/${projectId}/operational_changes`;
}

export async function saveChange(
  projectId: string,
  change: OperationalChange,
): Promise<void> {
  if (!projectId) throw new Error('saveChange: projectId vacío');
  if (!change?.id) throw new Error('saveChange: change.id vacío');
  const ref = doc(db, changesPath(projectId), change.id);
  await setDoc(ref, { ...change, updatedAt: Date.now() }, { merge: true });
}

export async function patchChange(
  projectId: string,
  changeId: string,
  patch: Partial<OperationalChange>,
): Promise<void> {
  const ref = doc(db, changesPath(projectId), changeId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeChanges(
  projectId: string,
  onSnap: (changes: OperationalChange[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 100,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, changesPath(projectId));
  const q = query(col, orderBy('declaredAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 500))));
  return onSnapshot(
    q,
    (snap) => {
      const out: OperationalChange[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as OperationalChange), id: d.id });
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
