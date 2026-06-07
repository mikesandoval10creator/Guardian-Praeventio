// Praeventio Guard — Sprint 39 Fase C.6: Horómetro → mantenimiento → calendario.
//
// Cierra: Plan Fase C.6 "Horómetro → mantenimiento → calendario".
//
// Trackea horas de operación acumuladas por máquina y emite alertas
// cuando se acerca o supera umbrales de mantenimiento. Aplicación:
// CAEX, grúas, compresores, generadores, vehículos pesados.
//
// 100% determinístico, sin LLM. El caller persiste cada update — este
// motor solo razona sobre los thresholds, próximas mantenciones y
// genera tasks futuras.
//
// Directiva de producto (2026-05-06): la app NUNCA bloquea maquinaria — solo
// RECOMIENDA científicamente. Por eso este motor emite una RECOMENDACIÓN de
// detener (`mandatoryOverdue`) cuando el ciclo obligatorio vence; la decisión
// operativa de detener/seguir es del supervisor con criterio técnico.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type MaintenanceThresholdKind = 'warning' | 'critical' | 'mandatory';

export interface MaintenanceThreshold {
  kind: MaintenanceThresholdKind;
  /** Horas a las que se dispara este threshold. */
  triggerAtHours: number;
  /** Acción recomendada cuando se cruza. */
  recommendedAction: string;
}

export interface MachineHorometer {
  machineId: string;
  /** Horas operadas acumuladas. */
  currentHours: number;
  /** Última mantención (horas en la que se hizo). */
  lastMaintenanceAtHours: number;
  /** ISO-8601 de la última mantención. */
  lastMaintenanceAt?: string;
  /** UID del responsable mantenimiento. */
  responsibleUid?: string;
}

export interface MaintenancePolicy {
  /** Ciclo en horas — la mantención se repite cada X horas. */
  cycleHours: number;
  /** Thresholds escalonados antes de cycleHours. */
  thresholds: MaintenanceThreshold[];
  /**
   * Si se escala a la recomendación más fuerte (detener y mantener) al superar
   * el threshold `mandatory`. NO bloquea el equipo — la app solo recomienda;
   * la decisión operativa es del supervisor (directiva: recomendar, no bloquear).
   */
  escalateOnMandatory: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Default policy presets (ajustables por máquina)
// ────────────────────────────────────────────────────────────────────────

export function buildDefaultPolicy(cycleHours: number): MaintenancePolicy {
  return {
    cycleHours,
    thresholds: [
      {
        kind: 'warning',
        triggerAtHours: Math.floor(cycleHours * 0.85),
        recommendedAction: 'Programar mantención preventiva en el calendario.',
      },
      {
        kind: 'critical',
        triggerAtHours: Math.floor(cycleHours * 0.95),
        recommendedAction: 'Mantención obligatoria en próximos 7 días.',
      },
      {
        kind: 'mandatory',
        triggerAtHours: cycleHours,
        recommendedAction:
          'Detener y completar la mantención obligatoria antes de seguir operando (recomendación técnica; la decisión operativa la toma el supervisor).',
      },
    ],
    escalateOnMandatory: true,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Status assessment
// ────────────────────────────────────────────────────────────────────────

export interface HorometerStatus {
  machineId: string;
  hoursSinceLastMaintenance: number;
  hoursUntilNextMaintenance: number;
  /** % del ciclo recorrido (0-100+). */
  cycleProgressPercent: number;
  /** Threshold crossed (ordenado por gravedad). null si nada. */
  triggeredThreshold: MaintenanceThreshold | null;
  /**
   * True si el ciclo obligatorio está vencido → RECOMENDACIÓN fuerte de detener
   * y mantener. NO es un bloqueo de hardware: la app recomienda, el supervisor
   * decide (directiva de producto).
   */
  mandatoryOverdue: boolean;
  /** Mensaje human-readable. */
  message: string;
}

export function assessHorometerStatus(
  horometer: MachineHorometer,
  policy: MaintenancePolicy,
): HorometerStatus {
  const hoursSinceLastMaintenance = Math.max(
    0,
    horometer.currentHours - horometer.lastMaintenanceAtHours,
  );
  const hoursUntilNextMaintenance = policy.cycleHours - hoursSinceLastMaintenance;
  const cycleProgressPercent = Math.round((hoursSinceLastMaintenance / policy.cycleHours) * 100);

  // Find highest triggered threshold
  let triggered: MaintenanceThreshold | null = null;
  // Sort ascending by triggerAtHours so we find the highest crossed
  const sorted = [...policy.thresholds].sort(
    (a, b) => a.triggerAtHours - b.triggerAtHours,
  );
  for (const t of sorted) {
    if (hoursSinceLastMaintenance >= t.triggerAtHours) {
      triggered = t;
    }
  }

  const mandatoryOverdue = policy.escalateOnMandatory && triggered?.kind === 'mandatory';

  let message: string;
  if (triggered?.kind === 'mandatory') {
    message = `Mantención obligatoria vencida: ${horometer.machineId} superó el ciclo de ${policy.cycleHours}h (lleva ${hoursSinceLastMaintenance}h). ${triggered.recommendedAction}`;
  } else if (triggered?.kind === 'critical') {
    message = `Crítico: ${horometer.machineId} a ${hoursUntilNextMaintenance}h del ciclo. ${triggered.recommendedAction}`;
  } else if (triggered?.kind === 'warning') {
    message = `Advertencia: ${horometer.machineId} a ${hoursUntilNextMaintenance}h del ciclo. ${triggered.recommendedAction}`;
  } else {
    message = `OK: ${horometer.machineId} a ${hoursUntilNextMaintenance}h de la próxima mantención.`;
  }

  return {
    machineId: horometer.machineId,
    hoursSinceLastMaintenance,
    hoursUntilNextMaintenance,
    cycleProgressPercent,
    triggeredThreshold: triggered,
    mandatoryOverdue,
    message,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Calendar event proposal
// ────────────────────────────────────────────────────────────────────────

export interface CalendarTaskProposal {
  machineId: string;
  /** Hora calendario aprox cuando deberá ejecutarse. */
  proposedDateIso: string;
  /** Tipo de mantención (preventiva por defecto). */
  kind: 'preventive' | 'mandatory_maintenance';
  /** Texto del task. */
  title: string;
  /** Severity para priorización en backlog. */
  priority: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Convierte un status en una propuesta de evento calendario.
 * Usa un avgUsageHoursPerDay (típico 8h diarias) para proyectar la
 * fecha en la que se cruzará el siguiente threshold.
 */
export function proposeCalendarTask(
  status: HorometerStatus,
  options: {
    avgUsageHoursPerDay: number;
    nowIso?: string;
  },
): CalendarTaskProposal | null {
  if (!status.triggeredThreshold && status.hoursUntilNextMaintenance > 0) {
    // Aún no se acerca el primer threshold → no propose nada.
    return null;
  }

  const nowMs = Date.parse(options.nowIso ?? new Date().toISOString());
  const usagePerDay = Math.max(0.5, options.avgUsageHoursPerDay);

  // Default = preventive task at the projected cycle date, low priority. The
  // branches below escalate (sooner date + higher priority) as the crossed
  // threshold demands; the warning branch keeps the projected date.
  let daysAhead = Math.ceil(status.hoursUntilNextMaintenance / usagePerDay);
  let priority: CalendarTaskProposal['priority'] = 'low';
  let kind: CalendarTaskProposal['kind'] = 'preventive';

  if (status.mandatoryOverdue || status.triggeredThreshold?.kind === 'mandatory') {
    daysAhead = 0;
    priority = 'critical';
    kind = 'mandatory_maintenance';
  } else if (status.triggeredThreshold?.kind === 'critical') {
    daysAhead = 3;
    priority = 'high';
  } else if (status.triggeredThreshold?.kind === 'warning') {
    priority = 'medium';
  }

  const proposedDateMs = nowMs + daysAhead * 24 * 3_600_000;
  const proposedDateIso = new Date(proposedDateMs).toISOString();

  const title =
    kind === 'mandatory_maintenance'
      ? `URGENTE: Mantención obligatoria ${status.machineId}`
      : `Mantención preventiva ${status.machineId} (~${status.hoursUntilNextMaintenance}h restantes)`;

  return {
    machineId: status.machineId,
    proposedDateIso,
    kind,
    title,
    priority,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Fleet rollup
// ────────────────────────────────────────────────────────────────────────

export interface FleetMaintenanceReport {
  totalMachines: number;
  ok: number;
  warning: number;
  critical: number;
  /** Máquinas con el ciclo obligatorio vencido (recomendación de detener). */
  mandatoryOverdue: number;
  /** Top 5 que requieren atención inmediata. */
  topUrgent: Array<{ machineId: string; message: string }>;
}

export function buildFleetReport(
  fleet: Array<{ horometer: MachineHorometer; policy: MaintenancePolicy }>,
): FleetMaintenanceReport {
  let ok = 0;
  let warning = 0;
  let critical = 0;
  let mandatoryOverdue = 0;
  const allStatuses: HorometerStatus[] = [];
  for (const m of fleet) {
    const s = assessHorometerStatus(m.horometer, m.policy);
    allStatuses.push(s);
    if (s.mandatoryOverdue) mandatoryOverdue += 1;
    else if (s.triggeredThreshold?.kind === 'mandatory') critical += 1;
    else if (s.triggeredThreshold?.kind === 'critical') critical += 1;
    else if (s.triggeredThreshold?.kind === 'warning') warning += 1;
    else ok += 1;
  }

  const PRIORITY = { mandatory: 3, critical: 2, warning: 1 } as const;
  const topUrgent = allStatuses
    .filter((s) => s.triggeredThreshold !== null)
    .sort((a, b) => {
      const pa = a.triggeredThreshold ? PRIORITY[a.triggeredThreshold.kind] : 0;
      const pb = b.triggeredThreshold ? PRIORITY[b.triggeredThreshold.kind] : 0;
      return pb - pa;
    })
    .slice(0, 5)
    .map((s) => ({ machineId: s.machineId, message: s.message }));

  return {
    totalMachines: fleet.length,
    ok,
    warning,
    critical,
    mandatoryOverdue,
    topUrgent,
  };
}
