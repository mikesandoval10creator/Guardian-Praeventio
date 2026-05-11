// Praeventio Guard — Sprint 39 Fase L.2: Radar de Normalización del Desvío.
//
// Cierra: Documento usuario "§284-286" — Top usuario #2
//
// Detecta cuando una práctica insegura se repite tanto que parece
// normal. Opera sobre la cola de `exceptionEngine`: si un mismo
// requisito recibe demasiadas excepciones, escala a gerencia y
// sugiere revisar el procedimiento.
//
// Reglas (§285-286):
//   - >3 excepciones del mismo subject en 7d → escalar a gerencia
//   - >10 excepciones del mismo procedure en 30d → "revisar
//     procedimiento, posible irrealismo"
//   - >5 excepciones del mismo workerUid en 14d → patrón individual
//   - Aprobaciones del mismo approverUid >15 en 7d → posible firma
//     automática sin lectura
//
// Determinístico, sin LLM. Recibe la lista de excepciones + ventana
// temporal y devuelve detecciones priorizadas.

import type {
  ExceptionRecord,
  ExceptionDomain,
} from '../exceptions/exceptionEngine.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type NormalizationPatternKind =
  | 'same_subject_repeated'      // mismo trabajador/EPP/equipo siempre
  | 'same_procedure_overruled'   // mismo dominio (procedimiento) saturado
  | 'same_worker_chronic'        // un trabajador acumula muchas excepciones
  | 'approver_signing_streak'    // un aprobador firma demasiado seguido
  | 'category_drift';            // categoría con tendencia de aumento

export type NormalizationSeverity = 'info' | 'warning' | 'critical';

export interface NormalizationPattern {
  kind: NormalizationPatternKind;
  severity: NormalizationSeverity;
  description: string;
  /** IDs de excepciones involucradas (para drill-down). */
  exceptionIds: string[];
  /** El "actor" detrás del patrón (workerUid, approverUid, domain, ...). */
  subjectKey: string;
  /** Acción sugerida. */
  suggestedAction: string;
  /** Si debe escalar a gerencia automáticamente. */
  escalateToManagement: boolean;
}

export interface RadarInput {
  exceptions: ExceptionRecord[];
  /** ISO-8601 — el "ahora" para la ventana de cálculo. */
  now: string;
}

// ────────────────────────────────────────────────────────────────────────
// Thresholds (curados — ajustables vía PR)
// ────────────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  /** §285: >3 excepciones del mismo subject en 7d → escalar. */
  sameSubjectIn7d: 3,
  /** §286: >10 excepciones del mismo dominio en 30d → revisar procedimiento. */
  sameDomainIn30d: 10,
  /** Pattern individual: >5 excepciones del mismo trabajador en 14d. */
  sameWorkerIn14d: 5,
  /** Approver-streak: >15 aprobaciones del mismo en 7d. */
  approverIn7d: 15,
  /** Category drift: 50% más excepciones en última semana vs promedio mensual. */
  driftMultiplier: 1.5,
};

const DAY_MS = 86_400_000;

// ────────────────────────────────────────────────────────────────────────
// Detection helpers
// ────────────────────────────────────────────────────────────────────────

function inWindow(approvedAt: string, nowMs: number, windowDays: number): boolean {
  return nowMs - Date.parse(approvedAt) <= windowDays * DAY_MS;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = keyFn(i);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  }
  return m;
}

// ────────────────────────────────────────────────────────────────────────
// Main detector
// ────────────────────────────────────────────────────────────────────────

export function buildNormalizationRadar(input: RadarInput): NormalizationPattern[] {
  const nowMs = Date.parse(input.now);
  const patterns: NormalizationPattern[] = [];

  const exceptions7d = input.exceptions.filter((e) => inWindow(e.approvedAt, nowMs, 7));
  const exceptions14d = input.exceptions.filter((e) => inWindow(e.approvedAt, nowMs, 14));
  const exceptions30d = input.exceptions.filter((e) => inWindow(e.approvedAt, nowMs, 30));

  // §285: mismo subject (kind+id) > N en 7d
  const bySubject = groupBy(
    exceptions7d,
    (e) => `${e.subjectRef.kind}:${e.subjectRef.id}`,
  );
  for (const [key, exs] of bySubject) {
    if (exs.length > THRESHOLDS.sameSubjectIn7d) {
      patterns.push({
        kind: 'same_subject_repeated',
        severity: 'critical',
        description: `${key} recibió ${exs.length} excepciones en los últimos 7 días.`,
        exceptionIds: exs.map((e) => e.id),
        subjectKey: key,
        suggestedAction: 'Escalar a gerencia/prevention lead. Posible problema sistémico con el sujeto.',
        escalateToManagement: true,
      });
    }
  }

  // §286: mismo dominio (procedimiento) saturado en 30d
  const byDomain = groupBy(exceptions30d, (e) => e.domain);
  for (const [domain, exs] of byDomain) {
    if (exs.length > THRESHOLDS.sameDomainIn30d) {
      patterns.push({
        kind: 'same_procedure_overruled',
        severity: 'warning',
        description: `Dominio "${domain}" recibió ${exs.length} excepciones en 30d. El procedimiento podría ser irreal en terreno.`,
        exceptionIds: exs.map((e) => e.id),
        subjectKey: domain,
        suggestedAction: `Revisar procedimiento ${domain}: ¿es ejecutable? ¿faltan recursos? ¿hay alternativa más segura?`,
        escalateToManagement: true,
      });
    }
  }

  // Same worker chronic en 14d (solo si subject.kind === 'WORKER')
  const byWorker = groupBy(
    exceptions14d.filter((e) => e.subjectRef.kind === 'WORKER'),
    (e) => e.subjectRef.id,
  );
  for (const [uid, exs] of byWorker) {
    if (exs.length > THRESHOLDS.sameWorkerIn14d) {
      patterns.push({
        kind: 'same_worker_chronic',
        severity: 'warning',
        description: `Trabajador ${uid} acumula ${exs.length} excepciones en 14d.`,
        exceptionIds: exs.map((e) => e.id),
        subjectKey: uid,
        suggestedAction: 'Reunión 1:1 para entender si faltan recursos / training / aptitud médica.',
        escalateToManagement: false,
      });
    }
  }

  // Approver-streak en 7d
  const byApprover = groupBy(exceptions7d, (e) => e.approvedByUid);
  for (const [approverUid, exs] of byApprover) {
    if (exs.length > THRESHOLDS.approverIn7d) {
      patterns.push({
        kind: 'approver_signing_streak',
        severity: 'warning',
        description: `Aprobador ${approverUid} firmó ${exs.length} excepciones en 7d — verifica lectura real.`,
        exceptionIds: exs.map((e) => e.id),
        subjectKey: approverUid,
        suggestedAction: 'Auditar firmas: ¿hay revisión real o firma automática? Revisar tiempo medio entre firmas.',
        escalateToManagement: true,
      });
    }
  }

  // Category drift: semana actual vs promedio mensual
  // Comparamos contar(7d últimos) vs contar(30d) / 4 por categoría/dominio
  for (const [domain, exs30] of byDomain) {
    const exs7 = exs30.filter((e) => inWindow(e.approvedAt, nowMs, 7));
    const weeklyAvg = exs30.length / 4;
    if (exs7.length > weeklyAvg * THRESHOLDS.driftMultiplier && exs7.length >= 3) {
      patterns.push({
        kind: 'category_drift',
        severity: 'info',
        description: `Dominio "${domain}" tendencia ascendente: ${exs7.length} esta semana vs promedio ${weeklyAvg.toFixed(1)}.`,
        exceptionIds: exs7.map((e) => e.id),
        subjectKey: domain,
        suggestedAction: 'Monitorear próximas 2 semanas. Si continúa, abrir revisión de causa raíz sistémica.',
        escalateToManagement: false,
      });
    }
  }

  // Orden por severidad
  const severityOrder: Record<NormalizationSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  patterns.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return patterns;
}

export interface RadarSummary {
  totalPatterns: number;
  byKind: Record<NormalizationPatternKind, number>;
  bySeverity: Record<NormalizationSeverity, number>;
  pendingEscalations: number;
}

export function summarizeRadar(patterns: NormalizationPattern[]): RadarSummary {
  const byKind: Partial<Record<NormalizationPatternKind, number>> = {};
  const bySeverity: Record<NormalizationSeverity, number> = { critical: 0, warning: 0, info: 0 };
  let pendingEscalations = 0;
  for (const p of patterns) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    bySeverity[p.severity] += 1;
    if (p.escalateToManagement) pendingEscalations += 1;
  }
  return {
    totalPatterns: patterns.length,
    byKind: byKind as Record<NormalizationPatternKind, number>,
    bySeverity,
    pendingEscalations,
  };
}

/** Helper para tests / UI: ¿algún patrón requiere escalamiento? */
export function hasUrgentPattern(patterns: NormalizationPattern[]): boolean {
  return patterns.some((p) => p.escalateToManagement);
}

/** Listado de dominios canonicos por si caller quiere filtrar la UI. */
export const KNOWN_DOMAINS: ExceptionDomain[] = [
  'training_gap',
  'epp_expired',
  'permit_pending',
  'document_expired',
  'medical_fitness_pending',
  'equipment_inspection',
  'staffing_gap',
  'other',
];
