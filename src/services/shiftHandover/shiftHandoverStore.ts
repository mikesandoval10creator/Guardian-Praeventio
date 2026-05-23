// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) shift handover store.
//
// CRUD client-side para `ShiftRecord`s. Schema:
//   projects/{projectId}/shifts/{shift.id}

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
import type { ShiftRecord } from './shiftHandoverService';

function shiftsPath(projectId: string): string {
  return `projects/${projectId}/shifts`;
}

export async function saveShift(
  projectId: string,
  shift: ShiftRecord,
): Promise<void> {
  if (!projectId) throw new Error('saveShift: projectId vacío');
  if (!shift?.id) throw new Error('saveShift: shift.id vacío');
  const ref = doc(db, shiftsPath(projectId), shift.id);
  await setDoc(ref, { ...shift, updatedAt: Date.now() }, { merge: true });
}

export async function patchShift(
  projectId: string,
  shiftId: string,
  patch: Partial<ShiftRecord>,
): Promise<void> {
  const ref = doc(db, shiftsPath(projectId), shiftId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeShifts(
  projectId: string,
  onSnap: (shifts: ShiftRecord[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 50,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, shiftsPath(projectId));
  const q = query(col, orderBy('startedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 200))));
  return onSnapshot(
    q,
    (snap) => {
      const out: ShiftRecord[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as ShiftRecord), id: d.id });
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
