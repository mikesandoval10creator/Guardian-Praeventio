// Praeventio Guard — Sprint K: Métricas organizacionales.
//
// Cierra: Documento usuario "§278-283"
//
// Captura señales del COMPORTAMIENTO del sistema, no del trabajador:
//   - Silos preventivos: módulos que no comparten datos (§278)
//   - Fricción administrativa: dónde se atascan procesos (§279)
//   - Tiempo promedio de cierre por tipo de brecha (§280)
//   - Brechas crónicas: problemas que cierran y vuelven (§281)
//   - Presión operacional: tareas vencidas + ausencias + clima + nocturno (§283)
//
// Todo determinístico. Recibe estado consolidado, devuelve métricas.

// ────────────────────────────────────────────────────────────────────────
// Silos detection (§278)
// ────────────────────────────────────────────────────────────────────────

export interface ModuleSignal {
  /** Nombre del módulo. */
  module: string;
  /** Eventos relevantes que generó en la ventana. */
  outboundEvents: number;
  /** Eventos relevantes que CONSUMIÓ (debería). */
  inboundEvents: number;
  /** Módulos con los que debería estar conectado. */
  expectedPeers: string[];
  /** Módulos con los que realmente intercambia. */
  actualPeers: string[];
}

export interface SiloReport {
  module: string;
  /** Score 0-100 — más alto = más aislado. */
  siloScore: number;
  /** Módulos esperados que NO están conectados. */
  missingPeers: string[];
  /** Razón principal en lenguaje humano. */
  explanation: string;
}

export function detectSilos(signals: ModuleSignal[]): SiloReport[] {
  return signals.map((s) => {
    const missingPeers = s.expectedPeers.filter((p) => !s.actualPeers.includes(p));
    const peerCoverage = s.expectedPeers.length === 0 ? 1 : s.actualPeers.length / s.expectedPeers.length;
    const ratio = s.outboundEvents > 0 ? s.inboundEvents / s.outboundEvents : 0;
    // siloScore: 50% gap en peer-coverage + 50% gap en bidirectional flow
    const peerGap = (1 - peerCoverage) * 50;
    const flowGap = (1 - Math.min(ratio, 1)) * 50;
    const siloScore = Math.round(peerGap + flowGap);
    const explanation =
      missingPeers.length > 0
        ? `${s.module} no comparte datos con ${missingPeers.join(', ')}.`
        : ratio < 0.3
          ? `${s.module} emite información pero consume muy poco (ratio ${ratio.toFixed(2)}).`
          : `${s.module} bien conectado.`;
    return { module: s.module, siloScore, missingPeers, explanation };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Administrative friction (§279)
// ────────────────────────────────────────────────────────────────────────

export type AdminProcess =
  | 'doc_approval'
  | 'action_closure'
  | 'incident_review'
  | 'certificate_validation'
  | 'contractor_onboarding';

export interface AdminFlowSample {
  process: AdminProcess;
  /** Identificador del flujo. */
  flowId: string;
  /** Cuando se inició. */
  startedAt: string;
  /** Cuando se completó (si lo hizo). */
  completedAt?: string;
  /** Si quedó atascado por más del SLA esperado. */
  isStuck: boolean;
}

/** SLA esperado por proceso (horas). */
const PROCESS_SLA_HOURS: Record<AdminProcess, number> = {
  doc_approval: 48,
  action_closure: 96,
  incident_review: 24,
  certificate_validation: 24,
  contractor_onboarding: 168,
};

export interface FrictionReport {
  process: AdminProcess;
  totalFlows: number;
  completedFlows: number;
  /** Tiempo medio en horas (solo completados). */
  avgCompletionHours: number;
  /** % de flujos atascados. */
  stuckPercent: number;
  /** SLA esperado (referencia). */
  slaHours: number;
  /** True si avg > SLA × 1.5 o stuck > 30%. */
  hasFriction: boolean;
}

export function buildFrictionReport(samples: AdminFlowSample[]): FrictionReport[] {
  const processes = new Set(samples.map((s) => s.process));
  const reports: FrictionReport[] = [];

  for (const process of processes) {
    const own = samples.filter((s) => s.process === process);
    const completed = own.filter((s) => s.completedAt);
    const totalDurationHours = completed.reduce((sum, s) => {
      const h = (Date.parse(s.completedAt!) - Date.parse(s.startedAt)) / 3_600_000;
      return sum + h;
    }, 0);
    const avgCompletionHours =
      completed.length > 0 ? Math.round(totalDurationHours / completed.length) : 0;
    const stuck = own.filter((s) => s.isStuck).length;
    const stuckPercent = own.length > 0 ? Math.round((stuck / own.length) * 100) : 0;
    const slaHours = PROCESS_SLA_HOURS[process];
    const hasFriction = avgCompletionHours > slaHours * 1.5 || stuckPercent > 30;
    reports.push({
      process,
      totalFlows: own.length,
      completedFlows: completed.length,
      avgCompletionHours,
      stuckPercent,
      slaHours,
      hasFriction,
    });
  }
  return reports.sort((a, b) => (b.hasFriction ? 1 : 0) - (a.hasFriction ? 1 : 0));
}

// ────────────────────────────────────────────────────────────────────────
// Closure time by gap type (§280)
// ────────────────────────────────────────────────────────────────────────

export type GapKind = 'critical_action' | 'document_observation' | 'inspection_finding' | 'training_gap';

export interface ClosedGap {
  kind: GapKind;
  openedAt: string;
  closedAt: string;
}

export interface ClosureTimeReport {
  kind: GapKind;
  count: number;
  avgDays: number;
  medianDays: number;
  /** Días que tomaron el slowest 10%. */
  p90Days: number;
}

export function buildClosureTimeReport(gaps: ClosedGap[]): ClosureTimeReport[] {
  const kinds = new Set(gaps.map((g) => g.kind));
  return [...kinds].map((kind) => {
    const own = gaps.filter((g) => g.kind === kind);
    const days = own
      .map((g) => (Date.parse(g.closedAt) - Date.parse(g.openedAt)) / 86_400_000)
      .sort((a, b) => a - b);
    const avg = days.reduce((a, b) => a + b, 0) / days.length;
    const median = days[Math.floor(days.length / 2)];
    const p90 = days[Math.floor(days.length * 0.9)] ?? days[days.length - 1];
    return {
      kind,
      count: own.length,
      avgDays: Math.round(avg * 10) / 10,
      medianDays: Math.round(median * 10) / 10,
      p90Days: Math.round(p90 * 10) / 10,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Chronic gaps (§281)
// ────────────────────────────────────────────────────────────────────────

export interface GapHistory {
  /** Lugar donde se detectó (ej: "bodega norte"). */
  location: string;
  /** Categoría (ej: "orden y aseo"). */
  category: string;
  /** ISO-8601 de la inspección. */
  inspectionAt: string;
  /** True si se encontró el problema. */
  foundProblem: boolean;
}

export interface ChronicGap {
  location: string;
  category: string;
  /** Total inspecciones consideradas. */
  inspectionCount: number;
  /** Inspecciones consecutivas en que apareció el problema. */
  consecutiveDetections: number;
  /** % de inspecciones donde aparece. */
  prevalencePercent: number;
  /** True si apareció en ≥3 inspecciones consecutivas O >70% prevalencia. */
  isChronic: boolean;
}

export function detectChronicGaps(history: GapHistory[]): ChronicGap[] {
  const groups = new Map<string, GapHistory[]>();
  for (const h of history) {
    const key = `${h.location}::${h.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(h);
  }

  const out: ChronicGap[] = [];
  for (const [key, samples] of groups) {
    const sorted = [...samples].sort(
      (a, b) => Date.parse(a.inspectionAt) - Date.parse(b.inspectionAt),
    );
    let maxConsecutive = 0;
    let currentStreak = 0;
    let foundCount = 0;
    for (const s of sorted) {
      if (s.foundProblem) {
        currentStreak += 1;
        foundCount += 1;
        if (currentStreak > maxConsecutive) maxConsecutive = currentStreak;
      } else {
        currentStreak = 0;
      }
    }
    const prevalencePercent = Math.round((foundCount / sorted.length) * 100);
    const isChronic = maxConsecutive >= 3 || prevalencePercent > 70;
    const [location, category] = key.split('::');
    out.push({
      location,
      category,
      inspectionCount: sorted.length,
      consecutiveDetections: maxConsecutive,
      prevalencePercent,
      isChronic,
    });
  }
  return out.filter((c) => c.isChronic).sort((a, b) => b.consecutiveDetections - a.consecutiveDetections);
}

// ────────────────────────────────────────────────────────────────────────
// Operational pressure (§283)
// ────────────────────────────────────────────────────────────────────────

export interface PressureSignals {
  overdueTasks: number;
  overtimeHoursWeekTotal: number;
  minorIncidentsLast7d: number;
  absenteeismRate: number; // 0-1
  hasNightShift: boolean;
  hasAdverseWeather: boolean;
  totalActiveWorkers: number;
}

export interface PressureReport {
  pressureScore: number; // 0-100
  level: 'low' | 'medium' | 'high' | 'critical';
  topDrivers: string[];
}

export function computeOperationalPressure(signals: PressureSignals): PressureReport {
  let score = 0;
  const drivers: string[] = [];

  if (signals.overdueTasks > 5) {
    score += Math.min(signals.overdueTasks * 2, 25);
    drivers.push(`${signals.overdueTasks} tareas vencidas`);
  }
  if (signals.totalActiveWorkers > 0) {
    const overtimePerWorker = signals.overtimeHoursWeekTotal / signals.totalActiveWorkers;
    if (overtimePerWorker > 5) {
      score += 20;
      drivers.push(`Horas extra promedio ${overtimePerWorker.toFixed(1)}h/sem`);
    }
  }
  if (signals.minorIncidentsLast7d > 3) {
    score += 15;
    drivers.push(`${signals.minorIncidentsLast7d} incidentes menores en 7d`);
  }
  if (signals.absenteeismRate > 0.1) {
    score += 15;
    drivers.push(`Ausentismo ${(signals.absenteeismRate * 100).toFixed(0)}%`);
  }
  if (signals.hasNightShift) {
    score += 10;
    drivers.push('Turnos nocturnos activos');
  }
  if (signals.hasAdverseWeather) {
    score += 15;
    drivers.push('Condiciones climáticas adversas');
  }

  score = Math.min(score, 100);
  const level: PressureReport['level'] =
    score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { pressureScore: score, level, topDrivers: drivers.slice(0, 5) };
}
