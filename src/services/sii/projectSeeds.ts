/**
 * Épica Rubros SII — slice 3: pure seed builder for new projects.
 *
 * When a project is created with a `codigoActividadSii` (and the derived
 * GP-* sector) plus an estimated dotación, the preventive profile from
 * slice 1 must become REAL initial project records, not just a computed
 * view:
 *
 *  - `riskSeeds` are shaped for the top-level `nodes` collection — the SAME
 *    collection the IPER module lists (src/pages/Matrix.tsx via
 *    src/hooks/useRiskEngine.ts, filtered by `projectId` and
 *    `type === NodeType.RISK`), so they are visible on day one.
 *  - `obligationSeeds` are shaped for `projects/{pid}/legal_obligations` —
 *    the calendar consumed by src/pages/LegalCalendar.tsx through
 *    src/services/legalCalendar/legalCalendarStore.ts.
 *
 * Design rules (rule #9 style — pure calc module):
 *  - Deterministic and side-effect free: every output is derived from the
 *    explicit inputs (including `now`); no Date.now(), no randomness, no IO.
 *  - IDEMPOTENT ids: `seed-risk-{sectorId}-{n}-{projectId}` for nodes
 *    (the `nodes` collection is global, so the projectId suffix prevents
 *    cross-project collisions) and `seed-obl-{sectorId|base}-{slug}` for
 *    obligations (already namespaced by the project subcollection).
 *    Re-running the creation flow overwrites the same docs — no duplicates.
 *  - Seeds are MARKED (`origin: 'sii_seed'`, `seedSource: <siiCode>`) so
 *    users can always distinguish rubro suggestions from their own data.
 *  - NO fabricated legal classification: risk seeds carry no probabilidad /
 *    severidad — `criticidad: 'Por evaluar'` says honestly that the company
 *    still has to run its own IPER evaluation (DS 44/2024 art. 21). The
 *    truthy placeholder also keeps useRiskEngine's AI auto-healer from
 *    rewriting the seeds (it only targets nodes with falsy criticidad).
 *  - Headcount thresholds are read from the `pack` argument — never
 *    hardcoded (same contract as `obligacionesPorDotacion`).
 *
 * Identity (`metadata.authorId`) is intentionally NOT set here: the server
 * route stamps it from the verified token (identity-from-token, F3).
 */
import { NodeType } from '../../types';
import type { CountryPack } from '../normativa/countryPacks';
import {
  getRiskProfileForSector,
  obligacionesPorDotacion,
} from './industryRiskProfile';

export interface RiskSeedNodeDoc {
  type: string; // NodeType.RISK ('Riesgo') — the IPER module's filter value
  title: string;
  description: string;
  tags: string[];
  connections: string[];
  projectId: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    origin: 'sii_seed';
    seedSource: number;
    sectorId: string;
    status: 'approved';
    criticidad: 'Por evaluar';
    source: 'SII_SEED';
  };
}

export interface RiskSeed {
  /** Deterministic Firestore doc id (idempotent re-seeding). */
  id: string;
  doc: RiskSeedNodeDoc;
}

/** LegalObligation contract of legalObligationsCalendar.ts + seed markers. */
export interface ObligationSeedDoc {
  id: string;
  kind: 'cphs_meeting' | 'document_renewal';
  label: string;
  legalCitation: string;
  recurrence: 'monthly' | 'annual';
  alertLeadDays: number;
  nextDueAt: string;
  origin: 'sii_seed';
  seedSource: number | null;
}

export interface ObligationSeed {
  /** Deterministic doc id inside projects/{pid}/legal_obligations. */
  id: string;
  doc: ObligationSeedDoc;
}

export interface ProjectSeedsInput {
  projectId: string;
  /** Verified SII code (catalogue-validated server-side) or null. */
  siiCode: number | null;
  /** GP-* sector derived from the catalogue (never client-supplied) or null. */
  sectorId: string | null;
  /** Estimated dotación from the wizard, or null when not answered. */
  workerCount: number | null;
  /** Country pack whose thresholds drive the dotación obligations. */
  pack: CountryPack;
  /** Explicit clock so the function stays pure/deterministic. */
  now: Date;
}

export interface ProjectSeeds {
  riskSeeds: RiskSeed[];
  obligationSeeds: ObligationSeed[];
}

const DAY_MS = 86_400_000;

/** Plazo razonable para regularizar obligaciones de constitución (30 días). */
const SETUP_GRACE_DAYS = 30;

function buildRiskSeeds(input: ProjectSeedsInput): RiskSeed[] {
  const { projectId, siiCode, sectorId, now } = input;
  if (sectorId == null || siiCode == null) return [];

  const profile = getRiskProfileForSector(sectorId);
  const iso = now.toISOString();

  return profile.riesgosTipicos.map((riesgo, index) => ({
    id: `seed-risk-${profile.sectorId}-${index + 1}-${projectId}`,
    doc: {
      type: NodeType.RISK,
      title: riesgo,
      description:
        `Riesgo típico del rubro ${profile.sectorId} (semilla generada desde el ` +
        `código de actividad SII ${siiCode} al crear el proyecto). ` +
        'Evaluar la probabilidad y severidad en la matriz IPER y definir las ' +
        'medidas de control correspondientes (DS 44/2024 art. 21).',
      tags: ['SII_SEED', 'IPER_BASE', profile.sectorId],
      connections: [],
      projectId,
      createdAt: iso,
      updatedAt: iso,
      metadata: {
        origin: 'sii_seed',
        seedSource: siiCode,
        sectorId: profile.sectorId,
        status: 'approved',
        criticidad: 'Por evaluar',
        source: 'SII_SEED',
      },
    },
  }));
}

function buildObligationSeeds(input: ProjectSeedsInput): ObligationSeed[] {
  const { siiCode, sectorId, workerCount, pack, now } = input;
  if (workerCount == null || workerCount <= 0) return [];

  const dotacion = obligacionesPorDotacion(workerCount, pack);
  const { comiteRequiredAtWorkers, preventionDeptRequiredAtWorkers, monthlyMeetingsRequired } =
    pack.thresholds;

  const idPrefix = `seed-obl-${sectorId ?? 'base'}`;
  const setupDue = new Date(now.getTime() + SETUP_GRACE_DAYS * DAY_MS).toISOString();

  const seeds: ObligationSeed[] = [];
  const push = (doc: Omit<ObligationSeedDoc, 'origin' | 'seedSource'>) => {
    seeds.push({ id: doc.id, doc: { ...doc, origin: 'sii_seed', seedSource: siiCode } });
  };

  if (dotacion.delegadoSstRequired) {
    push({
      id: `${idPrefix}-delegado-sst`,
      kind: 'document_renewal',
      label:
        `Designar delegado(a) de Seguridad y Salud en el Trabajo — dotación bajo ` +
        `${comiteRequiredAtWorkers} personas trabajadoras (revisión anual de vigencia).`,
      legalCitation: 'DS 44/2024',
      recurrence: 'annual',
      alertLeadDays: 14,
      nextDueAt: setupDue,
    });
  }

  if (dotacion.cphsRequired) {
    push({
      id: `${idPrefix}-cphs-constitucion`,
      kind: 'cphs_meeting',
      label:
        `Constituir Comité Paritario de Higiene y Seguridad (CPHS) — dotación de ` +
        `${comiteRequiredAtWorkers} o más personas trabajadoras (renovación cada 2 años; ` +
        'control anual de vigencia).',
      legalCitation: 'Ley 16.744 art. 66 + DS 44/2024 (ex DS 54, derogado 01-02-2025)',
      recurrence: 'annual',
      alertLeadDays: 14,
      nextDueAt: setupDue,
    });
    if (monthlyMeetingsRequired) {
      push({
        id: `${idPrefix}-cphs-sesion-mensual`,
        kind: 'cphs_meeting',
        label: 'Reunión mensual del CPHS con acta de cada sesión.',
        legalCitation: 'DS 44/2024 art. 16 (ex DS 54, derogado 01-02-2025) — sesión mensual del Comité Paritario',
        recurrence: 'monthly',
        alertLeadDays: 7,
        nextDueAt: setupDue,
      });
    }
  }

  if (dotacion.preventionDeptRequired) {
    push({
      id: `${idPrefix}-depto-prevencion`,
      kind: 'document_renewal',
      label:
        `Contar con Departamento de Prevención de Riesgos a cargo de un(a) experto(a) ` +
        `en prevención — dotación de ${preventionDeptRequiredAtWorkers} o más personas ` +
        'trabajadoras (revisión anual).',
      legalCitation: 'Ley 16.744 art. 66',
      recurrence: 'annual',
      alertLeadDays: 30,
      nextDueAt: setupDue,
    });
  }

  return seeds;
}

/**
 * Builds the initial project records for a rubro + dotación. Pure and total:
 * no sector → no risk seeds; no headcount → no obligation seeds.
 */
export function buildProjectSeeds(input: ProjectSeedsInput): ProjectSeeds {
  return {
    riskSeeds: buildRiskSeeds(input),
    obligationSeeds: buildObligationSeeds(input),
  };
}

export interface ObligationReconcileResult {
  /**
   * Seeds whose deterministic id is NOT yet in the project — i.e. the
   * obligations a headcount change just made mandatory.
   */
  toCreate: ObligationSeed[];
  /** Ids already present in the project (idempotent no-op). */
  alreadyPresent: string[];
}

/**
 * Diffs freshly-computed dotación obligation seeds against the obligation ids
 * that already exist in the project's `legal_obligations` subcollection, and
 * returns ONLY the seeds whose deterministic id is missing — i.e. the
 * obligations a headcount change just made mandatory (crossing the pack
 * thresholds: 25 → CPHS, 100 → Departamento de Prevención for the CL pack).
 *
 * Onboarding seeds dotación obligations once, from the *estimated* headcount
 * (`onboarding.ts` → `buildProjectSeeds`). When the real roster later grows past
 * a threshold, nothing re-evaluates — so the CPHS / Departamento de Prevención
 * obligation is never materialised and the reminder cron never alerts. This
 * function is the pure core of that re-evaluation; the server route owns the
 * single Firestore read (existing ids) and the idempotent upsert of `toCreate`.
 *
 * Pure / IO-free (rule #9 style): the existence check is supplied as a Set so
 * this stays deterministic and mutation-testable.
 *
 * NEVER proposes deletions. An obligation no longer produced for the current
 * dotación (e.g. the delegado-SST seed once the project crosses into CPHS
 * territory, or every obligation if the roster shrinks) is intentionally left
 * untouched: superseding a legal obligation is an admin/supervisor decision, not
 * an automatic side effect, and `firestore.rules` already gates
 * `legal_obligations` deletes behind isAdmin()/isSupervisor().
 */
export function reconcileObligationSeeds(
  seeds: readonly ObligationSeed[],
  existingIds: ReadonlySet<string>,
): ObligationReconcileResult {
  const toCreate: ObligationSeed[] = [];
  const alreadyPresent: string[] = [];
  for (const seed of seeds) {
    if (existingIds.has(seed.id)) alreadyPresent.push(seed.id);
    else toCreate.push(seed);
  }
  return { toCreate, alreadyPresent };
}
