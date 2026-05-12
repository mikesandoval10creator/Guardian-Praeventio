// Praeventio Guard — Sprint 39 Fase G.6: Permisos de Trabajo Seguro.
//
// Cierra: Documento usuario "Recomendaciones nuevas §15, §30"
//         Plan integral Top 15 #5
//
// Permisos digitales para tareas críticas:
//   - Trabajo en altura (DS 594 art. 53)
//   - Trabajo en caliente (DS 132)
//   - Espacios confinados (DS 132 + protocolo MINSAL)
//   - LOTO / bloqueo energético (DS 132 + DS 109)
//   - Excavaciones (DS 594)
//   - Izaje crítico (DS 132)
//
// Cada permiso valida pre-requisitos antes de emitir:
//   - Trabajador apto (sin restricciones médicas)
//   - Training vigente del tipo de permiso
//   - EPP entregado y en plazo
//   - Aprobador con role válido
//   - Checklist previo completado
//
// API pura, sin LLM. El caller persiste y materializa edges Zettelkasten.

import { computeEdgeId, type EdgeType } from '../zettelkasten/edges.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type WorkPermitKind =
  | 'altura'
  | 'caliente'
  | 'confinado'
  | 'loto'
  | 'excavacion'
  | 'izaje_critico';

export type WorkPermitStatus =
  | 'draft'
  | 'pending_approval'
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'fulfilled';

export interface WorkPermitChecklist {
  /** Items que deben estar todos en true para emitir. */
  items: Array<{ id: string; label: string; checked: boolean; verifiedAt?: string }>;
}

export interface WorkPermitInput {
  id: string;
  kind: WorkPermitKind;
  /** Worker que ejecuta. */
  workerUid: string;
  /** UID del aprobador (debe tener role válido). */
  approverUid: string;
  approverRole: string;
  /** Zona de aplicación. */
  zoneId?: string;
  /** Descripción de la tarea específica. */
  taskDescription: string;
  /** Pre-requisitos verificados al crear. */
  preconditions: {
    /** Worker tiene training del kind correspondiente. */
    workerHasTraining: boolean;
    /** Worker tiene EPP requerido. */
    workerHasEpp: boolean;
    /** Worker tiene aptitud médica vigente. */
    workerMedicallyFit: boolean;
    /** Checklist previo completado. */
    checklist: WorkPermitChecklist;
  };
  /** Duración del permiso en horas. */
  durationHours: number;
  /** Override now para tests. */
  now?: Date;
}

export interface WorkPermit {
  id: string;
  kind: WorkPermitKind;
  workerUid: string;
  approverUid: string;
  approverRole: string;
  zoneId?: string;
  taskDescription: string;
  status: WorkPermitStatus;
  preconditions: WorkPermitInput['preconditions'];
  createdAt: string;
  approvedAt?: string;
  validFrom: string;
  validUntil: string;
  cancelledAt?: string;
  cancelledReason?: string;
  fulfilledAt?: string;
}

export class WorkPermitValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'WorkPermitValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const APPROVER_ROLES = ['supervisor', 'prevencionista', 'gerente', 'admin'];
const MAX_DURATION_HOURS = 24; // un turno

/**
 * Requisitos canónicos por tipo de permiso. Cada item en checklist debe
 * estar present antes de issuePermit.
 */
export const REQUIRED_CHECKLIST_BY_KIND: Record<WorkPermitKind, string[]> = {
  altura: [
    'Verificar arnés y línea de vida',
    'Verificar superficie de apoyo / barandas',
    'Verificar condiciones climáticas (viento ≤ 60 km/h)',
    'Verificar plan rescate',
  ],
  caliente: [
    'Aislar área de combustibles cercanos',
    'Extintor portátil verificado',
    'Vigía contra incendio asignado',
    'Verificar permisos de soldadura',
  ],
  confinado: [
    'Medición de gases pre-ingreso',
    'Ventilación forzada operativa',
    'Vigía exterior asignado',
    'Equipo rescate listo',
    'Comunicación radio establecida',
  ],
  loto: [
    'Identificar fuentes de energía',
    'Cortar / despresurizar fuentes',
    'Colocar candados personales',
    'Verificar energía cero (try-out)',
  ],
  excavacion: [
    'Verificar planos servicios subterráneos',
    'Estabilizar talud / entibado',
    'Distancia segura a borde',
    'Plan de evacuación de aguas',
  ],
  izaje_critico: [
    'Verificar capacidad grúa vs carga',
    'Inspeccionar eslingas / accesorios',
    'Definir radio de exclusión',
    'Vigía señalero asignado',
    'Plan de izaje firmado',
  ],
};

// ────────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────────

/**
 * Emite un permiso si TODAS las pre-condiciones se cumplen. Si falta
 * algo, lanza WorkPermitValidationError con el código del check faltante.
 */
export function issuePermit(input: WorkPermitInput): WorkPermit {
  if (!APPROVER_ROLES.includes(input.approverRole)) {
    throw new WorkPermitValidationError(
      'INVALID_APPROVER_ROLE',
      `approverRole '${input.approverRole}' not in ${APPROVER_ROLES.join(', ')}`,
    );
  }
  if (input.durationHours <= 0 || input.durationHours > MAX_DURATION_HOURS) {
    throw new WorkPermitValidationError(
      'DURATION_OUT_OF_RANGE',
      `durationHours must be in (0, ${MAX_DURATION_HOURS}]`,
    );
  }
  if (!input.preconditions.workerHasTraining) {
    throw new WorkPermitValidationError(
      'WORKER_MISSING_TRAINING',
      `worker ${input.workerUid} lacks training for ${input.kind}`,
    );
  }
  if (!input.preconditions.workerHasEpp) {
    throw new WorkPermitValidationError(
      'WORKER_MISSING_EPP',
      `worker ${input.workerUid} lacks EPP required for ${input.kind}`,
    );
  }
  if (!input.preconditions.workerMedicallyFit) {
    throw new WorkPermitValidationError(
      'WORKER_NOT_FIT',
      `worker ${input.workerUid} has medical restrictions blocking ${input.kind}`,
    );
  }

  // Checklist: todos los items requeridos deben estar checked.
  const required = REQUIRED_CHECKLIST_BY_KIND[input.kind];
  const checkedLabels = new Set(
    input.preconditions.checklist.items.filter((i) => i.checked).map((i) => i.label),
  );
  const missing = required.filter((r) => !checkedLabels.has(r));
  if (missing.length > 0) {
    throw new WorkPermitValidationError(
      'CHECKLIST_INCOMPLETE',
      `${missing.length} items pending: ${missing.join('; ')}`,
    );
  }

  const now = input.now ?? new Date();
  return {
    id: input.id,
    kind: input.kind,
    workerUid: input.workerUid,
    approverUid: input.approverUid,
    approverRole: input.approverRole,
    zoneId: input.zoneId,
    taskDescription: input.taskDescription,
    status: 'active',
    preconditions: input.preconditions,
    createdAt: now.toISOString(),
    approvedAt: now.toISOString(),
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + input.durationHours * 3_600_000).toISOString(),
  };
}

export function deriveStatus(
  permit: Pick<WorkPermit, 'status' | 'validUntil' | 'cancelledAt' | 'fulfilledAt'>,
  now: Date = new Date(),
): WorkPermitStatus {
  if (permit.cancelledAt) return 'cancelled';
  if (permit.fulfilledAt) return 'fulfilled';
  if (permit.status === 'draft' || permit.status === 'pending_approval') return permit.status;
  if (Date.parse(permit.validUntil) < now.getTime()) return 'expired';
  return 'active';
}

export function cancelPermit(
  permit: WorkPermit,
  reason: string,
  now: Date = new Date(),
): WorkPermit {
  if (permit.status !== 'active') {
    throw new WorkPermitValidationError(
      'NOT_ACTIVE',
      `cannot cancel permit in status '${permit.status}'`,
    );
  }
  if (reason.trim().length < 10) {
    throw new WorkPermitValidationError('REASON_TOO_SHORT', 'reason ≥10 chars');
  }
  return {
    ...permit,
    status: 'cancelled',
    cancelledAt: now.toISOString(),
    cancelledReason: reason.trim(),
  };
}

export function fulfillPermit(permit: WorkPermit, now: Date = new Date()): WorkPermit {
  if (permit.status !== 'active') {
    throw new WorkPermitValidationError('NOT_ACTIVE', `permit status: ${permit.status}`);
  }
  return { ...permit, status: 'fulfilled', fulfilledAt: now.toISOString() };
}

/**
 * Edges que el permiso emitido produce en el grafo Zettelkasten.
 * El caller persiste vía services/zettelkasten/edges.ts.
 */
export function edgesForPermit(
  permit: WorkPermit,
  zoneNodeId?: string,
): Array<{ fromNodeId: string; toNodeId: string; type: EdgeType; edgeId: string }> {
  const edges: Array<{ fromNodeId: string; toNodeId: string; type: EdgeType; edgeId: string }> = [];
  // permit assigned_to worker
  edges.push({
    fromNodeId: permit.id,
    toNodeId: permit.workerUid,
    type: 'assigned_to',
    edgeId: computeEdgeId(permit.id, permit.workerUid, 'assigned_to'),
  });
  // permit regulates zone
  if (zoneNodeId) {
    edges.push({
      fromNodeId: permit.id,
      toNodeId: zoneNodeId,
      type: 'regulates',
      edgeId: computeEdgeId(permit.id, zoneNodeId, 'regulates'),
    });
  }
  return edges;
}
