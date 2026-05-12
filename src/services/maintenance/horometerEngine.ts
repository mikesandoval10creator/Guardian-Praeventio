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
  /** Si el equipo debe BLOQUEARSE cuando se supera mandatory. */
  blockOnMandatory: boolean;
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
        recommendedAction: 'Bloquear operación hasta completar mantención.',
      },
    ],
    blockOnMandatory: true,
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
  /** True si se debe BLOQUEAR el equipo. */
  shouldBlock: boolean;
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

  const shouldBlock = policy.blockOnMandatory && triggered?.kind === 'mandatory';

  let message: string;
  if (triggered?.kind === 'mandatory') {
    message = `Bloqueo: ${horometer.machineId} superó ciclo de ${policy.cycleHours}h (lleva ${hoursSinceLastMaintenance}h). ${triggered.recommendedAction}`;
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
    shouldBlock,
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
  kind: 'preventive' | 'mandatory_block_resolution';
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

  let daysAhead = 0;
  let priority: CalendarTaskProposal['priority'] = 'low';
  let kind: CalendarTaskProposal['kind'] = 'preventive';

  if (status.shouldBlock) {
    daysAhead = 0;
    priority = 'critical';
    kind = 'mandatory_block_resolution';
  } else if (status.triggeredThreshold?.kind === 'mandatory') {
    daysAhead = 0;
    priority = 'critical';
    kind = 'mandatory_block_resolution';
  } else if (status.triggeredThreshold?.kind === 'critical') {
    daysAhead = 3;
    priority = 'high';
  } else if (status.triggeredThreshold?.kind === 'warning') {
    daysAhead = Math.ceil(status.hoursUntilNextMaintenance / usagePerDay);
    priority = 'medium';
  } else {
    daysAhead = Math.ceil(status.hoursUntilNextMaintenance / usagePerDay);
    priority = 'low';
  }

  const proposedDateMs = nowMs + daysAhead * 24 * 3_600_000;
  const proposedDateIso = new Date(proposedDateMs).toISOString();

  const title =
    kind === 'mandatory_block_resolution'
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
  blocked: number;
  /** Top 5 que requieren atención inmediata. */
  topUrgent: Array<{ machineId: string; message: string }>;
}

export function buildFleetReport(
  fleet: Array<{ horometer: MachineHorometer; policy: MaintenancePolicy }>,
): FleetMaintenanceReport {
  let ok = 0;
  let warning = 0;
  let critical = 0;
  let blocked = 0;
  const allStatuses: HorometerStatus[] = [];
  for (const m of fleet) {
    const s = assessHorometerStatus(m.horometer, m.policy);
    allStatuses.push(s);
    if (s.shouldBlock) blocked += 1;
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
    blocked,
    topUrgent,
  };
}
