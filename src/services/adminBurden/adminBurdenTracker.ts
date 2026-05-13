// Praeventio Guard — Sprint 51 §259: Tracker de carga administrativa.
//
// Cierra §259 de la 2da tanda usuario: cuantificar cuántas horas pierde el
// prevencionista en papeleo (data entry, reportes manuales, firmas en
// papel, exports PDF, etc.) versus trabajo real de prevención en terreno.
//
// 100% determinístico. Engine puro sin I/O. La fuente de los time entries
// puede ser: timer manual del prevencionista, inferencia heurística desde
// logs de acción de la app, o estimación auto-llenada por taxonomía.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Taxonomía de tareas administrativas que tradicionalmente consumen horas
 * del prevencionista sin aportar valor preventivo directo.
 */
export type AdminTaskKind =
  | 'data_entry'
  | 'manual_report'
  | 'signature_collection'
  | 'duplicate_filing'
  | 'phone_followup'
  | 'manual_pdf_export'
  | 'spreadsheet_update'
  | 'inbox_triage';

export interface AdminTaskTimeEntry {
  taskKind: AdminTaskKind;
  workerUid: string;
  timeSpentMinutes: number;
  /** ISO week 'YYYY-Wnn' (p.ej. '2026-W19'). */
  periodWeek: string;
  /** Si la tarea es reemplazable por una automatización conocida. */
  automatable: boolean;
}

export type BurdenVerdict = 'healthy' | 'concerning' | 'critical' | 'extreme';

export interface AdminBurdenReport {
  /** Promedio total minutos/semana (entre todas las semanas observadas). */
  totalMinutesPerWeek: number;
  /** Equivalente horas/mes (assume 4.33 semanas). */
  totalHoursPerMonth: number;
  /**
   * Porcentaje de jornada semanal base (40 h = 2400 min).
   * Si >100, indica overflow respecto a jornada estándar.
   */
  pctOfWorkWeek: number;
  byKind: Array<{ kind: AdminTaskKind; minutes: number; pct: number }>;
  /** Minutos/semana en tareas marcadas como automatables. */
  automatableMinutesPerWeek: number;
  /**
   * Ranking de workers por carga administrativa promedio semanal, desc.
   */
  workerRanking: Array<{ workerUid: string; minutesPerWeek: number; pct: number }>;
  verdict: BurdenVerdict;
}

// ────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────

const WORK_WEEK_MINUTES = 2400; // 40 h * 60 min
const WEEKS_PER_MONTH = 4.33;

const ALL_KINDS: AdminTaskKind[] = [
  'data_entry',
  'manual_report',
  'signature_collection',
  'duplicate_filing',
  'phone_followup',
  'manual_pdf_export',
  'spreadsheet_update',
  'inbox_triage',
];

export class AdminBurdenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminBurdenValidationError';
  }
}

function validateEntry(e: AdminTaskTimeEntry): void {
  if (!ALL_KINDS.includes(e.taskKind)) {
    throw new AdminBurdenValidationError(`taskKind inválido: ${e.taskKind}`);
  }
  if (!e.workerUid || typeof e.workerUid !== 'string') {
    throw new AdminBurdenValidationError('workerUid requerido');
  }
  if (
    typeof e.timeSpentMinutes !== 'number' ||
    !Number.isFinite(e.timeSpentMinutes) ||
    e.timeSpentMinutes < 0
  ) {
    throw new AdminBurdenValidationError('timeSpentMinutes debe ser >= 0');
  }
  if (!/^\d{4}-W\d{2}$/.test(e.periodWeek)) {
    throw new AdminBurdenValidationError(
      `periodWeek debe ser ISO 'YYYY-Wnn', recibido: ${e.periodWeek}`,
    );
  }
}

function verdictFromPct(pct: number): BurdenVerdict {
  if (pct < 20) return 'healthy';
  if (pct < 40) return 'concerning';
  if (pct < 60) return 'critical';
  return 'extreme';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Construye reporte agregado de carga administrativa.
 *
 * - Promedia por número de semanas distintas observadas (no entries totales).
 * - Si entries vacío → reporte cero con verdict 'healthy'.
 */
export function buildAdminBurdenReport(
  entries: AdminTaskTimeEntry[],
): AdminBurdenReport {
  for (const e of entries) validateEntry(e);

  if (entries.length === 0) {
    return {
      totalMinutesPerWeek: 0,
      totalHoursPerMonth: 0,
      pctOfWorkWeek: 0,
      byKind: [],
      automatableMinutesPerWeek: 0,
      workerRanking: [],
      verdict: 'healthy',
    };
  }

  const weeks = new Set(entries.map((e) => e.periodWeek));
  const weekCount = weeks.size;

  const totalMinutes = entries.reduce((s, e) => s + e.timeSpentMinutes, 0);
  const totalMinutesPerWeek = totalMinutes / weekCount;

  // By kind
  const byKindMap = new Map<AdminTaskKind, number>();
  for (const e of entries) {
    byKindMap.set(e.taskKind, (byKindMap.get(e.taskKind) ?? 0) + e.timeSpentMinutes);
  }
  const byKind = Array.from(byKindMap.entries())
    .map(([kind, total]) => {
      const minutes = total / weekCount;
      return {
        kind,
        minutes: round1(minutes),
        pct: totalMinutesPerWeek > 0 ? round1((minutes / totalMinutesPerWeek) * 100) : 0,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  // Automatable
  const automatableMinutes = entries
    .filter((e) => e.automatable)
    .reduce((s, e) => s + e.timeSpentMinutes, 0);
  const automatableMinutesPerWeek = round1(automatableMinutes / weekCount);

  // Worker ranking
  const workerMap = new Map<string, number>();
  for (const e of entries) {
    workerMap.set(e.workerUid, (workerMap.get(e.workerUid) ?? 0) + e.timeSpentMinutes);
  }
  const workerRanking = Array.from(workerMap.entries())
    .map(([workerUid, total]) => {
      const minutesPerWeek = total / weekCount;
      return {
        workerUid,
        minutesPerWeek: round1(minutesPerWeek),
        pct: round1((minutesPerWeek / WORK_WEEK_MINUTES) * 100),
      };
    })
    .sort((a, b) => b.minutesPerWeek - a.minutesPerWeek);

  const pctOfWorkWeek = round1((totalMinutesPerWeek / WORK_WEEK_MINUTES) * 100);
  const totalHoursPerMonth = round1((totalMinutesPerWeek * WEEKS_PER_MONTH) / 60);

  return {
    totalMinutesPerWeek: round1(totalMinutesPerWeek),
    totalHoursPerMonth,
    pctOfWorkWeek,
    byKind,
    automatableMinutesPerWeek,
    workerRanking,
    // Verdict basado en el peor worker (no en promedio) — un único worker
    // ahogado en papeleo ya es señal de alarma, no se debe diluir.
    verdict: verdictFromPct(
      workerRanking.length > 0 ? workerRanking[0].pct : pctOfWorkWeek,
    ),
  };
}

/**
 * Helper: lista canónica de todos los tipos de tarea administrativa.
 */
export function listAdminTaskKinds(): readonly AdminTaskKind[] {
  return ALL_KINDS;
}
