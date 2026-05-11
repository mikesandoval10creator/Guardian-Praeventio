// Praeventio Guard — Sprint 39 Fase J.8: Bitácora Supervisor + Cambio de Turno.
//
// Cierra: Documento usuario "Recomendaciones nuevas §19, §20"
//
// Para operaciones 24/7, el cambio de turno es uno de los momentos
// más peligrosos: información se pierde, supuestos se transmiten mal.
//
// Esta bitácora estandariza qué información debe pasar de turno a turno:
//   - Incidentes abiertos
//   - Equipos fuera de servicio
//   - Controles pendientes
//   - Trabajadores ausentes
//   - Zonas restringidas
//   - Permisos activos
//   - Pendientes administrativos
//   - Observaciones del supervisor saliente

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ShiftKind = 'morning' | 'afternoon' | 'night' | 'extended';

export interface ShiftHandoverNote {
  category: HandoverCategory;
  text: string;
  /** Severidad para que el supervisor entrante priorice. */
  severity: 'info' | 'attention' | 'urgent';
  /** Referencia opcional a otra entidad. */
  referenceId?: string;
}

export type HandoverCategory =
  | 'open_incidents'
  | 'equipment_down'
  | 'pending_controls'
  | 'absent_workers'
  | 'restricted_zones'
  | 'active_permits'
  | 'admin_pending'
  | 'weather_alert'
  | 'observation';

export interface ShiftLogEntry {
  /** Quién hizo la entrada. */
  authorUid: string;
  authorRole: string;
  /** ISO-8601. */
  at: string;
  text: string;
  /** Si la entrada requiere acción del próximo turno. */
  requiresFollowUp: boolean;
}

export interface ShiftRecord {
  id: string;
  projectId: string;
  kind: ShiftKind;
  startedAt: string;
  endedAt?: string;
  /** UID del supervisor a cargo de este turno. */
  supervisorUid: string;
  /** Entries cronológicas durante el turno. */
  logEntries: ShiftLogEntry[];
  /** Estado final compilado para handover al próximo turno. */
  handoverNotes: ShiftHandoverNote[];
  /** UID del supervisor que recibió (próximo turno). */
  acknowledgedByUid?: string;
  acknowledgedAt?: string;
  /** Observaciones del supervisor entrante después de leer. */
  acknowledgmentNotes?: string;
}

export class HandoverValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'HandoverValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

export interface StartShiftInput {
  id: string;
  projectId: string;
  kind: ShiftKind;
  supervisorUid: string;
  now?: Date;
}

export function startShift(input: StartShiftInput): ShiftRecord {
  const now = input.now ?? new Date();
  return {
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    startedAt: now.toISOString(),
    supervisorUid: input.supervisorUid,
    logEntries: [],
    handoverNotes: [],
  };
}

export function logEntry(
  shift: ShiftRecord,
  entry: Omit<ShiftLogEntry, 'at'> & { at?: string },
): ShiftRecord {
  if (shift.endedAt) {
    throw new HandoverValidationError(
      'SHIFT_ENDED',
      'cannot log entry after shift ended',
    );
  }
  if (entry.text.trim().length < 5) {
    throw new HandoverValidationError(
      'ENTRY_TOO_SHORT',
      'log entry text must be at least 5 chars',
    );
  }
  return {
    ...shift,
    logEntries: [
      ...shift.logEntries,
      { ...entry, at: entry.at ?? new Date().toISOString() },
    ],
  };
}

export function addHandoverNote(
  shift: ShiftRecord,
  note: ShiftHandoverNote,
): ShiftRecord {
  if (shift.endedAt) {
    throw new HandoverValidationError(
      'SHIFT_ENDED',
      'cannot add handover note after shift ended',
    );
  }
  if (note.text.trim().length < 5) {
    throw new HandoverValidationError(
      'NOTE_TOO_SHORT',
      'note text must be at least 5 chars',
    );
  }
  return { ...shift, handoverNotes: [...shift.handoverNotes, note] };
}

export function endShift(shift: ShiftRecord, now: Date = new Date()): ShiftRecord {
  if (shift.endedAt) return shift;
  return { ...shift, endedAt: now.toISOString() };
}

export function acknowledgeHandover(
  shift: ShiftRecord,
  incomingSupervisorUid: string,
  notes?: string,
  now: Date = new Date(),
): ShiftRecord {
  if (!shift.endedAt) {
    throw new HandoverValidationError(
      'SHIFT_NOT_ENDED',
      'cannot acknowledge handover before shift ends',
    );
  }
  if (shift.acknowledgedAt) {
    throw new HandoverValidationError(
      'ALREADY_ACKNOWLEDGED',
      `shift ${shift.id} already acknowledged at ${shift.acknowledgedAt}`,
    );
  }
  if (incomingSupervisorUid === shift.supervisorUid) {
    throw new HandoverValidationError(
      'SAME_SUPERVISOR',
      'incoming supervisor must differ from outgoing',
    );
  }
  return {
    ...shift,
    acknowledgedByUid: incomingSupervisorUid,
    acknowledgedAt: now.toISOString(),
    acknowledgmentNotes: notes,
  };
}

export interface ShiftSummary {
  shiftId: string;
  durationMinutes: number;
  entriesCount: number;
  notesCount: number;
  urgentNotesCount: number;
  hasUnacknowledgedHandover: boolean;
  pendingFollowUps: number;
}

export function summarizeShift(
  shift: ShiftRecord,
  now: Date = new Date(),
): ShiftSummary {
  const endMs = shift.endedAt ? Date.parse(shift.endedAt) : now.getTime();
  const durationMin = Math.round(
    (endMs - Date.parse(shift.startedAt)) / 60_000,
  );
  const urgent = shift.handoverNotes.filter((n) => n.severity === 'urgent').length;
  const pending = shift.logEntries.filter((e) => e.requiresFollowUp).length;
  return {
    shiftId: shift.id,
    durationMinutes: durationMin,
    entriesCount: shift.logEntries.length,
    notesCount: shift.handoverNotes.length,
    urgentNotesCount: urgent,
    hasUnacknowledgedHandover: !!shift.endedAt && !shift.acknowledgedAt,
    pendingFollowUps: pending,
  };
}
