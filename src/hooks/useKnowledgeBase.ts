// Praeventio Guard — §185-190 Knowledge Base hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import { apiAuthHeader } from '../lib/apiAuth';

export type KbCategory =
  | 'glossary'
  | 'faq'
  | 'procedure'
  | 'guide'
  | 'norm_summary';

export type KbSourceType =
  | 'lesson'
  | 'procedure'
  | 'standard'
  | 'experience';

export interface KnowledgeEntry {
  id: string;
  kind: KbCategory;
  title: string;
  content: string;
  tags: string[];
  lastReviewedAt: string;
  viewCount: number;
  averageRating?: number;
  isObsolete: boolean;
  authorUid: string;
  sourceType?: KbSourceType;
  obsoleteReason?: string;
  obsoleteAt?: string;
  score?: number;
}

export interface KnowledgeBaseResponse {
  entries: KnowledgeEntry[];
  searched: boolean;
  category: KbCategory | null;
}

export interface UseKnowledgeBaseOptions {
  category?: KbCategory;
  search?: string;
}

export function useKnowledgeBase(
  projectId: string | null,
  opts: UseKnowledgeBaseOptions = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.category) qs.set('category', opts.category);
    if (opts.search) qs.set('search', opts.search);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/knowledge-base${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<KnowledgeBaseResponse>(path);
}

export interface KbEntryCreatePayload {
  title: string;
  content: string;
  category?: KbCategory;
  tags?: string[];
  sourceType?: KbSourceType;
}

export async function createKbEntry(
  projectId: string,
  payload: KbEntryCreatePayload,
): Promise<{ entry: KnowledgeEntry }> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(`/api/sprint-k/${projectId}/knowledge-base`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { entry: KnowledgeEntry };
}

// NOTE: not a React hook — an async action that records an entry "use"
// (POST /use). Named without a `use` prefix so it is callable from event
// handlers without tripping react-hooks/rules-of-hooks.
export async function recordKbEntryUse(
  projectId: string,
  entryId: string,
): Promise<void> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/knowledge-base/${entryId}/use`,
    {
      method: 'POST',
      headers: authHeader ? { Authorization: authHeader } : undefined,
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}

export async function flagKbObsolete(
  projectId: string,
  entryId: string,
  reason: string,
): Promise<void> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/knowledge-base/${entryId}/flag-obsolete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify({ reason }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}
