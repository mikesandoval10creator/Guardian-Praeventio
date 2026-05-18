// Praeventio Guard — F.12 Lessons Learned hooks.
//
// Hooks dedicados para `/api/sprint-k/:projectId/lessons`. Migrados del
// monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K reformulation.
//
// Mantiene la misma forma pública que `useSprintK.useLessons` /
// `useSprintK.createLesson` para que los consumers (LessonsLearned.tsx
// + tests) solo cambien el import.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type {
  Lesson,
  LessonScope,
} from '../services/lessonsLearned/lessonsLibrary';

export interface LessonsResponse {
  lessons: Lesson[];
}

export function useLessons(
  projectId: string | null,
  opts: { scope?: LessonScope; riskCategory?: string } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.scope) qs.set('scope', opts.scope);
    if (opts.riskCategory) qs.set('riskCategory', opts.riskCategory);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/lessons${query ? `?${query}` : ''}`;
  }
  return useEndpoint<LessonsResponse>(path);
}

export interface LessonPayload {
  id: string;
  summary: string;
  preventiveAction: string;
  riskCategories: string[];
  tags: string[];
  scope: LessonScope;
  industry?: string;
  derivedFromIncidentId?: string;
  publishedAt: string;
  adoptionCount: number;
}

export async function createLesson(
  projectId: string,
  payload: LessonPayload,
): Promise<{ ok: true }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/lessons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return { ok: true };
}

export type { Lesson, LessonScope };
