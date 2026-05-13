// Praeventio Guard — Sprint 51 §118: Alertas reputacionales (incidentes
// públicos / prensa / RRSS / accidentes fatales).
//
// Dado un flujo de señales externas (noticias, RRSS, registros oficiales,
// reguladores, quejas comunitarias), agrupa por similitud + ventana
// temporal y produce alertas reputacionales con severidad calibrada y
// recomendación accionable.
//
// 100% determinístico. Sin LLM. El operador humano valida antes de
// activar comunicaciones públicas (directiva usuario §1: nunca push a
// medios sin decisión consciente del cliente).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ExternalSignalSource =
  | 'news'
  | 'social_media'
  | 'official_record'
  | 'regulator'
  | 'community_complaint';

export type SignalSentiment = 'negative' | 'neutral' | 'positive';
export type SignalReach = 'local' | 'regional' | 'national' | 'international';

export interface ExternalSignal {
  source: ExternalSignalSource;
  keyword: string;
  /** ISO timestamp. */
  publishedAt: string;
  url?: string;
  sentiment: SignalSentiment;
  reach: SignalReach;
  /** Optional flags for explicit precision. */
  flags?: {
    /** Fatal accident reported. */
    fatality?: boolean;
    /** Names a regulator action. */
    regulatorAction?: boolean;
  };
}

export type ReputationalSeverity =
  | 'info'
  | 'warning'
  | 'critical'
  | 'emergency_pr';

export type ReputationalRecommendation =
  | 'monitor'
  | 'prepare_statement'
  | 'escalate_pr_team'
  | 'pr_emergency_response';

export interface ReputationalAlert {
  id: string;
  /** Stable cluster key derived from normalized keyword. */
  clusterKey: string;
  severity: ReputationalSeverity;
  signals: ExternalSignal[];
  recommendation: ReputationalRecommendation;
  /** 0-100 weighted reach + volume + sentiment. */
  reachScore: number;
  /** Window covered (ISO). */
  windowFrom: string;
  windowTo: string;
  /** Human-readable rationale. */
  rationale: string;
}

export interface AnalyzeOptions {
  /** Cluster window in days. Default 7. */
  windowDays?: number;
  /** Override "now" for determinism in tests. */
  now?: () => Date;
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const REACH_WEIGHT: Record<SignalReach, number> = {
  local: 10,
  regional: 30,
  national: 70,
  international: 100,
};

const DEFAULT_WINDOW_DAYS = 7;

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function normalizeKeyword(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Token-based Jaccard similarity. */
function similarity(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

const SIMILARITY_THRESHOLD = 0.5;

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function maxReach(signals: ExternalSignal[]): SignalReach {
  const order: SignalReach[] = ['local', 'regional', 'national', 'international'];
  let best: SignalReach = 'local';
  for (const s of signals) {
    if (order.indexOf(s.reach) > order.indexOf(best)) best = s.reach;
  }
  return best;
}

function hasFatality(signals: ExternalSignal[]): boolean {
  return signals.some((s) => s.flags?.fatality === true);
}

function negativeCount(signals: ExternalSignal[]): number {
  return signals.filter((s) => s.sentiment === 'negative').length;
}

function clusterReachScore(signals: ExternalSignal[]): number {
  // Weighted: base = max reach weight; volume bonus up to +20; negative bonus up to +10.
  const base = REACH_WEIGHT[maxReach(signals)];
  const volumeBonus = Math.min(20, signals.length * 4);
  const negBonus = Math.min(10, negativeCount(signals) * 2);
  const fatalityBonus = hasFatality(signals) ? 15 : 0;
  return Math.min(100, base + volumeBonus + negBonus + fatalityBonus);
}

function decideSeverity(signals: ExternalSignal[]): ReputationalSeverity {
  const reach = maxReach(signals);
  const negatives = negativeCount(signals);
  const fatality = hasFatality(signals);

  // emergency_pr: international + fatality, OR any signal mentioning regulator
  // action + fatality.
  if (
    (reach === 'international' && fatality) ||
    (fatality && signals.some((s) => s.flags?.regulatorAction))
  ) {
    return 'emergency_pr';
  }

  // critical: ≥3 negatives nationally, or any fatality, or international negatives.
  if (
    (negatives >= 3 && (reach === 'national' || reach === 'international')) ||
    fatality ||
    (reach === 'international' && negatives >= 1)
  ) {
    return 'critical';
  }

  // warning: ≥2 negatives regional+, or any regulator action.
  if (
    (negatives >= 2 && (reach === 'regional' || reach === 'national')) ||
    signals.some((s) => s.flags?.regulatorAction)
  ) {
    return 'warning';
  }

  // info: 1 negative local OR mixed/positive signals.
  return 'info';
}

function recommendationFor(sev: ReputationalSeverity): ReputationalRecommendation {
  switch (sev) {
    case 'info':
      return 'monitor';
    case 'warning':
      return 'prepare_statement';
    case 'critical':
      return 'escalate_pr_team';
    case 'emergency_pr':
      return 'pr_emergency_response';
  }
}

function rationaleFor(
  sev: ReputationalSeverity,
  signals: ExternalSignal[],
  reach: SignalReach,
): string {
  const negatives = negativeCount(signals);
  const fatality = hasFatality(signals);
  const parts: string[] = [];
  parts.push(`${signals.length} señal(es) agrupada(s)`);
  parts.push(`alcance máximo: ${reach}`);
  parts.push(`${negatives} negativa(s)`);
  if (fatality) parts.push('reporta(n) fatalidad');
  parts.push(`→ severidad ${sev}`);
  return parts.join(', ');
}

// ────────────────────────────────────────────────────────────────────────
// Clustering
// ────────────────────────────────────────────────────────────────────────

interface Cluster {
  key: string;
  signals: ExternalSignal[];
}

function clusterSignals(
  signals: ExternalSignal[],
  windowDays: number,
): Cluster[] {
  // Sort by publishedAt asc.
  const sorted = [...signals].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );

  const clusters: Array<{ key: string; signals: ExternalSignal[]; centroidKeyword: string }> = [];

  for (const s of sorted) {
    const norm = normalizeKeyword(s.keyword);
    let placed = false;
    for (const c of clusters) {
      // Window check: signal must be within windowDays of any signal in cluster.
      const inWindow = c.signals.some(
        (cs) => daysBetween(cs.publishedAt, s.publishedAt) <= windowDays,
      );
      if (!inWindow) continue;
      const sim = similarity(norm, c.centroidKeyword);
      if (sim >= SIMILARITY_THRESHOLD) {
        c.signals.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ key: norm || 'unspecified', signals: [s], centroidKeyword: norm });
    }
  }

  return clusters.map((c) => ({ key: c.key, signals: c.signals }));
}

// ────────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────────

export function analyzeReputationalRisk(
  signals: ExternalSignal[],
  options: AnalyzeOptions = {},
): ReputationalAlert[] {
  if (signals.length === 0) return [];
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const clusters = clusterSignals(signals, windowDays);

  return clusters.map((c, idx) => {
    const severity = decideSeverity(c.signals);
    const recommendation = recommendationFor(severity);
    const reach = maxReach(c.signals);
    const reachScore = clusterReachScore(c.signals);
    const sortedDates = c.signals
      .map((s) => s.publishedAt)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    return {
      id: `repalert_${idx + 1}_${c.key.replace(/\s+/g, '_').slice(0, 32)}`,
      clusterKey: c.key,
      severity,
      signals: c.signals,
      recommendation,
      reachScore,
      windowFrom: sortedDates[0] ?? '',
      windowTo: sortedDates[sortedDates.length - 1] ?? '',
      rationale: rationaleFor(severity, c.signals, reach),
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Convenience aggregator (for dashboards)
// ────────────────────────────────────────────────────────────────────────

export interface ReputationalRiskSummary {
  alerts: ReputationalAlert[];
  highestSeverity: ReputationalSeverity;
  totalSignals: number;
  topRecommendation: ReputationalRecommendation;
}

const SEVERITY_ORDER: ReputationalSeverity[] = [
  'info',
  'warning',
  'critical',
  'emergency_pr',
];

export function summarizeReputationalRisk(
  signals: ExternalSignal[],
  options: AnalyzeOptions = {},
): ReputationalRiskSummary {
  const alerts = analyzeReputationalRisk(signals, options);
  let highest: ReputationalSeverity = 'info';
  for (const a of alerts) {
    if (SEVERITY_ORDER.indexOf(a.severity) > SEVERITY_ORDER.indexOf(highest)) {
      highest = a.severity;
    }
  }
  return {
    alerts,
    highestSeverity: highest,
    totalSignals: signals.length,
    topRecommendation: recommendationFor(highest),
  };
}
