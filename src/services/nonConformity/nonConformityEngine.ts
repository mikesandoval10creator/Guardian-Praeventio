// Praeventio Guard — Sprint 49: No Conformidades engine.
//
// Closes: doc §196-199 — NC lifecycle, NC↔CorrectiveAction linkage,
// automatic stage evaluation, root-cause pattern bulk classification.
//
// Complementary to (does NOT replace) `src/services/pdca/pdcaCycle.ts`,
// which models the PDCA business semantics. This engine focuses on:
//   - explicit NC↔action linkage records (immutable, append-only)
//   - automatic stage transition rules (open → investigating → ...)
//   - bulk pattern classification by `rootCauseKind` for trending
//
// Deterministic. No LLM. Pure functions.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type NonConformitySource =
  | 'audit'
  | 'inspection'
  | 'incident'
  | 'self_report'
  | 'external_audit'
  | 'client_complaint';

export type NonConformitySeverity = 'minor' | 'major' | 'critical';

export type NonConformityStatus =
  | 'open'
  | 'investigating'
  | 'action_planned'
  | 'closed'
  | 'efficacy_reviewed';

export interface NonConformity {
  id: string;
  source: NonConformitySource;
  /** ISO-8601 timestamp. */
  detectedAt: string;
  description: string;
  severity: NonConformitySeverity;
  status: NonConformityStatus;
  /** Optional root-cause taxonomy tag for pattern detection. */
  rootCauseKind?: string;
  /** Linked corrective action IDs (multi-link supported). */
  correctiveActionIds?: string[];
  /** ISO-8601 — when at least one investigator was assigned. */
  investigationStartedAt?: string;
  /** ISO-8601 — when an action plan was attached. */
  actionPlannedAt?: string;
  /** ISO-8601 — closure timestamp. */
  closedAt?: string;
  /** ISO-8601 — efficacy review (long-term). */
  efficacyReviewedAt?: string;
}

export interface CorrectiveActionRef {
  id: string;
  ownerUid: string;
  /** ISO-8601. */
  createdAt: string;
}

export interface NcActionLink {
  ncId: string;
  actionId: string;
  /** ISO-8601 timestamp of link creation. */
  linkedAt: string;
}

export interface PatternBucket {
  rootCauseKind: string;
  count: number;
  ncIds: string[];
  /** Average severity weight (minor=1, major=2, critical=3). */
  severityIndex: number;
}

// ────────────────────────────────────────────────────────────────────────
// linkNcToAction
// ────────────────────────────────────────────────────────────────────────

/**
 * Creates a NC↔action linkage record and returns a NEW NC instance with
 * the action id appended. Idempotent: linking the same action twice is a
 * no-op on the NC side but still returns the link record.
 */
export function linkNcToAction(
  nc: NonConformity,
  action: CorrectiveActionRef,
  now: string = new Date().toISOString(),
): { nc: NonConformity; link: NcActionLink } {
  const existing = nc.correctiveActionIds ?? [];
  const alreadyLinked = existing.includes(action.id);
  const updated: NonConformity = alreadyLinked
    ? nc
    : {
        ...nc,
        correctiveActionIds: [...existing, action.id],
        actionPlannedAt: nc.actionPlannedAt ?? now,
        status: nc.status === 'open' || nc.status === 'investigating' ? 'action_planned' : nc.status,
      };
  const link: NcActionLink = {
    ncId: nc.id,
    actionId: action.id,
    linkedAt: now,
  };
  return { nc: updated, link };
}

// ────────────────────────────────────────────────────────────────────────
// evaluateNcCycleStage
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns the stage the NC SHOULD be in, derived from its timestamps and
 * linkages. Useful to reconcile drifted persisted state vs. evidence.
 *
 * Precedence (highest first):
 *   efficacyReviewedAt  → 'efficacy_reviewed'
 *   closedAt            → 'closed'
 *   actionPlannedAt OR has linked actions → 'action_planned'
 *   investigationStartedAt              → 'investigating'
 *   default                               → 'open'
 */
export function evaluateNcCycleStage(nc: NonConformity): NonConformityStatus {
  if (nc.efficacyReviewedAt) return 'efficacy_reviewed';
  if (nc.closedAt) return 'closed';
  if (nc.actionPlannedAt || (nc.correctiveActionIds && nc.correctiveActionIds.length > 0)) {
    return 'action_planned';
  }
  if (nc.investigationStartedAt) return 'investigating';
  return 'open';
}

// ────────────────────────────────────────────────────────────────────────
// bulkClassifyByPattern
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<NonConformitySeverity, number> = {
  minor: 1,
  major: 2,
  critical: 3,
};

/**
 * Buckets NCs by `rootCauseKind` and returns top patterns sorted by:
 *   1. count (desc)
 *   2. severityIndex (desc) as tiebreaker
 *   3. rootCauseKind alphabetical (stable tiebreaker)
 *
 * NCs without `rootCauseKind` are grouped under 'unclassified'.
 */
export function bulkClassifyByPattern(
  ncs: NonConformity[],
  opts?: { top?: number },
): PatternBucket[] {
  const buckets = new Map<string, { ids: string[]; sevSum: number }>();
  for (const nc of ncs) {
    const key = nc.rootCauseKind && nc.rootCauseKind.trim() !== '' ? nc.rootCauseKind : 'unclassified';
    const bucket = buckets.get(key) ?? { ids: [], sevSum: 0 };
    bucket.ids.push(nc.id);
    bucket.sevSum += SEVERITY_WEIGHT[nc.severity];
    buckets.set(key, bucket);
  }

  const out: PatternBucket[] = [];
  for (const [rootCauseKind, b] of buckets.entries()) {
    out.push({
      rootCauseKind,
      count: b.ids.length,
      ncIds: [...b.ids],
      severityIndex: b.ids.length > 0 ? b.sevSum / b.ids.length : 0,
    });
  }

  out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.severityIndex !== a.severityIndex) return b.severityIndex - a.severityIndex;
    return a.rootCauseKind.localeCompare(b.rootCauseKind);
  });

  return typeof opts?.top === 'number' && opts.top >= 0 ? out.slice(0, opts.top) : out;
}
