// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) legal calendar store.

import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  limit,
} from '../firebase';
import type {
  LegalObligation,
  ObligationTemplate,
} from './legalObligationsCalendar';
import { bootstrapCalendar } from './legalObligationsCalendar';

function obligationsPath(projectId: string): string {
  return `projects/${projectId}/legal_obligations`;
}

export async function saveObligation(
  projectId: string,
  obligation: LegalObligation,
): Promise<void> {
  if (!projectId) throw new Error('saveObligation: projectId vacío');
  if (!obligation?.id) throw new Error('saveObligation: id vacío');
  const ref = doc(db, obligationsPath(projectId), obligation.id);
  await setDoc(ref, { ...obligation, updatedAt: Date.now() }, { merge: true });
}

export async function patchObligation(
  projectId: string,
  obligationId: string,
  patch: Partial<LegalObligation>,
): Promise<void> {
  const ref = doc(db, obligationsPath(projectId), obligationId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeObligations(
  projectId: string,
  onSnap: (obligations: LegalObligation[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 200,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, obligationsPath(projectId));
  const q = query(col, orderBy('nextDueAt', 'asc'), limit(Math.max(1, Math.min(limitCount, 1000))));
  return onSnapshot(
    q,
    (snap) => {
      const out: LegalObligation[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as LegalObligation), id: d.id });
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

/**
 * Inicializa el calendario desde templates si el proyecto no tiene
 * obligations todavía. Idempotente: solo escribe si la colección está
 * vacía.
 */
export async function ensureCalendarBootstrap(
  projectId: string,
  templates: ObligationTemplate[],
): Promise<number> {
  if (!projectId) return 0;
  const col = collection(db, obligationsPath(projectId));
  const snap = await getDocs(query(col, limit(1)));
  if (!snap.empty) return 0; // Ya hay obligations — no bootstrap.
  const obligations = bootstrapCalendar(templates);
  let written = 0;
  for (const o of obligations) {
    try {
      await saveObligation(projectId, o);
      written += 1;
    } catch {
      /* skip individual failures */
    }
  }
  return written;
}
