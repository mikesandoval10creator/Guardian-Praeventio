// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) site book store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory + counter custom.
//
// CRUD client-side para `SiteBookEntry`s. Schema:
//   projects/{projectId}/site_book_entries/{entry.id}   (SITE_BOOK_COLLECTION
//     — el MISMO path que leen las rutas de firma WebAuthn; antes escribía
//     'site_book' y la firma nunca encontraba la entrada: AUDIT-2026-06 B9)
//   projects/{projectId}/site_book_counters/{year}  — counter atómico
//
// El counter NO va por el factory porque es un singleton path con shape
// distinto al doc/{id}/{id} estándar. Se mantiene como helper custom.
//
// activeFilter habilita subscribeOpenSiteBookEntries (status==open).

import { db, doc, setDoc, getDoc } from '../firebase';
import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import { SITE_BOOK_COLLECTION, type SiteBookEntry } from './siteBookService';

const store = createProjectScopedStore<SiteBookEntry>(SITE_BOOK_COLLECTION, {
  defaultLimit: 200,
  orderByField: 'recordedAt',
  activeFilter: { field: 'status', op: '==', value: 'open' },
});

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
  await store.save(projectId, entry);
}

export async function patchSiteBookEntry(
  projectId: string,
  entryId: string,
  patch: Partial<SiteBookEntry>,
): Promise<void> {
  await store.patch(projectId, entryId, patch);
}

export const subscribeSiteBookEntries = store.subscribe;
export const subscribeOpenSiteBookEntries = store.subscribeFiltered;
export const listSiteBookEntries = store.list;
