// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI vidas críticas (2026-05-22).
//
// CRUD client-side para `ControlValidation`s del proyecto. Storage path:
//   projects/{projectId}/control_validations/{controlId__taskId}
//
// El composite id (controlId + taskId) permite a un mismo control
// validarse independientemente por tarea. Para validaciones "globales
// del proyecto" usar taskId = 'project'.

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
import type { ControlValidation } from './criticalControlsLibrary';

function validationsPath(projectId: string): string {
  return `projects/${projectId}/control_validations`;
}

function docIdFor(controlId: string, taskId: string): string {
  return `${controlId}__${taskId}`;
}

export async function saveControlValidation(
  projectId: string,
  taskId: string,
  validation: ControlValidation,
): Promise<void> {
  if (!projectId) throw new Error('saveControlValidation: projectId vacío');
  if (!validation?.controlId) throw new Error('saveControlValidation: controlId vacío');
  const ref = doc(db, validationsPath(projectId), docIdFor(validation.controlId, taskId));
  await setDoc(
    ref,
    { ...validation, projectId, taskId, updatedAt: Date.now() },
    { merge: true },
  );
}

export function subscribeControlValidations(
  projectId: string,
  onSnap: (validations: ControlValidation[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 500,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, validationsPath(projectId));
  const q = query(col, orderBy('validatedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 1000))));
  return onSnapshot(
    q,
    (snap) => {
      const out: ControlValidation[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as ControlValidation;
          out.push(data);
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
