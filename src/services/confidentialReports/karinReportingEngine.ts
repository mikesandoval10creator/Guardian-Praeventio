// Praeventio Guard — Sprint 49: Ley Karin Reporting Engine.
//
// Closes: doc §211-212 — confidential reports + Ley 21.643 (Chile 2024).
//
// Complementary to `confidentialReportsService.ts` (which handles
// anonymization, hashing, and persistence). This engine focuses on:
//   - Karin-specific validation (reporting deadline, anonymity rules)
//   - Investigator assignment respecting independence rules
//     (no same team, opt-in same-gender for sexual harassment, etc.)
//   - Retaliation pattern detection within the 90-day post-report window
//
// Critical Ley Karin Chile 2024 rules:
//   - Max 30-day investigation window from report acknowledgement.
//   - Reports beyond 30 days from event are validated but flagged.
//   - Total confidentiality: reporter identity gated by encryption.
//
// Deterministic. No LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type KarinReportKind =
  | 'harassment'
  | 'psychological'
  | 'sexual'
  | 'workplace_violence'
  | 'discrimination';

export type KarinReportStatus =
  | 'received'
  | 'under_investigation'
  | 'evidence_gathering'
  | 'resolved'
  | 'unfounded'
  | 'retaliation_check';

export interface KarinReport {
  id: string;
  reporterAlias: string;
  /** Encrypted reporter UID, optional if anonymous. */
  reporterUidEncrypted?: string;
  kind: KarinReportKind;
  summary: string;
  witnessesAlias?: string[];
  evidenceArtifacts?: string[];
  /** ISO-8601 timestamp of report submission. */
  reportedAt: string;
  /** ISO-8601 timestamp of the underlying event (if known). */
  eventOccurredAt?: string;
  status: KarinReportStatus;
  /** If true, allows skipping `reporterAlias` requirement. */
  anonymous?: boolean;
  /** Reporter gender (optional, opt-in only). */
  reporterGender?: 'female' | 'male' | 'other' | 'unspecified';
  /** Whether reporter requested same-gender investigator. */
  preferSameGenderInvestigator?: boolean;
}

export interface InvestigatorCandidate {
  uid: string;
  teamId: string;
  reportingChainUids: string[];
  gender?: 'female' | 'male' | 'other';
  /** True if the investigator belongs to a separate org unit. */
  organizationallyIndependent: boolean;
}

export interface AssignmentRules {
  /** The team id of the reporter — investigator must be in a different team. */
  reporterTeamId: string;
  /** The supervisor chain of the reporter — investigator must not be in it. */
  reporterReportingChainUids: string[];
  /** ISO-8601 — used to validate org independence. */
  now: string;
}

export interface AssignmentResult {
  assignedUid: string | null;
  rejected: { uid: string; reason: string }[];
}

export type PostReportEventKind =
  | 'salary_change'
  | 'shift_change_negative'
  | 'role_demoted'
  | 'isolation'
  | 'increased_scrutiny'
  | 'task_reassignment';

export interface PostReportEvent {
  kind: PostReportEventKind;
  /** Negative = unfavorable to the reporter. */
  direction: 'negative' | 'positive' | 'neutral';
  /** ISO-8601 timestamp of the event. */
  occurredAt: string;
}

export interface RetaliationFlag {
  kind: PostReportEventKind;
  occurredAt: string;
  daysSinceReport: number;
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const KARIN_MAX_REPORTING_DELAY_DAYS = 30;
const KARIN_RETALIATION_WINDOW_DAYS = 90;

// ────────────────────────────────────────────────────────────────────────
// validateKarinReport
// ────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function diffDays(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.abs((b - a) / 86_400_000);
}

/**
 * Validates a Karin report:
 *   - REJECT if reporting deadline passed (>30 days from event) AND
 *     `anonymous` is false (anonymous late reports are allowed but warned).
 *   - REJECT if `reporterAlias` is empty AND `anonymous` is false.
 *   - REJECT if `summary` is empty.
 *   - WARN if eventOccurredAt is missing.
 */
export function validateKarinReport(report: KarinReport): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Alias requirement.
  if (!report.anonymous && (!report.reporterAlias || report.reporterAlias.trim() === '')) {
    errors.push('reporter_alias_required_for_non_anonymous');
  }
  if (!report.summary || report.summary.trim() === '') {
    errors.push('summary_required');
  }
  if (!report.eventOccurredAt) {
    warnings.push('event_timestamp_missing');
  } else {
    const days = diffDays(report.eventOccurredAt, report.reportedAt);
    if (days > KARIN_MAX_REPORTING_DELAY_DAYS) {
      if (!report.anonymous) {
        errors.push('reporting_deadline_passed');
      } else {
        warnings.push('reporting_deadline_passed_anonymous');
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ────────────────────────────────────────────────────────────────────────
// assignInvestigator
// ────────────────────────────────────────────────────────────────────────

/**
 * Picks the first candidate satisfying independence rules:
 *   - Must NOT be in the same team as the reporter.
 *   - Must NOT be in the reporter's reporting chain.
 *   - Must be `organizationallyIndependent`.
 *   - For `sexual` kind with `preferSameGenderInvestigator`, candidate
 *     gender must match `reporterGender`.
 * Returns the chosen uid and the list of rejected candidates with reasons.
 */
export function assignInvestigator(
  report: KarinReport,
  candidates: InvestigatorCandidate[],
  rules: AssignmentRules,
): AssignmentResult {
  const rejected: { uid: string; reason: string }[] = [];
  for (const c of candidates) {
    if (c.teamId === rules.reporterTeamId) {
      rejected.push({ uid: c.uid, reason: 'same_team_as_reporter' });
      continue;
    }
    if (rules.reporterReportingChainUids.includes(c.uid)) {
      rejected.push({ uid: c.uid, reason: 'in_reporter_reporting_chain' });
      continue;
    }
    if (!c.organizationallyIndependent) {
      rejected.push({ uid: c.uid, reason: 'not_organizationally_independent' });
      continue;
    }
    if (
      report.kind === 'sexual' &&
      report.preferSameGenderInvestigator &&
      report.reporterGender &&
      report.reporterGender !== 'unspecified' &&
      c.gender !== report.reporterGender
    ) {
      rejected.push({ uid: c.uid, reason: 'gender_mismatch_sexual_harassment' });
      continue;
    }
    return { assignedUid: c.uid, rejected };
  }
  return { assignedUid: null, rejected };
}

// ────────────────────────────────────────────────────────────────────────
// detectRetaliationPatterns
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns retaliation flags: events with `direction='negative'` occurring
 * within `KARIN_RETALIATION_WINDOW_DAYS` after `report.reportedAt`.
 */
export function detectRetaliationPatterns(
  report: KarinReport,
  postReportEvents: PostReportEvent[],
): RetaliationFlag[] {
  const flags: RetaliationFlag[] = [];
  const reportTs = Date.parse(report.reportedAt);
  if (Number.isNaN(reportTs)) return flags;

  for (const ev of postReportEvents) {
    if (ev.direction !== 'negative') continue;
    const evTs = Date.parse(ev.occurredAt);
    if (Number.isNaN(evTs)) continue;
    if (evTs < reportTs) continue;
    const days = (evTs - reportTs) / 86_400_000;
    if (days <= KARIN_RETALIATION_WINDOW_DAYS) {
      flags.push({ kind: ev.kind, occurredAt: ev.occurredAt, daysSinceReport: days });
    }
  }
  flags.sort((a, b) => a.daysSinceReport - b.daysSinceReport);
  return flags;
}
