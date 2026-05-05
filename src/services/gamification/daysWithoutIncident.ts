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
 * Award any milestone medals the project just crossed. Idempotent: the
 * write key is `days_milestone_${projectId}_${days}` so re-runs of the
 * daily cron are a no-op. Returns the list of awards actually persisted.
 *
 * Note: we write to `gamification_scores` (the cross-project leaderboard
 * collection) AND check existence by document id so the exists() probe
 * is one round-trip per milestone. Production cron is invoked once a day
 * by Cloud Scheduler — the load is trivial.
 */
export async function awardDaysMilestones(
  projectId: string,
  db: MinimalDb,
  opts: { nowMs?: number; sinceMs?: number } = {},
): Promise<MilestoneAward[]> {
  const days = await computeDaysWithoutIncident(projectId, db, opts);
  const awarded: MilestoneAward[] = [];
  const now = new Date(opts.nowMs ?? Date.now()).toISOString();

  for (const m of MILESTONES) {
    if (days < m.threshold) continue;
    const idempotencyKey = `days_milestone_${projectId}_${m.threshold}`;
    const ref = db.collection('gamification_scores').doc(idempotencyKey);
    const existing = await ref.get();
    if (existing.exists) continue;
    const award: MilestoneAward = {
      projectId,
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
  return awarded;
}
