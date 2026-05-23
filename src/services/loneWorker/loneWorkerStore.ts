// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-23).
//
// CRUD client-side para `LoneWorkerSession`s. Storage path:
//   projects/{projectId}/lone_worker_sessions/{session.id}

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
import type { LoneWorkerSession } from './loneWorkerService';

function sessionsPath(projectId: string): string {
  return `projects/${projectId}/lone_worker_sessions`;
}

export async function saveLoneWorkerSession(
  projectId: string,
  session: LoneWorkerSession,
): Promise<void> {
  if (!projectId) throw new Error('saveLoneWorkerSession: projectId vacío');
  if (!session?.id) throw new Error('saveLoneWorkerSession: session.id vacío');
  const ref = doc(db, sessionsPath(projectId), session.id);
  await setDoc(ref, { ...session, updatedAt: Date.now() }, { merge: true });
}

export async function patchLoneWorkerSession(
  projectId: string,
  sessionId: string,
  patch: Partial<LoneWorkerSession>,
): Promise<void> {
  if (!projectId || !sessionId) throw new Error('patchLoneWorkerSession: ids vacíos');
  const ref = doc(db, sessionsPath(projectId), sessionId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeLoneWorkerSessions(
  projectId: string,
  onSnap: (sessions: LoneWorkerSession[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 100,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, sessionsPath(projectId));
  const q = query(col, orderBy('startedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 500))));
  return onSnapshot(
    q,
    (snap) => {
      const out: LoneWorkerSession[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as LoneWorkerSession;
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
