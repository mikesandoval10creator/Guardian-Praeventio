// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) safety talks store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory.
//
// Persiste qué charlas se dieron y a quiénes.
//   projects/{projectId}/safety_talks_given/{YYYY-MM-DD__topicId}

import { createProjectScopedStore } from '../firestore/createProjectScopedStore';

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

const store = createProjectScopedStore<SafetyTalkRecord>('safety_talks_given', {
  defaultLimit: 50,
  orderByField: 'givenAt',
});

export async function saveTalk(
  projectId: string,
  record: SafetyTalkRecord,
): Promise<void> {
  await store.save(projectId, record);
}

export const subscribeTalks = store.subscribe;
export const listTalks = store.list;
