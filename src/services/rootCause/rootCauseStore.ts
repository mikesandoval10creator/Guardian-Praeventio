// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-22).
//
// CRUD client-side para `RootCauseAnalysis`. Storage path:
//   projects/{projectId}/root_cause_analyses/{incidentId}

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
import type { RootCauseAnalysis } from './rootCauseClassifier';
import { normalizeRootCauseAnalysis } from './rootCauseClassifier';

function rootCausePath(projectId: string): string {
  return `projects/${projectId}/root_cause_analyses`;
}

export async function saveRootCauseAnalysis(
  projectId: string,
  analysis: RootCauseAnalysis,
): Promise<void> {
  if (!projectId) throw new Error('saveRootCauseAnalysis: projectId vacío');
  if (!analysis?.incidentId) throw new Error('saveRootCauseAnalysis: incidentId vacío');
  const ref = doc(db, rootCausePath(projectId), analysis.incidentId);
  await setDoc(
    ref,
    { ...analysis, projectId, updatedAt: Date.now() },
    { merge: true },
  );
}

export function subscribeRootCauseAnalyses(
  projectId: string,
  onSnap: (analyses: RootCauseAnalysis[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 100,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, rootCausePath(projectId));
  const q = query(col, orderBy('analyzedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 500))));
  return onSnapshot(
    q,
    (snap) => {
      const out: RootCauseAnalysis[] = [];
      snap.forEach((d) => {
        try {
          // Normalize on read: a partial/legacy doc missing the array fields
          // would otherwise crash the /root-cause page downstream.
          out.push(normalizeRootCauseAnalysis(d.data(), d.id));
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
