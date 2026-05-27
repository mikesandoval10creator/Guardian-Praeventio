// Praeventio Guard — Bloque 4.1: Horometro -> Mantenimiento Preventivo flow.
//
// Cierra: "Plan Bloque 4.1 — primera demostracion del poder ZK" (founder).
//
// El horometro es la lectura de horas acumuladas de operacion de un equipo
// pesado (compresor, generador, retroexcavadora, etc.). Cada fabricante
// define ciclos de mantencion: cada 250h, 500h, 1000h, 2000h, etc. Cuando
// el equipo atraviesa un umbral desde el ultimo mantenimiento, este
// servicio detecta el cruce y dispara la cadena Zettelkasten:
//
//   horometro-reading  ->  maintenance-threshold-reached
//                            ->  maintenance-task-created
//                                  ->  maintenance-task-completed
//                                        ->  (status-restored handled in
//                                             equipmentQrService).
//
// Diseño:
//   - El servicio es PURO en `getMaintenanceThresholds(...)` y
//     `checkThresholdsCrossed(...)` — sin IO. Tests deterministas.
//   - `recordReading(...)` y `getCurrentHours(...)` SI persisten via la
//     interfaz minimal `HorometroStore` que el caller inyecta. En
//     produccion: `admin.firestore()` envuelto en un adapter. En tests:
//     fake map-backed store.
//
// ADR 0019: usa Firestore (Google) via inyeccion. No introduce backend
// adicional.
//
// Mantenibilidad: agregar tipo nuevo es 1 entry en
// `MAINTENANCE_CYCLES_BY_TYPE`. El plan dice "compresor, generador,
// retroexcavadora, etc." asi que arrancamos con los tipos mas comunes
// de la familia ASSETS_FAENA (assetsFaenaNodeRegistry.ts) y dejamos
// fallback al ciclo 250h estandar para tipos no mapeados.

// ────────────────────────────────────────────────────────────────────
// Pure types
// ────────────────────────────────────────────────────────────────────

export interface HorometroReading {
  /** ID del equipo (== Equipment.id). */
  equipmentId: string;
  /** Horas acumuladas reportadas. */
  hours: number;
  /** Quien o que reporto la lectura. */
  source: HorometroSource;
  /** UID Firebase del trabajador que reporto (si aplica). */
  reportedByUid?: string;
  /** ISO-8601. */
  recordedAt: string;
  /** Notas libres opcionales. */
  notes?: string;
}

/**
 * Origen de la lectura. Permite auditar y filtrar mediciones de baja
 * fidelidad (ej. estimacion humana vs lectura por OBD).
 */
export type HorometroSource =
  | 'qr_entry' // worker escaneo QR + ingreso manual
  | 'manual' // ingreso manual de admin/supervisor sin QR
  | 'iot' // sensor IoT (futuro)
  | 'integration'; // integracion con sistema externo (ej. flota)

/**
 * Umbral cruzado: el equipo paso de un nivel donde NO requeria mantencion
 * a otro nivel donde SI. El campo `cycleHours` indica el ciclo del fabricante
 * (ej. 250h, 500h, 1000h) y `multiplier` cuantos ciclos lleva (1, 2, 3...).
 *
 * Ejemplo: equipo a 1240h, ultimo mantenimiento a 990h. Si el ciclo es 250h,
 * entonces atraveso el multiplo (k=4 → 1000h). `cycleHours=250`,
 * `multiplier=4`, `triggeredAtHours=1000`.
 */
export interface ThresholdCross {
  /** Ciclo base del fabricante (horas). */
  cycleHours: number;
  /** Multiplo entero del ciclo. */
  multiplier: number;
  /** Horas exactas donde se cruzo (cycleHours * multiplier). */
  triggeredAtHours: number;
  /** Severidad recomendada para la tarea generada. */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Tabla de ciclos preventivos por tipo de equipo. Cada equipo puede tener
 * multiples ciclos escalonados (mantencion menor a 250h, mayor a 1000h, etc.).
 *
 * Si el tipo no esta en la tabla, se usa `DEFAULT_MAINTENANCE_CYCLES`.
 *
 * Las severidades reflejan la criticidad de saltarse el ciclo:
 *   - 250h  -> low/medium   (mantenciones menores, filtros, aceite, chequeo)
 *   - 500h  -> medium       (chequeo intermedio, regulaciones)
 *   - 1000h -> high         (mantenimiento mayor, recambios programados)
 *   - 2000h -> critical     (overhaul, intervenciones estructurales)
 */
export interface MaintenanceCycle {
  cycleHours: number;
  /** Severidad por defecto del threshold cuando se cruza. */
  severity: ThresholdCross['severity'];
  /** Etiqueta del fabricante o norma. */
  label: string;
}

/**
 * Catalogo seed. Mantenible — agregar un tipo nuevo es 4 lineas.
 * Los tipos coinciden con `Equipment.type` (ver equipmentQrService.ts).
 */
export const MAINTENANCE_CYCLES_BY_TYPE: Record<string, MaintenanceCycle[]> = {
  compresor: [
    { cycleHours: 250, severity: 'low', label: 'Filtros + nivel aceite' },
    { cycleHours: 500, severity: 'medium', label: 'Cambio aceite + correas' },
    { cycleHours: 1000, severity: 'high', label: 'Recambio mayor + valvulas' },
    { cycleHours: 2000, severity: 'critical', label: 'Overhaul completo' },
  ],
  generador: [
    { cycleHours: 250, severity: 'low', label: 'Filtros + bujias' },
    { cycleHours: 500, severity: 'medium', label: 'Aceite + refrigerante' },
    { cycleHours: 1000, severity: 'high', label: 'Inyectores + bateria' },
    { cycleHours: 2000, severity: 'critical', label: 'Overhaul motor' },
  ],
  retroexcavadora: [
    { cycleHours: 250, severity: 'low', label: 'Engrase + filtros' },
    { cycleHours: 500, severity: 'medium', label: 'Aceite hidraulico' },
    { cycleHours: 1000, severity: 'high', label: 'Bombas + cilindros' },
    { cycleHours: 2000, severity: 'critical', label: 'Overhaul mayor' },
  ],
  excavadora: [
    { cycleHours: 250, severity: 'low', label: 'Engrase + filtros' },
    { cycleHours: 500, severity: 'medium', label: 'Aceite hidraulico' },
    { cycleHours: 1000, severity: 'high', label: 'Bombas + cilindros' },
    { cycleHours: 2000, severity: 'critical', label: 'Overhaul' },
  ],
  cargador_frontal: [
    { cycleHours: 250, severity: 'low', label: 'Engrase + filtros' },
    { cycleHours: 500, severity: 'medium', label: 'Aceite + refrigerante' },
    { cycleHours: 1000, severity: 'high', label: 'Bombas + transmision' },
  ],
  bulldozer: [
    { cycleHours: 250, severity: 'low', label: 'Engrase + filtros' },
    { cycleHours: 500, severity: 'medium', label: 'Aceite hidraulico' },
    { cycleHours: 1000, severity: 'high', label: 'Tren rodaje' },
    { cycleHours: 2000, severity: 'critical', label: 'Overhaul' },
  ],
  camion_tolva: [
    { cycleHours: 500, severity: 'medium', label: 'Aceite + freno' },
    { cycleHours: 1000, severity: 'high', label: 'Recambio mayor' },
  ],
  camion_cisterna: [
    { cycleHours: 500, severity: 'medium', label: 'Aceite + freno + valvulas' },
    { cycleHours: 1000, severity: 'high', label: 'Recambio mayor' },
  ],
  gruahorquilla: [
    { cycleHours: 250, severity: 'low', label: 'Hidraulico + engrase' },
    { cycleHours: 500, severity: 'medium', label: 'Bateria + frenos' },
    { cycleHours: 1000, severity: 'high', label: 'Mantencion mayor' },
  ],
  grua_movil: [
    { cycleHours: 250, severity: 'medium', label: 'Engrase + cables' },
    { cycleHours: 500, severity: 'high', label: 'Frenos + hidraulico' },
    { cycleHours: 1000, severity: 'critical', label: 'Mantencion mayor' },
  ],
};

/**
 * Fallback usado cuando `equipment.type` no aparece en
 * `MAINTENANCE_CYCLES_BY_TYPE`. Conservador: solo 250h, severidad medium.
 */
export const DEFAULT_MAINTENANCE_CYCLES: MaintenanceCycle[] = [
  { cycleHours: 250, severity: 'medium', label: 'Mantencion preventiva' },
];

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Devuelve la tabla de ciclos del fabricante para un tipo de equipo.
 * Retorna copia (readonly por convencion) para que el caller no mute.
 */
export function getMaintenanceThresholds(equipmentType: string): MaintenanceCycle[] {
  const key = equipmentType.toLowerCase().trim();
  const found = MAINTENANCE_CYCLES_BY_TYPE[key];
  if (found && found.length > 0) return [...found];
  return [...DEFAULT_MAINTENANCE_CYCLES];
}

/**
 * Calcula que multiplos de cada ciclo se cruzaron entre
 * `sinceHours` (ultima mantencion) y `currentHours` (lectura nueva).
 *
 * Devuelve la lista de cruces ordenada de menor a mayor multiplo
 * absoluto, de modo que la UI/flow pueda emitir N tareas si el operador
 * se "salto" varios ciclos sin reportar.
 *
 * Ejemplo: sinceHours=240, currentHours=1100, ciclo 250h.
 *   Multiplos cruzados: 250 (k=1), 500 (k=2), 750 (k=3), 1000 (k=4).
 *   Cada uno aparece como un ThresholdCross independiente, ordenado por
 *   triggeredAtHours ascendente.
 */
export function checkThresholdsCrossed(
  equipmentType: string,
  sinceHours: number,
  currentHours: number,
): ThresholdCross[] {
  if (!Number.isFinite(sinceHours) || !Number.isFinite(currentHours)) return [];
  if (currentHours <= sinceHours) return [];
  if (sinceHours < 0 || currentHours < 0) return [];

  const cycles = getMaintenanceThresholds(equipmentType);
  const crosses: ThresholdCross[] = [];

  for (const c of cycles) {
    if (!(c.cycleHours > 0)) continue;
    // Primer multiplo estrictamente mayor a sinceHours.
    const firstK = Math.floor(sinceHours / c.cycleHours) + 1;
    // Ultimo multiplo menor o igual a currentHours.
    const lastK = Math.floor(currentHours / c.cycleHours);
    for (let k = firstK; k <= lastK; k += 1) {
      crosses.push({
        cycleHours: c.cycleHours,
        multiplier: k,
        triggeredAtHours: c.cycleHours * k,
        severity: c.severity,
      });
    }
  }

  crosses.sort((a, b) => a.triggeredAtHours - b.triggeredAtHours);
  return crosses;
}

// ────────────────────────────────────────────────────────────────────
// Persistence DI shape
// ────────────────────────────────────────────────────────────────────

/**
 * Minimal Firestore-ish surface this service needs. Tests inject a
 * map-backed fake. Production code wraps `admin.firestore()`.
 *
 * Schema:
 *   tenants/{tid}/projects/{pid}/equipment/{eqId}/horometro_readings/{rid}
 *
 * Cada reading es un doc independiente — historial completo. La "hora
 * actual" se calcula como el MAX de las lecturas (sin asumir
 * monotonicidad por defecto: si un operador escribio "1500" por error
 * cuando deberia haber sido "150", aceptamos lo siguiente pero NO
 * regresamos automaticamente).
 */
export interface HorometroStore {
  saveReading(input: {
    tenantId: string;
    projectId: string;
    equipmentId: string;
    reading: HorometroReading;
  }): Promise<void>;

  /** Devuelve la lectura mas reciente (mayor hours) o null si no hay. */
  getLatestReading(input: {
    tenantId: string;
    projectId: string;
    equipmentId: string;
  }): Promise<HorometroReading | null>;

  /** Devuelve las horas del ultimo mantenimiento (registro
   *  `maintenance-task-completed`). Si no hay registro, retorna 0. */
  getLastMaintenanceHours(input: {
    tenantId: string;
    projectId: string;
    equipmentId: string;
  }): Promise<number>;
}

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class HorometroValidationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_HOURS'
      | 'NEGATIVE_HOURS'
      | 'HOURS_REGRESSION'
      | 'MISSING_EQUIPMENT_ID',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'HorometroValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Service API (impure but DI-driven)
// ────────────────────────────────────────────────────────────────────

export interface RecordReadingInput {
  tenantId: string;
  projectId: string;
  equipmentId: string;
  hours: number;
  source: HorometroSource;
  reportedByUid?: string;
  notes?: string;
  /** Override para tests deterministas. */
  now?: () => Date;
}

/**
 * Persiste una lectura validada de horas. Devuelve la lectura final
 * tal como quedo almacenada (con `recordedAt` poblado).
 *
 * Reglas:
 *   1. `hours` debe ser finito y >= 0.
 *   2. Si la ultima lectura era H_prev y `hours < H_prev`, lanzamos
 *      `HOURS_REGRESSION` SALVO que `source === 'manual'` Y `notes`
 *      contenga indicacion explicita "corregir" (admin overrides
 *      manual de un valor erroneo). El servicio no decide si la nueva
 *      lectura es real o un typo — devuelve el error y el caller
 *      (UI / route) escoge si llamar de nuevo con la flag de override.
 *      Para mantener la firma simple, esta version SIEMPRE lanza
 *      regression para non-manual y deja manual pasar.
 *   3. NO dispara la cadena ZK aqui. Eso es responsabilidad del
 *      `horometroMaintenanceFlow.onHorometroReading(reading)`.
 */
export async function recordReading(
  input: RecordReadingInput,
  store: HorometroStore,
): Promise<HorometroReading> {
  if (!input.equipmentId || input.equipmentId.length === 0) {
    throw new HorometroValidationError(
      'MISSING_EQUIPMENT_ID',
      'equipmentId is required',
    );
  }
  if (!Number.isFinite(input.hours)) {
    throw new HorometroValidationError(
      'INVALID_HOURS',
      `hours must be finite, got ${input.hours}`,
    );
  }
  if (input.hours < 0) {
    throw new HorometroValidationError(
      'NEGATIVE_HOURS',
      `hours must be >= 0, got ${input.hours}`,
    );
  }

  const latest = await store.getLatestReading({
    tenantId: input.tenantId,
    projectId: input.projectId,
    equipmentId: input.equipmentId,
  });

  if (latest && input.hours < latest.hours && input.source !== 'manual') {
    throw new HorometroValidationError(
      'HOURS_REGRESSION',
      `new reading ${input.hours}h is less than latest ${latest.hours}h ` +
        `(use source='manual' to override with admin notes)`,
    );
  }

  const now = (input.now ?? (() => new Date()))();
  const reading: HorometroReading = {
    equipmentId: input.equipmentId,
    hours: input.hours,
    source: input.source,
    reportedByUid: input.reportedByUid,
    recordedAt: now.toISOString(),
    notes: input.notes,
  };
  await store.saveReading({
    tenantId: input.tenantId,
    projectId: input.projectId,
    equipmentId: input.equipmentId,
    reading,
  });
  return reading;
}

/**
 * Devuelve las horas actuales del equipo (== mayor reading conocido) o
 * 0 si nunca se reporto.
 */
export async function getCurrentHours(
  input: {
    tenantId: string;
    projectId: string;
    equipmentId: string;
  },
  store: HorometroStore,
): Promise<number> {
  const latest = await store.getLatestReading(input);
  return latest?.hours ?? 0;
}
