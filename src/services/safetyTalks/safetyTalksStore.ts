// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) safety talks store.
//
// Persiste qué charlas se dieron y a quiénes.
//   projects/{projectId}/safety_talks_given/{YYYY-MM-DD__topicId}

import {
  db,
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from '../firebase';

export interface SafetyTalkRecord {
  id: string;
  date: string; // YYYY-MM-DD
  topicId: string;
  topicTitle: string;
  durationMinutes: number;
  givenByUid: string;
  givenAt: string; // ISO-8601
  attendeeUids: string[];
  notes?: string;
}

function talksPath(projectId: string): string {
  return `projects/${projectId}/safety_talks_given`;
}

export async function saveTalk(
  projectId: string,
  record: SafetyTalkRecord,
): Promise<void> {
  if (!projectId) throw new Error('saveTalk: projectId vacío');
  if (!record?.id) throw new Error('saveTalk: id vacío');
  const ref = doc(db, talksPath(projectId), record.id);
  await setDoc(ref, { ...record, updatedAt: Date.now() }, { merge: true });
}

export function subscribeTalks(
  projectId: string,
  onSnap: (records: SafetyTalkRecord[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 50,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, talksPath(projectId));
  const q = query(col, orderBy('givenAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 365))));
  return onSnapshot(
    q,
    (snap) => {
      const out: SafetyTalkRecord[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as SafetyTalkRecord), id: d.id });
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
