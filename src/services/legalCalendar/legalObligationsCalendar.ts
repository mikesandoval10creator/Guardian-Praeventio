// Praeventio Guard — Sprint 39 Fase J.2: Calendario Obligaciones Legales.
//
// Cierra: Documento usuario "Recomendaciones nuevas §56"
//
// Cada año, las empresas chilenas tienen obligaciones recurrentes:
//   - Auditorías ISO 45001 (anuales)
//   - Mediciones ambientales (DS 594: ruido 24m, sílice 12m, calor anual)
//   - Renovación capacitaciones (altura R1 cada 2 años, etc.)
//   - Reuniones CPHS (mensuales)
//   - Reportes mutualidad
//   - Simulacros (semestral DS 132)
//   - DIAT/DIEP (al ocurrir, no cíclico)
//
// Este servicio genera el calendario anual + alertas pre-vencimiento.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ObligationKind =
  | 'audit'
  | 'env_measurement'
  | 'training_renewal'
  | 'cphs_meeting'
  | 'mutualidad_report'
  | 'drill'
  | 'medical_exam'
  | 'document_renewal'
  | 'permit_renewal';

export type RecurrencePattern =
  | 'monthly'
  | 'quarterly'
  | 'biannual'
  | 'annual'
  | 'biennial';

export interface LegalObligation {
  id: string;
  kind: ObligationKind;
  label: string;
  /** Normativa que la exige. */
  legalCitation: string;
  /** Patrón de repetición. */
  recurrence: RecurrencePattern;
  /** Días antes para alertar. */
  alertLeadDays: number;
  /** Próxima fecha calculada. */
  nextDueAt: string;
}

const RECURRENCE_DAYS: Record<RecurrencePattern, number> = {
  monthly: 30,
  quarterly: 91,
  biannual: 183,
  annual: 365,
  biennial: 730,
};

// ────────────────────────────────────────────────────────────────────────
// Catalog de obligaciones canónicas chilenas
// ────────────────────────────────────────────────────────────────────────

interface ObligationTemplate {
  kind: ObligationKind;
  label: string;
  legalCitation: string;
  recurrence: RecurrencePattern;
  alertLeadDays: number;
}

export const STANDARD_OBLIGATIONS: ObligationTemplate[] = [
  {
    kind: 'cphs_meeting',
    label: 'Reunión mensual CPHS',
    legalCitation: 'DS 54 art. 24',
    recurrence: 'monthly',
    alertLeadDays: 7,
  },
  {
    kind: 'env_measurement',
    label: 'Medición ambiental ruido (DS 594 art. 75)',
    legalCitation: 'DS 594 + Protocolo PREXOR',
    recurrence: 'biennial',
    alertLeadDays: 60,
  },
  {
    kind: 'env_measurement',
    label: 'Medición ambiental sílice respirable',
    legalCitation: 'DS 594 art. 60 + Protocolo MINSAL Sílice',
    recurrence: 'annual',
    alertLeadDays: 60,
  },
  {
    kind: 'env_measurement',
    label: 'Medición ambiental TLV-TWA químicos',
    legalCitation: 'DS 594 art. 60',
    recurrence: 'annual',
    alertLeadDays: 30,
  },
  {
    kind: 'training_renewal',
    label: 'Renovación trabajo en altura R1',
    legalCitation: 'DS 594 art. 53',
    recurrence: 'biennial',
    alertLeadDays: 45,
  },
  {
    kind: 'training_renewal',
    label: 'Renovación capacitación rescate confinados',
    legalCitation: 'DS 132 + Protocolo MINSAL',
    recurrence: 'biennial',
    alertLeadDays: 45,
  },
  {
    kind: 'drill',
    label: 'Simulacro evacuación general',
    legalCitation: 'DS 132 + Plan Emergencia',
    recurrence: 'biannual',
    alertLeadDays: 21,
  },
  {
    kind: 'drill',
    label: 'Simulacro brigada incendio',
    legalCitation: 'DS 132',
    recurrence: 'biannual',
    alertLeadDays: 21,
  },
  {
    kind: 'medical_exam',
    label: 'Examen ocupacional anual trabajadores expuestos',
    legalCitation: 'DS 109 + Ley 16.744',
    recurrence: 'annual',
    alertLeadDays: 30,
  },
  {
    kind: 'audit',
    label: 'Auditoría ISO 45001 anual',
    legalCitation: 'ISO 45001 cláusula 9.2',
    recurrence: 'annual',
    alertLeadDays: 60,
  },
  {
    kind: 'mutualidad_report',
    label: 'Reporte estadísticas accidentabilidad',
    legalCitation: 'Ley 16.744 + Circular SUSESO',
    recurrence: 'quarterly',
    alertLeadDays: 14,
  },
];

// ────────────────────────────────────────────────────────────────────────
// Calendar generation
// ────────────────────────────────────────────────────────────────────────

export interface CalendarEntry extends LegalObligation {
  /** Si está dentro de la ventana de alerta. */
  isInAlertWindow: boolean;
  /** Días hasta nextDueAt. */
  daysUntilDue: number;
  /** Si ya venció. */
  isOverdue: boolean;
}

export function computeCalendar(
  obligations: LegalObligation[],
  now: Date = new Date(),
): CalendarEntry[] {
  const nowMs = now.getTime();
  return obligations
    .map((o) => {
      const dueMs = Date.parse(o.nextDueAt);
      const daysUntilDue = Math.floor((dueMs - nowMs) / 86_400_000);
      return {
        ...o,
        daysUntilDue,
        isInAlertWindow: daysUntilDue >= 0 && daysUntilDue <= o.alertLeadDays,
        isOverdue: daysUntilDue < 0,
      };
    })
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

/**
 * Avanza un evento al siguiente ciclo (al marcar completado).
 */
export function advanceObligation(o: LegalObligation): LegalObligation {
  const nextMs = Date.parse(o.nextDueAt) + RECURRENCE_DAYS[o.recurrence] * 86_400_000;
  return { ...o, nextDueAt: new Date(nextMs).toISOString() };
}

/**
 * Bootstrap inicial: a partir de las plantillas, genera obligations
 * con primera fecha calculada desde hoy.
 */
export function bootstrapCalendar(
  templates: ObligationTemplate[],
  startFrom: Date = new Date(),
): LegalObligation[] {
  return templates.map((t, i) => ({
    id: `legal-obl-${i}-${t.kind}`,
    kind: t.kind,
    label: t.label,
    legalCitation: t.legalCitation,
    recurrence: t.recurrence,
    alertLeadDays: t.alertLeadDays,
    nextDueAt: new Date(
      startFrom.getTime() + RECURRENCE_DAYS[t.recurrence] * 86_400_000,
    ).toISOString(),
  }));
}

export interface CalendarSummary {
  totalObligations: number;
  overdue: number;
  inAlertWindow: number;
  byKind: Record<ObligationKind, number>;
  nextUpcoming?: CalendarEntry;
}

export function summarizeCalendar(entries: CalendarEntry[]): CalendarSummary {
  const byKind: Partial<Record<ObligationKind, number>> = {};
  let overdue = 0;
  let inAlert = 0;
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.isOverdue) overdue += 1;
    if (e.isInAlertWindow) inAlert += 1;
  }
  const future = entries.filter((e) => !e.isOverdue);
  const next = future[0];
  return {
    totalObligations: entries.length,
    overdue,
    inAlertWindow: inAlert,
    byKind: byKind as Record<ObligationKind, number>,
    nextUpcoming: next,
  };
}
