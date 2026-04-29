// Praeventio Guard — Round 17 (R5 agent): pure curriculum aggregator.
//
// SCOPE
//   Turn raw `audit_logs` + `gamification_scores` rows into a shape the
//   PortableCurriculum page can render directly. Pure functions only —
//   the Firestore reads happen at the page boundary so this module stays
//   trivially unit-testable and side-effect-free.
//
// FILTERS
//   • Audit-log events are kept only when their `action` starts with one
//     of: `safety.`, `training.`, `curriculum.`, `gamification.`. We do
//     NOT include `auth.*`, `admin.*`, `billing.*` etc. — those are
//     audit-trail noise from the worker's perspective and would clutter
//     the curriculum view.
//   • Events are sorted by timestamp DESCENDING (newest first) and
//     truncated to the 20 most-recent rows. Rows whose timestamp can't
//     be parsed sort to the end.
//
// DERIVATIONS
//   • xp     = Σ points per gamification_scores row, falling back to
//              `bestScore` when `points` is absent (legacy schema).
//   • level  = floor(xp / 1000) + 1, clamped to [1, 99].
//   • completedTrainings = audit rows whose action matches
//              /^training\..+\.completed$/.
//   • criticalAssessments = audit rows whose action matches
//              /^safety\.(iper|ergonomic)\..+/ AND whose
//              details.level === 'CRITICO' OR details.score >= 11.
//   • safeHours = Σ details.durationMin for rows whose action starts with
//              `safety.`, divided by 60. Rounded to one decimal so the UI
//              shows e.g. "2.5 h" rather than a 17-digit float artifact.
//              Rows with missing/non-finite/non-positive `durationMin` are
//              skipped (defensive — a stray 0 or NaN can't shrink the
//              total). Round 18 (R5) closes the prior placeholder of 0.
//
// DESIGN NOTE
//   Inputs are typed as `unknown[]`-flavoured records so the caller can
//   pass Firestore docs straight from `getDocs(...)`.docs.map(d => d.data())
//   without extra ceremony. We defensively coerce numeric fields so a
//   stray null/NaN can't poison the aggregate.

export interface AuditLogRow {
  action: string;
  module?: string;
  timestamp?: string | number;
  userId?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GamificationScoreRow {
  gameId?: string;
  points?: number;
  bestScore?: number;
  [key: string]: unknown;
}

export interface CurriculumHistoryEvent extends AuditLogRow {
  action: string;
}

export interface CurriculumStats {
  level: number;
  xp: number;
  completedTrainings: number;
  criticalAssessments: number;
  /**
   * Total prevention/safety hours logged by the worker (Σ durationMin / 60).
   * Sum is restricted to audit_logs whose action begins with `safety.` so
   * that ad-hoc training/curriculum events don't inflate the metric. Reported
   * to one decimal place.
   */
  safeHours: number;
}

export interface AggregatedCurriculumHistory {
  events: CurriculumHistoryEvent[];
  stats: CurriculumStats;
}

const RELEVANT_ACTION_PREFIX = /^(safety|training|curriculum|gamification)\./;
const COMPLETED_TRAINING = /^training\..+\.completed$/;
const CRITICAL_ASSESSMENT = /^safety\.(iper|ergonomic)\..+/;
const SAFETY_ACTION = /^safety\./;
const MAX_EVENTS = 20;
const XP_PER_LEVEL = 1000;
const MAX_LEVEL = 99;

function parseTimestamp(raw: unknown): number {
  if (raw == null) return Number.NEGATIVE_INFINITY;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  }
  return Number.NEGATIVE_INFINITY;
}

function isRelevantAction(action: unknown): action is string {
  return typeof action === 'string' && RELEVANT_ACTION_PREFIX.test(action);
}

function isCriticalAssessment(row: AuditLogRow): boolean {
  if (!CRITICAL_ASSESSMENT.test(row.action)) return false;
  const details = (row.details ?? {}) as Record<string, unknown>;
  if (details.level === 'CRITICO') return true;
  const score = Number(details.score);
  if (Number.isFinite(score) && score >= 11) return true;
  return false;
}

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Aggregate raw Firestore rows into the curriculum-page shape.
 *
 * Pure: no IO, no exceptions on malformed inputs (defensively coerces).
 */
export function aggregateUserHistory(
  auditLogs: AuditLogRow[],
  gamificationScores: GamificationScoreRow[],
): AggregatedCurriculumHistory {
  // Filter relevant actions and clone the rows so callers can't mutate
  // the aggregator output through their original references.
  const relevant: CurriculumHistoryEvent[] = (Array.isArray(auditLogs) ? auditLogs : [])
    .filter((row): row is AuditLogRow => !!row && isRelevantAction((row as any).action))
    .map((row) => ({ ...row, action: String(row.action) }));

  // Sort newest first; unparseable timestamps fall to the end.
  relevant.sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

  const events = relevant.slice(0, MAX_EVENTS);

  // XP — sum of (points ?? bestScore ?? 0), defensively coerced.
  let xp = 0;
  for (const score of Array.isArray(gamificationScores) ? gamificationScores : []) {
    if (!score) continue;
    const pts =
      score.points != null ? safeNumber(score.points) : safeNumber(score.bestScore);
    xp += pts;
  }
  if (!Number.isFinite(xp) || xp < 0) xp = 0;

  const rawLevel = Math.floor(xp / XP_PER_LEVEL) + 1;
  const level = Math.max(1, Math.min(MAX_LEVEL, rawLevel));

  let completedTrainings = 0;
  let criticalAssessments = 0;
  // safeHours uses the FULL filtered set (not just the `events` slice cap of
  // 20) — the user's lifetime total shouldn't silently drop the moment they
  // hit their 21st safety event.
  let safeMinutes = 0;
  for (const row of relevant) {
    if (COMPLETED_TRAINING.test(row.action)) completedTrainings += 1;
    if (isCriticalAssessment(row)) criticalAssessments += 1;
    if (SAFETY_ACTION.test(row.action)) {
      const dm = Number((row.details as Record<string, unknown> | undefined)?.durationMin);
      if (Number.isFinite(dm) && dm > 0) safeMinutes += dm;
    }
  }
  // Round to 1 decimal — keeps totals like "2.5 h" stable across renders
  // and avoids floating-point noise (0.30000000000000004 etc.).
  const safeHours = Math.round((safeMinutes / 60) * 10) / 10;

  return {
    events,
    stats: { level, xp, completedTrainings, criticalAssessments, safeHours },
  };
}
