// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) exception store.
//
// CRUD client-side simplificado para `ExceptionRecord` con path
// `projects/{projectId}/exceptions/{id}` (consistente con otros stores
// que hice). El adapter formal (`exceptionFirestoreAdapter.ts`) usa
// `tenants/{tid}/projects/{pid}/...` y queda disponible para flujos
// server-side / cron jobs.

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
import type { ExceptionRecord } from './exceptionEngine';

function exceptionsPath(projectId: string): string {
  return `projects/${projectId}/exceptions`;
}

export async function saveException(
  projectId: string,
  record: ExceptionRecord,
): Promise<void> {
  if (!projectId) throw new Error('saveException: projectId vacío');
  if (!record?.id) throw new Error('saveException: record.id vacío');
  const ref = doc(db, exceptionsPath(projectId), record.id);
  await setDoc(ref, { ...record, updatedAt: Date.now() }, { merge: true });
}

export async function patchException(
  projectId: string,
  recordId: string,
  patch: Partial<ExceptionRecord>,
): Promise<void> {
  if (!projectId || !recordId) throw new Error('patchException: ids vacíos');
  const ref = doc(db, exceptionsPath(projectId), recordId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeExceptions(
  projectId: string,
  onSnap: (records: ExceptionRecord[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 100,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, exceptionsPath(projectId));
  const q = query(col, orderBy('approvedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 500))));
  return onSnapshot(
    q,
    (snap) => {
      const out: ExceptionRecord[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as ExceptionRecord;
          out.push({ ...data, id: d.id });
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
