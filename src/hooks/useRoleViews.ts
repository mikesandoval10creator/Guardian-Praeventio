// Praeventio Guard — Role-based dashboard view client hook (1 mutator).

import type {
  UserRole,
  RoleCard,
  RoleViewState,
} from '../services/roleViews/roleViewBuilder';
import { apiAuthHeaders } from '../lib/apiAuth';

async function authedFetch(
  path: string,
  init: RequestInit = {},

): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * userUid is forced server-side to the authenticated caller. Clients send
 * everything else.
 */
export interface BuildRoleViewWireInput {
  state: Omit<RoleViewState, 'userUid'>;
}

export interface BuildRoleViewResponse {
  cards: RoleCard[];
}

export async function buildRoleViewRemote(
  projectId: string,
  input: BuildRoleViewWireInput,
): Promise<BuildRoleViewResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/role-views/build`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildRoleViewResponse>(res);
}

export type { UserRole, RoleCard };
