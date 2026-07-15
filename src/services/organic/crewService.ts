// SPDX-License-Identifier: MIT
// Sprint 15 — Crew persistence layer.
//
// Pure functions over a tiny in-memory + Firestore-shaped store. The
// public surface is intentionally small; UI code consumes these via the
// usual `useFirestore` patterns. A simple in-memory backend is provided for
// unit tests and offline-first paths; production callers pass a Firestore-
// backed `CrewStore` adapter.

import { randomId } from '../../utils/randomId';
import type { Crew, XpReason } from '../../types/organic';
// 16th wave (Bucket B) analytics: wire `cuadrilla.created` and
// `cuadrilla.member.added` at the persistence seam so every caller (UI,
// scripts, tests) is covered without per-component edits. The track call
// is fire-and-forget — wrapping it in try/catch keeps the analytics
// constraint (TRACKING_PLAN §11: "MUST NOT break user flow") even when
// the adapter is misconfigured.
import { analytics } from '../analytics';

export interface CrewStore {
  get(id: string): Promise<Crew | null>;
  list(projectId: string): Promise<Crew[]>;
  create(crew: Crew): Promise<void>;
  update(id: string, patch: Partial<Crew>): Promise<void>;
}

/**
 * In-memory store. Each instance is isolated; tests should construct a
 * fresh store per case. The returned crew objects are deep-frozen.
 */
export function createMemoryCrewStore(): CrewStore {
  const data = new Map<string, Crew>();
  return {
    async get(id) {
      return data.get(id) ?? null;
    },
    async list(projectId) {
      return [...data.values()].filter((c) => c.projectId === projectId);
    },
    async create(crew) {
      data.set(crew.id, { ...crew });
    },
    async update(id, patch) {
      const cur = data.get(id);
      if (!cur) throw new Error(`Crew ${id} not found`);
      data.set(id, { ...cur, ...patch });
    },
  };
}

function genId(prefix: string): string {
  // crypto.randomUUID is widely available in modern Node + browsers; fall
  // back to a timestamp-based id for very old runtimes.
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return `${prefix}-${g.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${randomId()}`;
}

export async function createCrew(
  store: CrewStore,
  projectId: string,
  name: string,
  memberUids: string[]
): Promise<Crew> {
  if (!projectId) throw new Error('projectId is required');
  if (!name.trim()) throw new Error('name is required');
  const crew: Crew = {
    id: genId('crew'),
    projectId,
    name: name.trim(),
    memberUids: [...new Set(memberUids)],
    createdAt: new Date().toISOString(),
    totalProcessesCompleted: 0,
    daysWithoutIncident: 0,
    xp: 0,
    lastIncidentAt: null,
  };
  await store.create(crew);
  // 16th wave analytics: catalog row 40 (`cuadrilla.created`). Fired after
  // the store write resolves so the row tracks committed crews only.
  try {
    void analytics.track('cuadrilla.created', {
      cuadrilla_id: crew.id,
      member_count: crew.memberUids.length,
    });
  } catch { /* analytics must never break user flow */ }
  return crew;
}

export async function getCrews(store: CrewStore, projectId: string): Promise<Crew[]> {
  return store.list(projectId);
}

export async function addMemberToCrew(
  store: CrewStore,
  crewId: string,
  uid: string
): Promise<Crew> {
  const crew = await store.get(crewId);
  if (!crew) throw new Error(`Crew ${crewId} not found`);
  if (crew.memberUids.includes(uid)) return crew;
  const next = { ...crew, memberUids: [...crew.memberUids, uid] };
  await store.update(crewId, { memberUids: next.memberUids });
  // 16th wave analytics: catalog row 41 (`cuadrilla.member.added`). The
  // catalog requires `member_role` (analytics `Role` enum); we don't have
  // role context inside this primitive, so we default to `worker` (the
  // safe coarse role, matching the catalog row 23 fallback convention).
  // Callers that know a more specific role can fire a follow-up event
  // upstream.
  try {
    void analytics.track('cuadrilla.member.added', {
      cuadrilla_id: crewId,
      target_user_id_hash: uid,
      member_role: 'worker',
    });
  } catch { /* analytics must never break user flow */ }
  return next;
}

export async function removeMember(
  store: CrewStore,
  crewId: string,
  uid: string
): Promise<Crew> {
  const crew = await store.get(crewId);
  if (!crew) throw new Error(`Crew ${crewId} not found`);
  const memberUids = crew.memberUids.filter((u) => u !== uid);
  await store.update(crewId, { memberUids });
  return { ...crew, memberUids };
}

/**
 * Award XP to a crew. Always positive; negative or zero amounts are no-ops
 * (and emit a console.warn in dev). The `reason` is logged for audit.
 */
export async function awardCrewXp(
  store: CrewStore,
  crewId: string,
  amount: number,
  reason: XpReason | 'process_close_bonus'
): Promise<Crew> {
  if (!Number.isFinite(amount) || amount <= 0) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`[awardCrewXp] non-positive amount ${amount} (reason=${reason}) — ignored`);
    }
    const cur = await store.get(crewId);
    if (!cur) throw new Error(`Crew ${crewId} not found`);
    return cur;
  }
  const cur = await store.get(crewId);
  if (!cur) throw new Error(`Crew ${crewId} not found`);
  const next = { ...cur, xp: cur.xp + Math.floor(amount) };
  await store.update(crewId, { xp: next.xp });
  return next;
}

/**
 * OPT-IN compatibility shim. Returns an existing crew or creates a "default"
 * crew that mirrors the project's flat member list. The Project model is
 * NOT changed; this lets legacy single-team flows surface in the new
 * Crew→Process→Task pipeline without a migration.
 */
export async function getOrCreateDefaultCrew(
  store: CrewStore,
  projectId: string,
  projectMemberUids: string[]
): Promise<Crew> {
  const existing = await store.list(projectId);
  if (existing.length > 0) return existing[0];
  return createCrew(store, projectId, 'Cuadrilla principal', projectMemberUids);
}
