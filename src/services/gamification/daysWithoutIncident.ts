// SPDX-License-Identifier: MIT
//
// Sprint 29 Bucket DD F-D — "Días sin incidentes" gamification axis.
//
// Computes the running counter of consecutive days without an incident
// report and awards positive milestone medals (100 / 365 días) on the
// `gamification_scores` collection. Pure DI — the tests inject an in-memory
// Firestore fake; production wires `admin.firestore()` from server.ts.
//
// Idempotency: each milestone for a project is awarded at most once. The
// idempotency key is `days_milestone_${projectId}_${days}` and lives as
// the document id in `gamification_scores` so a re-run of the cron is a
// noop. Mirrors the SUSESO reminder reaper pattern from Sprint 28.
//
// Filosofía Praeventio: la métrica nunca penaliza. Si hay un incidente,
// el contador vuelve a 0 — eso es información, no un castigo. La cuadrilla
// gana XP cuando cruza un umbral, nunca lo pierde.

// ───────────────────────────────────────────────────────────────────────
// Firestore-shape DI (subset usado, mismo patrón que cphsService.ts)
// ───────────────────────────────────────────────────────────────────────

export interface MinimalReportDoc {
  id: string;
  data: () => { type?: string; projectId?: string; timestamp?: number | string; [k: string]: unknown };
}

export interface MinimalQuery {
  where(field: string, op: '==', value: unknown): MinimalQuery;
  orderBy(field: string, dir: 'asc' | 'desc'): MinimalQuery;
  limit(n: number): MinimalQuery;
  get(): Promise<{ empty: boolean; docs: MinimalReportDoc[] }>;
}

export interface MinimalDb {
  collection(name: string): MinimalQuery & {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data: () => any }>;
      set(data: any): Promise<void>;
    };
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the number of full days between the most recent incident
 * report (type === 'Incidente') for a project and `nowMs` (default
 * Date.now()). When no incidents exist, the counter is the days since
 * `sinceMs` (project creation timestamp passed by the caller) or 0.
 *
 * Pure: side-effect free. Returns a non-negative integer (floor).
 */
export async function computeDaysWithoutIncident(
  projectId: string,
  db: MinimalDb,
  opts: { sinceMs?: number; nowMs?: number } = {},
): Promise<number> {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('projectId is required');
  }
  const now = opts.nowMs ?? Date.now();

  const snap = await db
    .collection('reports')
    .where('type', '==', 'Incidente')
    .where('projectId', '==', projectId)
    .orderBy('timestamp', 'desc')
    .limit(1)
    .get();

  let lastMs: number | null = null;
  if (!snap.empty && snap.docs.length > 0) {
    const raw = snap.docs[0].data();
    const ts = raw.timestamp;
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      lastMs = ts;
    } else if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!Number.isNaN(parsed)) lastMs = parsed;
    }
  }

  const baseMs = lastMs ?? opts.sinceMs ?? now;
  const diff = now - baseMs;
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

// ───────────────────────────────────────────────────────────────────────
// Milestone awards
// ───────────────────────────────────────────────────────────────────────

export interface MilestoneAward {
  projectId: string;
  /** The crew member credited with this milestone (read by historyAggregator,
   *  which sums points per userId). Without it the row is unreadable XP. */
  userId: string;
  days: number;
  medalId: 'days-100' | 'days-365';
  label: string;
  idempotencyKey: string;
  awardedAt: string;
}

const MILESTONES: Array<{ threshold: number; medalId: MilestoneAward['medalId']; label: string }> = [
  { threshold: 100, medalId: 'days-100', label: '🛡️ 100 días limpios' },
  { threshold: 365, medalId: 'days-365', label: '💎 365 días limpios' },
];

/**
 * Award any milestone medals the project just crossed, CREDITING EACH PROJECT
 * MEMBER (they all contributed to the incident-free streak). Idempotent: the
 * per-member write key is `days_milestone_${projectId}_${days}_${uid}`, so
 * re-runs are a no-op. Returns the list of awards actually persisted.
 *
 * Disconnection hunt #9 (2026-06-16): the previous version wrote ONE
 * project-scoped row with NO `userId`. Both readers (PortableCurriculum,
 * UserProfileModal → historyAggregator) query `gamification_scores` by
 * `userId` and sum `points` per row, so a row without `userId` was unreadable
 * XP — the "100/365 días limpios" recognition never reached any worker's CV.
 * It was also never invoked by any cron (orphan). It is now driven by the
 * weekly digest (runWeeklyDigest) and fans out one readable row per member.
 *
 * We read the canonical `projects/{id}.members` uid array (same source as
 * assertProjectMember). When there are no members there is no one to credit,
 * so nothing is written (never a fabricated/unreadable row).
 */
export async function awardDaysMilestones(
  projectId: string,
  db: MinimalDb,
  opts: { nowMs?: number; sinceMs?: number } = {},
): Promise<MilestoneAward[]> {
  const awarded: MilestoneAward[] = [];
  const days = await computeDaysWithoutIncident(projectId, db, opts);
  if (days < MILESTONES[0].threshold) return awarded; // nothing crossed — skip the member read

  const projSnap = await db.collection('projects').doc(projectId).get();
  const rawMembers = projSnap.exists ? (projSnap.data() as { members?: unknown })?.members : undefined;
  const memberUids = Array.isArray(rawMembers)
    ? rawMembers.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  if (memberUids.length === 0) return awarded; // no one to credit

  const now = new Date(opts.nowMs ?? Date.now()).toISOString();

  for (const m of MILESTONES) {
    if (days < m.threshold) continue;
    for (const uid of memberUids) {
      const idempotencyKey = `days_milestone_${projectId}_${m.threshold}_${uid}`;
      const ref = db.collection('gamification_scores').doc(idempotencyKey);
      const existing = await ref.get();
      if (existing.exists) continue;
      const award: MilestoneAward = {
        projectId,
        userId: uid,
        days: m.threshold,
        medalId: m.medalId,
        label: m.label,
        idempotencyKey,
        awardedAt: now,
      };
      await ref.set({
        ...award,
        reason: 'days_without_incident_milestone',
        points: m.threshold === 365 ? 365 : 100,
        timestamp: now,
      });
      awarded.push(award);
    }
  }
  return awarded;
}
