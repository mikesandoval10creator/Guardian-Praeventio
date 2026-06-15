// Praeventio Guard — daily reconcile of headcount-triggered legal obligations.
//
// Companion to runLegalCalendarReminders. Onboarding seeds dotación
// obligations ONCE from the *estimated* headcount; this job re-evaluates a
// project's CURRENT workersCount against the CL pack thresholds and
// idempotently materialises any obligation a roster change made mandatory
// (25 → CPHS, 100 → Departamento de Prevención) into the SAME subcollection
// `projects/{pid}/legal_obligations` that the reminder cron reads — so the
// reminder cron (same daily run) then alerts the responsable.
//
// Pure core: `reconcileObligationSeeds` (services/sii/projectSeeds.ts). The
// side effects (read project doc + existing obligations, batch upsert) live
// here. NO audit is written inside the job (clean DI, testable without a
// firebase-admin mock); the caller — `/run-daily-housekeeping` in
// maintenance.ts — writes ONE audit_logs row per project that changed, with a
// system actorOverride. NEVER deletes (reconcileObligationSeeds has no negative
// diff) and NEVER pushes to an external organism.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import {
  buildProjectSeeds,
  reconcileObligationSeeds,
} from '../../services/sii/projectSeeds.js';
import { CL_PACK } from '../../data/normativa/cl.js';

const SUBCOLLECTION = 'legal_obligations';

export interface LegalObligationReconcileDeps {
  db: admin.firestore.Firestore;
  /** Project to reconcile. The caller enumerates projects (like the reminder cron). */
  projectId: string;
  /** Explicit clock for deterministic nextDueAt. Defaults to wall clock. */
  now?: () => Date;
}

export interface LegalObligationReconcileResult {
  /** Deterministic ids of the obligations newly materialised this run. */
  created: string[];
  /** Count of obligations that were already present (idempotent no-op). */
  alreadyPresent: number;
  /** Skipped because the project does not operate in Chile (dotación law is CL). */
  skippedNonChile: boolean;
  /** Skipped because the project exists but has no usable headcount. */
  skippedNoHeadcount: boolean;
  /** Skipped because the project doc does not exist (distinct from no-headcount). */
  skippedMissingDoc: boolean;
}

interface ProjectDocShape {
  workersCount?: unknown;
  country?: unknown;
  metadata?: { sectorId?: unknown; codigoActividadSii?: unknown } | null;
}

/**
 * Reconcile a single project's headcount-triggered legal obligations.
 * Idempotent: a project whose obligations already match its headcount produces
 * an empty `created`. Best-effort safe: a malformed project doc resolves to a
 * skip flag, never a throw — the caller iterates many projects and one bad doc
 * must not abort the housekeeping run.
 */
export async function runLegalObligationReconcile(
  deps: LegalObligationReconcileDeps,
): Promise<LegalObligationReconcileResult> {
  const { db, projectId } = deps;
  const now = deps.now ?? (() => new Date());
  const result: LegalObligationReconcileResult = {
    created: [],
    alreadyPresent: 0,
    skippedNonChile: false,
    skippedNoHeadcount: false,
    skippedMissingDoc: false,
  };

  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) {
    result.skippedMissingDoc = true;
    return result;
  }
  const project = (projectSnap.data() ?? {}) as ProjectDocShape;

  // Dotación thresholds are Chilean law — only reconcile CL projects. CL is the
  // platform default when `country` is absent (CLAUDE.md compliance target is
  // Chile, and the onboarding wizard does NOT persist a `country` field on the
  // project doc — see onboarding.ts), so a missing field MUST resolve to CL or
  // the cron would never reconcile any real project. A spurious obligation on a
  // genuinely non-CL doc is benign: it is a calm internal reminder that never
  // blocks anything and is never pushed to an organism.
  const country = typeof project.country === 'string' ? project.country : 'CL';
  if (country !== 'CL') {
    result.skippedNonChile = true;
    return result;
  }

  const workersCount =
    typeof project.workersCount === 'number' && Number.isFinite(project.workersCount)
      ? project.workersCount
      : null;
  if (workersCount == null || workersCount <= 0) {
    result.skippedNoHeadcount = true;
    return result;
  }

  const sectorId =
    typeof project.metadata?.sectorId === 'string' ? project.metadata.sectorId : null;
  const siiCode =
    typeof project.metadata?.codigoActividadSii === 'number'
      ? project.metadata.codigoActividadSii
      : null;

  // Reconstruct the SAME seed input onboarding used so deterministic ids line
  // up — the reconcile is idempotent against the original onboarding seeds.
  const { obligationSeeds } = buildProjectSeeds({
    projectId,
    siiCode,
    sectorId,
    workerCount: workersCount,
    pack: CL_PACK,
    now: now(),
  });

  const existingSnap = await db
    .collection('projects')
    .doc(projectId)
    .collection(SUBCOLLECTION)
    .get();
  const existingIds = new Set<string>(existingSnap.docs.map((d) => d.id));

  const { toCreate, alreadyPresent } = reconcileObligationSeeds(obligationSeeds, existingIds);
  result.alreadyPresent = alreadyPresent.length;
  if (toCreate.length === 0) return result;

  const batch = db.batch();
  const obligations = db.collection('projects').doc(projectId).collection(SUBCOLLECTION);
  for (const seed of toCreate) {
    batch.set(obligations.doc(seed.id), seed.doc);
  }
  await batch.commit();
  result.created = toCreate.map((s) => s.id);

  logger.info('[legal-reconcile] obligations materialised', {
    projectId,
    workersCount,
    created: result.created.length,
  });

  return result;
}
