// Praeventio Guard — Sprint 49: PDCA Cycle Engine (multi-cycle projects).
//
// Closes: doc §195 + §200 — PDCA at the PROJECT scope (multi-cycle),
// complementary to `pdcaCycle.ts` which models PDCA at the NC scope.
//
// A PDCAProject contains a sequence of PDCAEntry stages (one per
// plan/do/check/act per cycle). When a cycle completes (act done with
// evidence), a new cycle starts — this is the "continuous improvement"
// loop of ISO 45001 / Deming.
//
// Deterministic. No LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type PDCAStage = 'plan' | 'do' | 'check' | 'act';

export interface PDCAEntry {
  kind: PDCAStage;
  activityId: string;
  notes: string;
  ownerUid: string;
  /** ISO-8601. */
  startedAt: string;
  /** ISO-8601 — set when the stage finishes. */
  completedAt?: string;
  /** Evidence URIs (photos, docs, signed forms). */
  evidence?: string[];
  /** Optional efficacy score after `act` stage, 0..100. */
  efficacyScore?: number;
}

export interface PDCAProject {
  id: string;
  currentStage: PDCAStage;
  stages: PDCAEntry[];
  cycleNumber: number;
}

export interface CycleSummary {
  cycleNumber: number;
  /** Days spent in each stage; missing entries omitted. */
  daysByStage: Partial<Record<PDCAStage, number>>;
  /** Number of evidence artifacts attached across the cycle. */
  evidenceCount: number;
  /** Average efficacyScore across `act` entries, or null if none. */
  avgEfficacyScore: number | null;
  /** Stages completed in this cycle. */
  completedStages: PDCAStage[];
}

export interface StuckProject {
  projectId: string;
  currentStage: PDCAStage;
  /** Days since the current stage started. */
  daysSinceStart: number;
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

const STAGE_ORDER: PDCAStage[] = ['plan', 'do', 'check', 'act'];

function nextStage(current: PDCAStage): PDCAStage {
  const idx = STAGE_ORDER.indexOf(current);
  return STAGE_ORDER[(idx + 1) % STAGE_ORDER.length];
}

function diffDays(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / 86_400_000);
}

/** Returns the most recent entry of the given stage in the project. */
function findLastEntry(project: PDCAProject, stage: PDCAStage): PDCAEntry | undefined {
  for (let i = project.stages.length - 1; i >= 0; i--) {
    if (project.stages[i].kind === stage) return project.stages[i];
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────
// advanceStage
// ────────────────────────────────────────────────────────────────────────

export interface AdvanceResult {
  project: PDCAProject;
  advanced: boolean;
  reason?: string;
}

/**
 * Advances the project to the next stage IF:
 *   - the current stage's last entry has `completedAt`, AND
 *   - the `completionEvidence` is non-empty (≥1 evidence URI).
 *
 * After completing `act`, the cycle increments (cycleNumber+1) and a new
 * `plan` stage begins. Returns a new immutable project.
 */
export function advanceStage(
  project: PDCAProject,
  completionEvidence: string[],
  now: string = new Date().toISOString(),
): AdvanceResult {
  const last = findLastEntry(project, project.currentStage);
  if (!last) {
    return { project, advanced: false, reason: 'no_entry_for_current_stage' };
  }
  if (!last.completedAt) {
    return { project, advanced: false, reason: 'current_stage_not_completed' };
  }
  if (!completionEvidence || completionEvidence.length === 0) {
    return { project, advanced: false, reason: 'no_evidence_attached' };
  }

  const merged: PDCAEntry = {
    ...last,
    evidence: [...(last.evidence ?? []), ...completionEvidence],
  };

  // Replace the last entry with merged evidence.
  const updatedStages = [...project.stages];
  for (let i = updatedStages.length - 1; i >= 0; i--) {
    if (updatedStages[i].kind === project.currentStage) {
      updatedStages[i] = merged;
      break;
    }
  }

  const isCycleEnd = project.currentStage === 'act';
  const next = nextStage(project.currentStage);

  // Append a new opening entry for the next stage.
  const newEntry: PDCAEntry = {
    kind: next,
    activityId: `${project.id}-cycle-${isCycleEnd ? project.cycleNumber + 1 : project.cycleNumber}-${next}`,
    notes: '',
    ownerUid: last.ownerUid,
    startedAt: now,
  };

  const advanced: PDCAProject = {
    id: project.id,
    currentStage: next,
    stages: [...updatedStages, newEntry],
    cycleNumber: isCycleEnd ? project.cycleNumber + 1 : project.cycleNumber,
  };
  return { project: advanced, advanced: true };
}

// ────────────────────────────────────────────────────────────────────────
// detectStuckProjects
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns projects whose current stage has not been updated in
 * `stallThresholdDays` days. A project is "stuck" if its CURRENT stage's
 * latest entry has no `completedAt` AND was started ≥threshold days ago.
 */
export function detectStuckProjects(
  projects: PDCAProject[],
  now: string,
  stallThresholdDays = 14,
): StuckProject[] {
  const out: StuckProject[] = [];
  for (const p of projects) {
    const last = findLastEntry(p, p.currentStage);
    if (!last) continue;
    if (last.completedAt) continue;
    const days = diffDays(last.startedAt, now);
    if (days >= stallThresholdDays) {
      out.push({
        projectId: p.id,
        currentStage: p.currentStage,
        daysSinceStart: days,
      });
    }
  }
  out.sort((a, b) => b.daysSinceStart - a.daysSinceStart);
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// summarizeCycle
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns metrics for the current cycle: days per stage, evidence count,
 * and average efficacy score across `act` entries.
 */
export function summarizeCycle(project: PDCAProject): CycleSummary {
  const completedStages: PDCAStage[] = [];
  const daysByStage: Partial<Record<PDCAStage, number>> = {};
  let evidenceCount = 0;
  const efficacyScores: number[] = [];

  for (const entry of project.stages) {
    if (entry.completedAt) {
      const days = diffDays(entry.startedAt, entry.completedAt);
      daysByStage[entry.kind] = Math.max(daysByStage[entry.kind] ?? 0, days);
      completedStages.push(entry.kind);
    }
    if (entry.evidence) evidenceCount += entry.evidence.length;
    if (entry.kind === 'act' && typeof entry.efficacyScore === 'number') {
      efficacyScores.push(entry.efficacyScore);
    }
  }

  const avgEfficacyScore =
    efficacyScores.length > 0
      ? efficacyScores.reduce((a, b) => a + b, 0) / efficacyScores.length
      : null;

  return {
    cycleNumber: project.cycleNumber,
    daysByStage,
    evidenceCount,
    avgEfficacyScore,
    completedStages,
  };
}
