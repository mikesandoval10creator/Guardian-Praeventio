// Praeventio Guard — Sprint 49: Retaliation Protection Detector.
//
// Closes: doc §213 — protección frente a represalias post-denuncia.
//
// Computes a risk score 0..100 from signed retaliation signals observed
// after a confidential report was filed, and recommends protective
// actions when the score crosses configured thresholds.
//
// Deterministic. No LLM. Pure functions.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RetaliationSignalKind =
  | 'salary_change'
  | 'shift_change_negative'
  | 'role_demoted'
  | 'isolation'
  | 'increased_scrutiny'
  | 'task_reassignment';

export type SignalSeverity = 'low' | 'medium' | 'high';

export interface RetaliationSignal {
  kind: RetaliationSignalKind;
  severity: SignalSeverity;
  /** ISO-8601 timestamp of observation. */
  observedAt: string;
  reporterUid: string;
  supervisorUid: string;
}

export interface RetaliationRiskAssessment {
  reporterUid: string;
  score: number;
  level: 'low' | 'moderate' | 'high';
  signalCount: number;
  topKinds: RetaliationSignalKind[];
  /** Signals included in scoring (within evaluation window). */
  consideredSignals: RetaliationSignal[];
}

export interface ProtectiveAction {
  kind:
    | 'separate_from_supervisor'
    | 'transfer_team'
    | 'external_mediation'
    | 'legal_counsel_referral'
    | 'wellbeing_check_in'
    | 'monitoring_increase';
  rationale: string;
}

// ────────────────────────────────────────────────────────────────────────
// Weights
// ────────────────────────────────────────────────────────────────────────

const KIND_WEIGHT: Record<RetaliationSignalKind, number> = {
  salary_change: 25,
  role_demoted: 25,
  shift_change_negative: 15,
  isolation: 15,
  increased_scrutiny: 10,
  task_reassignment: 10,
};

const SEVERITY_MULTIPLIER: Record<SignalSeverity, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.4,
};

const HIGH_RISK_THRESHOLD = 70;
const MODERATE_RISK_THRESHOLD = 35;
const EVALUATION_WINDOW_DAYS = 90;

// ────────────────────────────────────────────────────────────────────────
// analyzeRetaliationRisk
// ────────────────────────────────────────────────────────────────────────

/**
 * Score = clamp(0..100, sum( weight(kind) × multiplier(severity) ))
 * over signals occurring within EVALUATION_WINDOW_DAYS after the report.
 *
 * Levels:
 *   score ≥ 70 → high
 *   score ≥ 35 → moderate
 *   else      → low
 */
export function analyzeRetaliationRisk(
  reportFiledAt: string,
  signals: RetaliationSignal[],
  opts?: { evaluationWindowDays?: number },
): RetaliationRiskAssessment {
  const reportTs = Date.parse(reportFiledAt);
  const window = (opts?.evaluationWindowDays ?? EVALUATION_WINDOW_DAYS) * 86_400_000;
  const considered: RetaliationSignal[] = [];

  for (const s of signals) {
    const ts = Date.parse(s.observedAt);
    if (Number.isNaN(ts) || Number.isNaN(reportTs)) continue;
    if (ts < reportTs) continue;
    if (ts - reportTs > window) continue;
    considered.push(s);
  }

  let raw = 0;
  const kindCounts = new Map<RetaliationSignalKind, number>();
  for (const s of considered) {
    raw += KIND_WEIGHT[s.kind] * SEVERITY_MULTIPLIER[s.severity];
    kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1);
  }
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const level: RetaliationRiskAssessment['level'] =
    score >= HIGH_RISK_THRESHOLD ? 'high' : score >= MODERATE_RISK_THRESHOLD ? 'moderate' : 'low';

  const topKinds = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k]) => k);

  const reporterUid =
    considered.length > 0 ? considered[0].reporterUid : signals[0]?.reporterUid ?? '';

  return {
    reporterUid,
    score,
    level,
    signalCount: considered.length,
    topKinds,
    consideredSignals: considered,
  };
}

// ────────────────────────────────────────────────────────────────────────
// recommendProtectiveActions
// ────────────────────────────────────────────────────────────────────────

/**
 * Returns protective action recommendations ordered by urgency.
 * Rules:
 *   - level=high → separate_from_supervisor + transfer_team + external_mediation + legal_counsel_referral
 *   - level=moderate → wellbeing_check_in + monitoring_increase
 *   - level=low → wellbeing_check_in only
 *   - salary_change or role_demoted ALWAYS triggers legal_counsel_referral.
 */
export function recommendProtectiveActions(
  assessment: RetaliationRiskAssessment,
): ProtectiveAction[] {
  const out: ProtectiveAction[] = [];

  if (assessment.level === 'high') {
    out.push({
      kind: 'separate_from_supervisor',
      rationale: 'High retaliation risk — immediate operational separation.',
    });
    out.push({
      kind: 'transfer_team',
      rationale: 'High risk; offer reporter a transfer to an independent team.',
    });
    out.push({
      kind: 'external_mediation',
      rationale: 'Independent mediator required for resolution.',
    });
    out.push({
      kind: 'legal_counsel_referral',
      rationale: 'High risk — refer reporter to legal counsel.',
    });
  } else if (assessment.level === 'moderate') {
    out.push({
      kind: 'wellbeing_check_in',
      rationale: 'Moderate risk — schedule confidential wellbeing follow-up.',
    });
    out.push({
      kind: 'monitoring_increase',
      rationale: 'Moderate risk — track post-report signals for escalation.',
    });
  } else {
    out.push({
      kind: 'wellbeing_check_in',
      rationale: 'Low risk baseline check-in.',
    });
  }

  const hasMaterial =
    assessment.consideredSignals.some(
      (s) => s.kind === 'salary_change' || s.kind === 'role_demoted',
    );
  if (hasMaterial && !out.some((a) => a.kind === 'legal_counsel_referral')) {
    out.push({
      kind: 'legal_counsel_referral',
      rationale: 'Material employment change detected — refer to legal counsel.',
    });
  }

  return out;
}
