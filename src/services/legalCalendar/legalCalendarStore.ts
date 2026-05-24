// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) legal calendar store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory + bootstrap custom.

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type {
  LegalObligation,
  ObligationTemplate,
} from './legalObligationsCalendar';
import { bootstrapCalendar } from './legalObligationsCalendar';

const store = createProjectScopedStore<LegalObligation>('legal_obligations', {
  defaultLimit: 200,
  orderByField: 'nextDueAt',
  orderDirection: 'asc',
});

export async function saveObligation(
  projectId: string,
  obligation: LegalObligation,
): Promise<void> {
  await store.save(projectId, obligation);
}

export async function patchObligation(
  projectId: string,
  obligationId: string,
  patch: Partial<LegalObligation>,
): Promise<void> {
  await store.patch(projectId, obligationId, patch);
}

export const subscribeObligations = store.subscribe;
export const listObligations = store.list;

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
  // Probe: ¿hay obligations ya? Si sí, no bootstrap (idempotente).
  const existing = await store.list(projectId, 1);
  if (existing.length > 0) return 0;
  const obligations = bootstrapCalendar(templates);
  let written = 0;
  for (const o of obligations) {
    try {
      await store.save(projectId, o);
      written += 1;
    } catch {
      /* skip individual failures */
    }
  }
  return written;
}
