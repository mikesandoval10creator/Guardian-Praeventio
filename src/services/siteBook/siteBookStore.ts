// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) site book store.
//
// CRUD client-side para `SiteBookEntry`s. Schema:
//   projects/{projectId}/site_book/{entry.id}
//   projects/{projectId}/site_book_counters/{year}  — counter atómico

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
  getDoc,
} from '../firebase';
import type { SiteBookEntry } from './siteBookService';

function entriesPath(projectId: string): string {
  return `projects/${projectId}/site_book`;
}

function counterPath(projectId: string, year: number): string {
  return `projects/${projectId}/site_book_counters/${year}`;
}

/**
 * Obtiene + incrementa el counter del año actual. Idempotente por usar
 * setDoc con id determinista; race conditions se resuelven con merge.
 * Para producción al gran volumen usar Firestore transactions.
 */
export async function nextSequenceForYear(
  projectId: string,
  year: number,
): Promise<number> {
  const ref = doc(db, counterPath(projectId, year));
  const snap = await getDoc(ref);
  const current = snap.exists() ? (snap.data() as { value?: number }).value ?? 0 : 0;
  const next = current + 1;
  await setDoc(ref, { value: next, updatedAt: Date.now() }, { merge: true });
  return next;
}

export async function saveSiteBookEntry(
  projectId: string,
  entry: SiteBookEntry,
): Promise<void> {
  if (!projectId) throw new Error('saveSiteBookEntry: projectId vacío');
  if (!entry?.id) throw new Error('saveSiteBookEntry: entry.id vacío');
  const ref = doc(db, entriesPath(projectId), entry.id);
  await setDoc(ref, { ...entry, updatedAt: Date.now() }, { merge: true });
}

export async function patchSiteBookEntry(
  projectId: string,
  entryId: string,
  patch: Partial<SiteBookEntry>,
): Promise<void> {
  const ref = doc(db, entriesPath(projectId), entryId);
  await updateDoc(ref, { ...patch, updatedAt: Date.now() });
}

export function subscribeSiteBookEntries(
  projectId: string,
  onSnap: (entries: SiteBookEntry[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 200,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, entriesPath(projectId));
  const q = query(col, orderBy('recordedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 1000))));
  return onSnapshot(
    q,
    (snap) => {
      const out: SiteBookEntry[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as SiteBookEntry), id: d.id });
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
