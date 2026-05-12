// Praeventio Guard — Sprint 39 Fase I.5: QR Equipos + Pre-uso.
//
// Cierra: Documento usuario "Recomendaciones nuevas §50, §51, §52"
//
// Cada equipo tiene QR fijo que apunta a su perfil:
//   - estado (operativo / restringido / fuera_servicio / mantencion / bloqueado)
//   - mantenciones (próxima fecha)
//   - inspecciones (última fecha)
//   - documentos (manual, calibración)
//   - riesgos asociados (cita a categorías)
//   - historial de fallas
//
// Antes de usar el equipo, el trabajador escanea y responde checklist
// pre-uso. Sin completar, NO se autoriza operación de equipos críticos.

export type EquipmentStatus =
  | 'operativo'
  | 'restringido'
  | 'fuera_servicio'
  | 'en_mantencion'
  | 'bloqueado_loto';

export type EquipmentCriticality = 'low' | 'medium' | 'high' | 'critical';

export interface Equipment {
  id: string;
  /** Código de inventario interno (visible en QR). */
  code: string;
  type: string; // 'gruahorquilla', 'maquina_soldar', 'compresor', 'andamio', ...
  brand?: string;
  model?: string;
  serialNumber?: string;
  status: EquipmentStatus;
  criticality: EquipmentCriticality;
  /** Fecha próxima mantención. */
  nextMaintenanceAt?: string;
  /** Fecha última inspección. */
  lastInspectedAt?: string;
  /** Categorías de riesgo. */
  riskCategories: string[];
  /** Si requiere checklist pre-uso obligatorio. */
  requiresPreUseChecklist: boolean;
}

export interface PreUseChecklistItem {
  id: string;
  label: string;
  /** Si la respuesta esperada es OK o detectar anomalía. */
  expectedAnswer: 'ok' | 'no_anomaly';
}

export interface PreUseResponse {
  itemId: string;
  /** Respuesta: passed = sin anomalía, failed = anomalía detectada. */
  result: 'passed' | 'failed';
  notes?: string;
  photoUrl?: string;
}

export interface PreUseValidation {
  id: string;
  equipmentId: string;
  workerUid: string;
  startedAt: string;
  responses: PreUseResponse[];
  /** Si TODOS los items passed. */
  passed: boolean;
  /** Si failed, qué items fallaron. */
  failedItems: string[];
}

export class EquipmentValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'EquipmentValidationError';
  }
}

/**
 * Checklist canónicos por tipo. Mantenible — agregar tipo nuevo es 1 entry.
 */
export const PRE_USE_CHECKLISTS_BY_TYPE: Record<string, PreUseChecklistItem[]> = {
  gruahorquilla: [
    { id: 'q1', label: 'Niveles aceite hidráulico OK', expectedAnswer: 'ok' },
    { id: 'q2', label: 'Frenos responden', expectedAnswer: 'ok' },
    { id: 'q3', label: 'Bocina y luces operativas', expectedAnswer: 'ok' },
    { id: 'q4', label: 'Llantas sin daño visible', expectedAnswer: 'no_anomaly' },
    { id: 'q5', label: 'Capacidad de carga vs uso planeado OK', expectedAnswer: 'ok' },
  ],
  maquina_soldar: [
    { id: 's1', label: 'Cables sin cortes ni empalmes', expectedAnswer: 'no_anomaly' },
    { id: 's2', label: 'Conexión a tierra firme', expectedAnswer: 'ok' },
    { id: 's3', label: 'Extintor cercano operativo', expectedAnswer: 'ok' },
    { id: 's4', label: 'Área libre de combustibles', expectedAnswer: 'no_anomaly' },
  ],
  andamio: [
    { id: 'a1', label: 'Plataforma completa sin tablones flojos', expectedAnswer: 'no_anomaly' },
    { id: 'a2', label: 'Barandas en 3 lados a 90cm/40cm', expectedAnswer: 'ok' },
    { id: 'a3', label: 'Base nivelada y firme', expectedAnswer: 'ok' },
    { id: 'a4', label: 'Tarjeta verde colocada por armador', expectedAnswer: 'ok' },
  ],
  compresor: [
    { id: 'c1', label: 'Válvulas alivio operan', expectedAnswer: 'ok' },
    { id: 'c2', label: 'Manómetros calibrados', expectedAnswer: 'ok' },
    { id: 'c3', label: 'Filtros limpios', expectedAnswer: 'ok' },
  ],
};

export function getChecklistForType(type: string): PreUseChecklistItem[] {
  return PRE_USE_CHECKLISTS_BY_TYPE[type] ?? [];
}

export interface RunPreUseInput {
  id: string;
  equipment: Equipment;
  workerUid: string;
  responses: PreUseResponse[];
  now?: Date;
}

export function runPreUseValidation(input: RunPreUseInput): PreUseValidation {
  if (input.equipment.status !== 'operativo' && input.equipment.status !== 'restringido') {
    throw new EquipmentValidationError(
      'EQUIPMENT_NOT_AVAILABLE',
      `equipment status '${input.equipment.status}' does not allow use`,
    );
  }
  if (input.equipment.requiresPreUseChecklist) {
    const expectedItems = getChecklistForType(input.equipment.type);
    if (expectedItems.length === 0) {
      throw new EquipmentValidationError(
        'NO_CHECKLIST_DEFINED',
        `no pre-use checklist defined for type '${input.equipment.type}'`,
      );
    }
    const responseIds = new Set(input.responses.map((r) => r.itemId));
    const missing = expectedItems.filter((i) => !responseIds.has(i.id));
    if (missing.length > 0) {
      throw new EquipmentValidationError(
        'CHECKLIST_INCOMPLETE',
        `missing responses for: ${missing.map((m) => m.id).join(', ')}`,
      );
    }
  }
  const failedItems = input.responses
    .filter((r) => r.result === 'failed')
    .map((r) => r.itemId);
  const now = input.now ?? new Date();
  return {
    id: input.id,
    equipmentId: input.equipment.id,
    workerUid: input.workerUid,
    startedAt: now.toISOString(),
    responses: input.responses,
    passed: failedItems.length === 0,
    failedItems,
  };
}

/**
 * Cuando un pre-use detecta failed items, automáticamente el equipo
 * pasa a 'restringido' o 'fuera_servicio' según severidad.
 */
export function deriveEquipmentStatusAfterPreUse(
  current: EquipmentStatus,
  validation: PreUseValidation,
  criticality: EquipmentCriticality,
): EquipmentStatus {
  if (validation.passed) return current;
  // Si CUALQUIER item falló y el equipo es crítico → fuera_servicio
  if (criticality === 'critical' || criticality === 'high') {
    return 'fuera_servicio';
  }
  // Medium/low → restringido
  return 'restringido';
}
