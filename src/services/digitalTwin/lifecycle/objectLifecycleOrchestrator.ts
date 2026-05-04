// SPDX-License-Identifier: MIT
//
// Object Lifecycle Orchestrator — el wire que conecta:
//
//   PlacedObject (photogrammetry/types.ts)
//     ↓
//   ZK Node + history (zettelkasten/persistence/writeNode.ts)
//     ↓
//   Calendar reminders (mantenimiento, inspección)
//     ↓
//   Cuadrilla assignment (organic/crewService.ts)
//
// Cuando el usuario coloca un extintor virtual en el Digital Twin
// (planning), o lo marca como instalado físicamente, este orchestrator
// produce los SPECS de:
//   - El nodo ZK que debe escribirse (con su lifecycle state).
//   - Los eventos calendario que deben crearse (inspecciones recurrentes
//     según DS 594, mantenimientos según fabricante, etc.).
//   - La cuadrilla responsable opcional.
//
// Es PURO — no escribe a Firestore directamente. Devuelve specs que el
// caller (UI, scripts, tests) persiste con sus propios writers. Esto
// garantiza:
//   - Tests deterministas sin red.
//   - Mismo orchestrator funciona en cliente (React) y server (Node).
//   - Auditable: el spec puede inspeccionarse antes de persistir.

import type {
  PlacedObject,
  PlacedObjectKind,
  PlacedObjectLifecycle,
} from '../photogrammetry/types';
import { NodeType } from '../../../types';
import type { RiskNode } from '../../../types';
import type { RiskNodePayload, RiskNodeSeverity } from '../../zettelkasten/types';

// ─────────────────────────────────────────────────────────────────────
// MAINTENANCE SCHEDULE — qué inspecciones requiere cada tipo de objeto
// según normativa chilena. Frecuencia en días.
// ─────────────────────────────────────────────────────────────────────

export interface MaintenanceSchedule {
  /** Kind del objeto al que aplica. */
  kind: PlacedObjectKind;
  /** Cada cuántos días se inspecciona/mantiene. */
  intervalDays: number;
  /** Tipo de actividad — drive de iconografía y reporte. */
  activityKind: MaintenanceActivityKind;
  /** Cita normativa (ej. "DS 594 art. 51"). */
  citation: string;
  /** Descripción legible para el calendario. */
  description: string;
}

export type MaintenanceActivityKind =
  | 'visual_inspection' // chequeo visual mensual / trimestral
  | 'pressure_test' // recarga + test hidrostático
  | 'functional_test' // test funcional (sirenas, AEDs)
  | 'expiration_check' // chequeo de vencimiento (botiquín, AED pads)
  | 'calibration' // calibración (gas detectors)
  | 'replacement'; // reemplazo total (extintor cada 5 años, etc.)

/**
 * Catálogo seed de schedules. Hardcoded por ahora — Sprint futuro
 * puede traer overrides per-tenant desde Firestore.
 *
 * Frecuencias basadas en:
 *   DS 594 art. 51 — extintores: inspección mensual, mantención anual,
 *     prueba hidrostática cada 5 años (PQS) o 12 (CO2).
 *   NCh 1410 — señalética: revisión semestral.
 *   DS 132 minería — AEDs: test funcional mensual.
 *   Buenas prácticas — botiquín: chequeo trimestral por vencimientos.
 */
export const MAINTENANCE_SCHEDULES: ReadonlyArray<MaintenanceSchedule> = [
  // Extintores — DS 594 art. 51
  {
    kind: 'extinguisher_pqs',
    intervalDays: 30,
    activityKind: 'visual_inspection',
    citation: 'DS 594 art. 51 — inspección visual mensual',
    description: 'Revisar manómetro, sello, etiqueta y ubicación del extintor.',
  },
  {
    kind: 'extinguisher_pqs',
    intervalDays: 365,
    activityKind: 'pressure_test',
    citation: 'DS 594 art. 51 — mantención anual',
    description: 'Mantención anual del extintor PQS por servicio técnico autorizado.',
  },
  {
    kind: 'extinguisher_co2',
    intervalDays: 30,
    activityKind: 'visual_inspection',
    citation: 'DS 594 art. 51 — inspección visual mensual',
    description: 'Revisar manómetro, sello, etiqueta y ubicación del extintor CO2.',
  },
  {
    kind: 'extinguisher_co2',
    intervalDays: 365,
    activityKind: 'pressure_test',
    citation: 'DS 594 art. 51 — mantención anual',
    description: 'Mantención anual del extintor CO2 por servicio técnico autorizado.',
  },
  {
    kind: 'extinguisher_water',
    intervalDays: 30,
    activityKind: 'visual_inspection',
    citation: 'DS 594 art. 51 — inspección visual mensual',
    description: 'Revisar manómetro, sello, etiqueta y ubicación del extintor de agua.',
  },
  // Hidrantes
  {
    kind: 'hydrant',
    intervalDays: 90,
    activityKind: 'functional_test',
    citation: 'NCh 1646 / NFPA 25',
    description: 'Test funcional trimestral del hidrante: presión, caudal, ausencia de fugas.',
  },
  // AED desfibrilador
  {
    kind: 'aed',
    intervalDays: 30,
    activityKind: 'functional_test',
    citation: 'DS 132 minería / Resolución 1234 MINSAL',
    description: 'Test funcional mensual del AED: batería, indicadores, electrodos vigentes.',
  },
  {
    kind: 'aed',
    intervalDays: 730, // 2 años — vida útil de pads
    activityKind: 'expiration_check',
    citation: 'Manual del fabricante AED',
    description: 'Reemplazar los electrodos del AED (vida útil 2 años desde fabricación).',
  },
  // Botiquín
  {
    kind: 'first_aid_kit',
    intervalDays: 90,
    activityKind: 'expiration_check',
    citation: 'DS 594 art. 17 — primeros auxilios',
    description: 'Chequear vencimiento de medicamentos, gasas, vendas. Reponer faltantes.',
  },
  // Duchas + lavaojos
  {
    kind: 'emergency_shower',
    intervalDays: 7,
    activityKind: 'functional_test',
    citation: 'ANSI Z358.1 / DS 594',
    description: 'Test funcional semanal: 3 minutos de flujo continuo, temperatura del agua.',
  },
  {
    kind: 'eye_wash_station',
    intervalDays: 7,
    activityKind: 'functional_test',
    citation: 'ANSI Z358.1 / DS 594',
    description: 'Test funcional semanal: caudal en ambos chorros, esterilidad del agua.',
  },
  // Detector de gas
  {
    kind: 'gas_detector',
    intervalDays: 180,
    activityKind: 'calibration',
    citation: 'OSHA 1910.146 / fabricante',
    description: 'Calibración semestral del detector con gases patrón certificados.',
  },
  // Señalética
  {
    kind: 'sign_evacuation',
    intervalDays: 180,
    activityKind: 'visual_inspection',
    citation: 'NCh 1410',
    description: 'Revisión semestral de señalética: visibilidad, integridad, fotoluminiscencia.',
  },
];

/** Devuelve los schedules aplicables a un kind dado (puede haber varios). */
export function getSchedulesForKind(kind: PlacedObjectKind): MaintenanceSchedule[] {
  return MAINTENANCE_SCHEDULES.filter((s) => s.kind === kind);
}

// ─────────────────────────────────────────────────────────────────────
// SPEC — qué se debe escribir cuando un objeto cambia de estado.
// ─────────────────────────────────────────────────────────────────────

/**
 * Spec de un nodo Zettelkasten que el orchestrator quiere crear.
 *
 * Coincide con `Omit<RiskNode, 'id' | 'createdAt' | 'updatedAt'>` para que
 * el caller pueda pasarlo directo a `useRiskEngine.addNode(spec)` sin
 * adaptaciones. El `type` siempre es `NodeType.CONTROL` — los objetos
 * de seguridad físicos (extintores, AEDs, hidrantes, señalética) caen
 * en la categoría "Control" del Zettelkasten.
 *
 * Para el camino server-side via `writeNodes()`, usar `toRiskNodePayload(spec)`
 * que mapea a la forma `RiskNodePayload` (con `references` derivado de
 * `metadata.citations`).
 */
export interface ZkNodeSpec {
  /** Tipo de nodo Zettelkasten. Siempre `NodeType.CONTROL` para objetos de seguridad. */
  type: NodeType;
  /** Título legible (ej. "Extintor PQS — extinguisher_pqs (e1)"). */
  title: string;
  /** Texto descriptivo (para indexar + búsquedas). */
  description: string;
  /** Tags para clasificación (kind, lifecycle, 'control-material', 'safety'). */
  tags: string[];
  /** Conexiones a otras entidades (projectId, objectId, eventos previos). */
  connections: string[];
  /** Project ID al que pertenece. Opcional en RiskNode pero siempre lo seteamos. */
  projectId: string;
  /**
   * Metadata estructurada — incluye campos del lifecycle (objectId, lifecycle,
   * geo, occurredAt, actorUserId, citations array) y outputs numéricos. La UI
   * y los reportes lo leen para reconstruir el contexto del control físico.
   */
  metadata: Record<string, number | string | boolean | null | string[] | { lat: number; lng: number; altitudeM?: number }>;
}

/**
 * Convierte un `ZkNodeSpec` al shape `RiskNodePayload` esperado por la
 * persistencia server-side (`writeNodes` / POST `/api/zettelkasten/nodes`).
 * Usa `metadata.citations` como `references` y mapea el `type` a
 * `'safety-learning'` (única opción no-Bernoulli en `RiskNodeType`).
 */
export function toRiskNodePayload(spec: ZkNodeSpec): RiskNodePayload {
  const citations = (spec.metadata.citations as string[] | undefined) ?? [];
  const lifecycle = String(spec.metadata.lifecycle ?? '');
  const severity: RiskNodeSeverity =
    lifecycle === 'maintenance_due' || lifecycle === 'retired' ? 'medium' : 'info';
  return {
    title: spec.title,
    description: spec.description,
    type: 'safety-learning',
    severity,
    metadata: Object.fromEntries(
      Object.entries(spec.metadata).filter(([, v]) =>
        v === null ||
        typeof v === 'number' ||
        typeof v === 'string' ||
        typeof v === 'boolean',
      ),
    ) as Record<string, number | string | boolean | null>,
    connections: spec.connections,
    references: citations,
  };
}

/**
 * Spec de un evento calendario. Compatible con Google Calendar Events
 * API + nuestro propio store interno (cuando exista). El caller adapta
 * al backend correcto.
 */
export interface CalendarEventSpec {
  /** Título legible. */
  title: string;
  /** Descripción completa con cita normativa. */
  description: string;
  /** ISO 8601 — comienzo del evento. */
  startIso: string;
  /** Duración en minutos (default 30). */
  durationMinutes: number;
  /** Tipo de actividad — drive icon + filtros. */
  activityKind: MaintenanceActivityKind;
  /** Recurrencia RRULE (ej. "FREQ=MONTHLY"). Vacío si one-shot. */
  rrule?: string;
  /** Referencia al objeto físico. */
  relatedObjectId: string;
  /** Cuadrilla (crew) responsable opcional. */
  assignedCrewId?: string;
  /** Project ID. */
  projectId: string;
  /** Citas normativas (DS 594, NCh, etc.). */
  citations: string[];
}

export interface LifecycleTransitionResult {
  /** Nodo ZK que debe persistirse. Vacío si el lifecycle change no genera nodo. */
  zkNodeSpec: ZkNodeSpec | null;
  /** Eventos calendar que deben crearse (puede estar vacío). */
  calendarEventSpecs: CalendarEventSpec[];
  /** Mensajes informativos para mostrar al usuario. */
  userMessages: string[];
}

// ─────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────

export interface LifecycleTransitionInput {
  /** Estado anterior del objeto. `null` cuando es la primera vez. */
  previous: PlacedObject | null;
  /** Estado nuevo. */
  next: PlacedObject;
  /** Project ID. */
  projectId: string;
  /** Usuario que originó el cambio (audit). */
  actorUserId?: string;
  /** Cuadrilla responsable opcional — se vincula a los eventos calendario. */
  assignedCrewId?: string;
  /** Catálogo de schedules a usar (default: MAINTENANCE_SCHEDULES global). */
  schedules?: ReadonlyArray<MaintenanceSchedule>;
  /** Override de "ahora" para tests. Default Date.now(). */
  now?: () => number;
}

/**
 * Computa los specs ZK + calendar para una transición de lifecycle.
 * NO persiste — devuelve specs.
 *
 * Reglas:
 *   - planning → planning: no genera spec adicional (solo mover en el twin).
 *   - * → installed: crea ZK node + calendar events para todos los
 *     schedules aplicables al kind.
 *   - * → maintenance_due: crea ZK node de tipo "alerta" (sin reschedule).
 *   - * → retired: crea ZK node final con history; sin más calendar events.
 *   - first time (previous=null) en planning: crea ZK node "planning"
 *     pero SIN calendar events (todavía no es físico).
 */
export function deriveLifecycleTransition(
  input: LifecycleTransitionInput,
): LifecycleTransitionResult {
  const { previous, next, projectId, actorUserId, assignedCrewId } = input;
  const schedules = input.schedules ?? MAINTENANCE_SCHEDULES;
  const now = (input.now ?? Date.now)();

  const nextLifecycle = next.lifecycle;
  const previousLifecycle = previous?.lifecycle ?? null;
  const tags = [next.kind, nextLifecycle, 'control-material', 'safety'];

  const result: LifecycleTransitionResult = {
    zkNodeSpec: null,
    calendarEventSpecs: [],
    userMessages: [],
  };

  // (1) ZK node spec — siempre que haya un cambio relevante.
  const lifecycleChanged = previousLifecycle !== nextLifecycle;
  const positionChanged =
    previous &&
    (previous.position.x !== next.position.x ||
      previous.position.y !== next.position.y ||
      previous.position.z !== next.position.z);
  const isFirstTime = previous === null;

  if (isFirstTime || lifecycleChanged || positionChanged) {
    const citations = schedules
      .filter((s) => s.kind === next.kind)
      .map((s) => s.citation)
      .filter((c, i, arr) => arr.indexOf(c) === i);
    const connections = [projectId, next.id];
    const metadata: ZkNodeSpec['metadata'] = {
      objectId: next.id,
      objectKind: next.kind,
      lifecycle: nextLifecycle,
      previousLifecycle: previousLifecycle ?? '',
      occurredAt: now,
      citations,
    };
    if (next.geo) metadata.geo = next.geo;
    if (actorUserId) metadata.actorUserId = actorUserId;
    if (next.notes) metadata.notes = next.notes;

    result.zkNodeSpec = {
      type: NodeType.CONTROL,
      title: `${humanKind(next.kind)} (${next.id})`,
      description: buildDescription(next, previousLifecycle),
      tags,
      connections,
      projectId,
      metadata,
    };
  }

  // (2) Calendar events — solo cuando se instala físicamente.
  if (
    nextLifecycle === 'installed' &&
    previousLifecycle !== 'installed' &&
    previousLifecycle !== 'active'
  ) {
    const applicableSchedules = schedules.filter((s) => s.kind === next.kind);
    for (const sched of applicableSchedules) {
      const startIso = new Date(now + sched.intervalDays * 86_400_000).toISOString();
      result.calendarEventSpecs.push({
        title: `${humanKind(next.kind)} — ${humanActivity(sched.activityKind)}`,
        description: `${sched.description}\n\nObjeto: ${next.id}\nCita: ${sched.citation}`,
        startIso,
        durationMinutes: 30,
        activityKind: sched.activityKind,
        rrule: rruleForInterval(sched.intervalDays),
        relatedObjectId: next.id,
        assignedCrewId,
        projectId,
        citations: [sched.citation],
      });
    }
    result.userMessages.push(
      `${result.calendarEventSpecs.length} evento(s) de mantención agendado(s) según normativa.`,
    );
  }

  // (3) Retiro — al pasar a retired no se reagenda nada (los próximos
  //     eventos del Calendar deberían cancelarse — caller responsibility).
  if (nextLifecycle === 'retired' && previousLifecycle !== 'retired') {
    result.userMessages.push(
      `Objeto retirado. Los eventos pendientes de mantención asociados deben cancelarse.`,
    );
  }

  return result;
}

function buildDescription(obj: PlacedObject, previousLifecycle: PlacedObjectLifecycle | null): string {
  const transition = previousLifecycle
    ? `Cambio: ${previousLifecycle} → ${obj.lifecycle}`
    : `Inicio: estado ${obj.lifecycle}`;
  const geoNote = obj.geo
    ? ` Geo: ${obj.geo.lat.toFixed(6)}, ${obj.geo.lng.toFixed(6)}.`
    : '';
  const notes = obj.notes ? ` ${obj.notes}` : '';
  return `${humanKind(obj.kind)} (${obj.id}). ${transition}.${geoNote}${notes}`.trim();
}

function humanKind(kind: PlacedObjectKind): string {
  const map: Record<PlacedObjectKind, string> = {
    extinguisher_pqs: 'Extintor PQS',
    extinguisher_co2: 'Extintor CO2',
    extinguisher_water: 'Extintor de agua',
    hydrant: 'Hidrante',
    sign_evacuation: 'Señal de evacuación',
    sign_warning: 'Señal de advertencia',
    sign_mandatory: 'Señal obligatoria',
    sign_prohibition: 'Señal de prohibición',
    aed: 'Desfibrilador automático (AED)',
    first_aid_kit: 'Botiquín de primeros auxilios',
    emergency_shower: 'Ducha de emergencia',
    eye_wash_station: 'Lavaojos',
    gas_detector: 'Detector de gas',
    spill_kit: 'Kit anti-derrames',
    safety_shower: 'Ducha de seguridad',
    assembly_point: 'Punto de encuentro',
    evacuation_route: 'Vía de evacuación',
  };
  return map[kind] ?? kind;
}

function humanActivity(activity: MaintenanceActivityKind): string {
  const map: Record<MaintenanceActivityKind, string> = {
    visual_inspection: 'Inspección visual',
    pressure_test: 'Mantención y prueba',
    functional_test: 'Test funcional',
    expiration_check: 'Chequeo de vencimientos',
    calibration: 'Calibración',
    replacement: 'Reemplazo',
  };
  return map[activity] ?? activity;
}

function rruleForInterval(intervalDays: number): string | undefined {
  // iCalendar RRULE strings — cubrimos los casos comunes; el resto cae
  // a "every N days" interval.
  if (intervalDays === 7) return 'FREQ=WEEKLY';
  if (intervalDays === 30) return 'FREQ=MONTHLY';
  if (intervalDays === 90) return 'FREQ=MONTHLY;INTERVAL=3';
  if (intervalDays === 180) return 'FREQ=MONTHLY;INTERVAL=6';
  if (intervalDays === 365) return 'FREQ=YEARLY';
  if (intervalDays === 730) return 'FREQ=YEARLY;INTERVAL=2';
  return `FREQ=DAILY;INTERVAL=${intervalDays}`;
}
