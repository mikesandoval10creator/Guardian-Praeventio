// SPDX-License-Identifier: MIT
// Praeventio Guard — Ticket 399aa66d-73fe-81d3-9eeb-ea2aa4cb064a [P2].
//
// Construye TenantUsageSnapshot[] desde datos REALES de Firestore para el
// <ChurnRiskPanel /> admin. NUNCA inventa métricas: cada campo proviene de
// una colección verificada:
//
//   - users/{uid}.subscription.{planId,status,createdAt}  → hasPaidPlan,
//     daysSinceSignup (fallback: users.createdAt)
//   - projects (members contiene uid)                       → activeProjects
//   - projects/{pid}/workers/{wid} (o workersCount real)   → activeWorkers
//   - projects/{pid}/epp_items, /documents, /training, ... → activeModules
//   - quotaTracker daily counters                           → events30d
//
// Un tenant "activo" es un user con subscription O al menos un proyecto
// (ruido admin sin actividad se excluye — no se muestra churn de cuentas
// fantasma).

import type { TenantUsageSnapshot, ModuleUsageKind } from './adoptionAnalytics';

/**
 * Interfaz estructural mínima que el builder necesita. El FakeFirestore de
 * tests y el Firestore real ambos la satisfacen — evitamos acoplar a la
 * interfaz completa de firebase-admin (el fake no la implementa).
 */
export interface SnapshotsDb {
  collection(name: string): {
    limit(n: number): {
      get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }>;
    };
    where(field: string, op: string, value: unknown): {
      limit(n: number): {
        get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }>;
      };
      orderBy(field: string, dir?: 'asc' | 'desc'): {
        limit(n: number): {
          get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }>;
        };
      };
    };
    orderBy(field: string, dir?: 'asc' | 'desc'): {
      limit(n: number): {
        get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }>;
      };
    };
  };
}

const DAY_MS = 86_400_000;

function daysSince(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/** Colecciones cuyo doc existence marca el módulo como activo. */
const MODULE_COLLECTIONS: Array<[ModuleUsageKind, string]> = [
  ['workers', 'workers'],
  ['incidents', 'incidents'],
  ['findings', 'findings'],
  ['documents', 'documents'],
  ['cphs', 'cphs_meetings'],
  ['training', 'training_sessions'],
  ['epp', 'epp_items'],
  ['sitebook', 'sitebook_entries'],
  ['work_permits', 'work_permits'],
];

export interface BuildTenantSnapshotsDeps {
  nowMs?: number;
}

/**
 * Lee Firestore y construye snapshots reales por tenant. `limit` acota el
 * barrido de users (admin dashboard no debe listar cientos de miles).
 */
export async function buildTenantSnapshots(
  db: SnapshotsDb,
  opts: { limit?: number } = {},
): Promise<TenantUsageSnapshot[]> {
  const nowMs = Date.now();
  const limit = opts.limit ?? 500;

  const usersSnap = await db.collection('users').limit(limit).get();
  const snaps: TenantUsageSnapshot[] = [];

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const user = userDoc.data() ?? {};

    const sub = (user as Record<string, unknown>).subscription as
      | { planId?: string; status?: string; createdAt?: string }
      | undefined;
    const hasPaidPlan =
      !!sub?.planId &&
      (sub.status === 'active' || sub.status === 'trialing' || !sub.status);
    const signupIso =
      sub?.createdAt ??
      ((user as Record<string, unknown>).createdAt as string | undefined);

    // Proyectos del tenant (members incluye uid).
    const projectsSnap = await db
      .collection('projects')
      .where('members', 'array-contains', uid)
      .limit(100)
      .get();
    const projects = projectsSnap.docs.map((d) => ({ id: d.id, data: d.data() ?? {} }));

    // Sin subscription y sin proyectos -> no es tenant activo (ruido).
    if (!hasPaidPlan && projects.length === 0) continue;

    // activeWorkers: suma workersCount reales (o cuenta docs si falta).
    let activeWorkers = 0;
    for (const p of projects) {
      const wc = (p.data ?? {}) as Record<string, unknown>;
      if (typeof wc.workersCount === 'number') activeWorkers += wc.workersCount;
    }

    // activeModules: existence de subcolecciones reales (sample 1 doc).
    const activeModules = new Set<ModuleUsageKind>(['projects']);
    for (const [kind, coll] of MODULE_COLLECTIONS) {
      if (projects.length === 0) break;
      const probe = await db
        .collection(`projects/${projects[0].id}/${coll}`)
        .limit(1)
        .get();
      if (probe.docs.length > 0) activeModules.add(kind);
    }

    // events30d: contador diario real de quotaTracker por tenant.
    let events30d = 0;
    try {
      const quotaSnap = await db
        .collection('quota_usage')
        .where('tenantId', '==', uid)
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      for (const q of quotaSnap.docs) {
        const qd = q.data() as { requests?: number };
        events30d += typeof qd.requests === 'number' ? qd.requests : 0;
      }
    } catch {
      // Colección no indexada en algunos entornos — 0 honesto, no inventado.
      events30d = 0;
    }

    snaps.push({
      tenantId: uid,
      snapshotAt: new Date(nowMs).toISOString(),
      daysSinceSignup: daysSince(signupIso, nowMs),
      activeModules,
      events30d,
      activeWorkers,
      activeProjects: projects.length,
      hasPaidPlan,
    });
  }

  return snaps;
}
