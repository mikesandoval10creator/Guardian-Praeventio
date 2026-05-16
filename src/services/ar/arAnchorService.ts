// SPDX-License-Identifier: MIT
//
// AR Anchor Service — tipos + lógica de negocio para anclas AR
// persistentes por proyecto.
//
// 2026-05-16 (Sprint F — Realidad Aumentada Real):
// El usuario describió la visión completa:
//
//   "los nodos de información en la maquinaria de la empresa con
//    coordenadas, esa información es privada por proyecto"
//
//   "ayudar a ordenar una bodega — donde podemos placear cosas y
//    ver dónde van"
//
//   "mediante el ar real, podría dirigir la cámara hacia el afiche
//    de seguridad y genera una animación relacionada"
//
// Este servicio cubre el modelo de datos común a las 3 historias:
// un ANCHOR AR es un punto 3D en el mundo (lat/lng + altura + matriz
// rotación) asociado a un proyecto, con metadata tipada que describe
// qué se muestra en ese punto.
//
// Tres tipos de anchor (extensible):
//   - MachineryAnchor: pegado a una máquina, muestra info de seguridad
//   - WarehouseObjectAnchor: representación virtual de un objeto físico
//     que el usuario "placea" en AR para planificación
//   - PosterAnchor: posición donde se escaneó un poster (caché de
//     coordenadas para mostrar la animación sin volver a escanear)
//
// Pattern matches `deaService.ts` + `deaFirestoreAdapter.ts` (Sprint C):
// service puro (tipos + business logic determinístico), adapter aparte
// para Firestore wire.

/**
 * Coordenadas WGS84 + altura ortométrica. La altura es opcional
 * porque WebXR `local-floor` reference space ya las usa relativas al
 * suelo detectado por hit-test.
 */
export interface GpsCoordinates {
  latitude: number;
  longitude: number;
  altitudeM?: number;
}

/**
 * Matriz 4x4 column-major (compatible Three.js `Matrix4.elements`).
 * Persiste posición + rotación del anchor en el local-space del XRSession.
 *
 * Para casos sin matriz (e.g. iOS Quick Look sin XR session), usamos
 * `{ x, y, z }` simples y dejamos los demás 13 valores en cero.
 */
export type AnchorMatrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type AnchorKind = 'machinery' | 'warehouse_object' | 'poster';

/**
 * Anchor genérico — el discriminator `kind` decide qué metadata aplica.
 *
 * IMPORTANTE: el path Firestore es
 *   `tenants/{tid}/projects/{pid}/ar_anchors/{id}`
 *
 * Esto cumple la directiva del usuario: "información es privada por
 * proyecto". Las firestore.rules ya enforcing el tenant-scoping en
 * `match /tenants/{tenantId}` (cerrado en PR #271).
 */
export interface BaseAnchor {
  id: string;
  /** Proyecto al que pertenece (scoping de privacidad). */
  projectId: string;
  /** Tenant — redundante con el path pero útil en queries cross-collection. */
  tenantId: string;
  /** UID del usuario que creó el anchor (audit + permission gate). */
  createdByUid: string;
  /** ISO timestamp creación. */
  createdAt: string;
  /** Última modificación. */
  updatedAt: string;
  /** Coordenadas GPS aproximadas del faena (para listar "anchors cerca"). */
  gps: GpsCoordinates;
  /** Matriz transformación local respecto al XRReferenceSpace 'local'. */
  matrix: AnchorMatrix4;
  /** Label visible en AR. */
  label: string;
  /** Tags libres para filtros UI. */
  tags?: string[];
}

export interface MachineryAnchor extends BaseAnchor {
  kind: 'machinery';
  /** ID del equipo en el inventario (cross-ref `equipment` collection). */
  equipmentId: string;
  /** Resumen de info que se muestra en la card AR. */
  info: {
    /** ID interno del equipo (display). */
    code: string;
    /** Última inspección OK (ISO). */
    lastInspectionAt?: string;
    /** UID de quien la firmó. */
    lastInspectionBy?: string;
    /** Próximo mantenimiento programado. */
    nextMaintenanceAt?: string;
    /** Alertas activas (count) — vienen de incidentes/findings linked. */
    activeAlertCount?: number;
  };
}

export interface WarehouseObjectAnchor extends BaseAnchor {
  kind: 'warehouse_object';
  /**
   * Tipo de objeto placeado. Debe coincidir con `ArKind` en
   * `src/components/ar/ArViewLink.tsx` (los modelos .glb que existen).
   */
  objectType:
    | 'extinguisher_pqs'
    | 'extinguisher_co2'
    | 'extinguisher_water'
    | 'hydrant'
    | 'aed'
    | 'first_aid_kit'
    | 'sign_evacuation'
    | 'sign_warning'
    | 'sign_mandatory'
    | 'sign_prohibition'
    | 'emergency_shower'
    | 'eye_wash_station'
    | 'gas_detector'
    | 'spill_kit'
    | 'safety_shower'
    | 'assembly_point'
    | 'evacuation_route';
  /** Si está pendiente de aprobación física (ej. "comprar y poner aquí"). */
  status: 'planned' | 'installed' | 'removed';
  /** Notas del que lo placeó. */
  notes?: string;
}

export interface PosterAnchor extends BaseAnchor {
  kind: 'poster';
  /** ID del poster en el catálogo (cross-ref `posterCatalog.ts`). */
  posterId: string;
  /** Cuántas veces se ha escaneado este anchor (telemetría). */
  scanCount: number;
}

export type ArAnchor = MachineryAnchor | WarehouseObjectAnchor | PosterAnchor;

// ────────────────────────────────────────────────────────────────────
// Business logic puro (sin I/O — testeable directo)
// ────────────────────────────────────────────────────────────────────

/**
 * Construye una matriz identity con solo la posición seteada.
 * Útil cuando solo tenemos {x,y,z} (e.g. tap simple sin tracking de rotación).
 */
export function matrixFromPosition(x: number, y: number, z: number): AnchorMatrix4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

/**
 * Extrae la posición {x,y,z} de una AnchorMatrix4 (column-major).
 */
export function positionFromMatrix(m: AnchorMatrix4): { x: number; y: number; z: number } {
  return { x: m[12], y: m[13], z: m[14] };
}

/**
 * Distancia euclidiana 3D entre dos anchors (en metros, asumiendo el
 * local-space de Three.js es metros — que lo es para WebXR).
 */
export function distanceM(a: BaseAnchor, b: BaseAnchor): number {
  const pa = positionFromMatrix(a.matrix);
  const pb = positionFromMatrix(b.matrix);
  const dx = pa.x - pb.x;
  const dy = pa.y - pb.y;
  const dz = pa.z - pb.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Genera un ID único para un anchor. Determinístico-ish — combina
 * kind + ts + 6 bytes random hex.
 */
export function newAnchorId(kind: AnchorKind): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `ar-${kind}-${ts}-${rnd}`;
}

/**
 * Valida que una matriz tenga shape correcto (16 numbers, sin NaN/Infinity).
 * Útil antes de persistir — un anchor con matriz inválida rompería el render.
 */
export function isValidMatrix(m: unknown): m is AnchorMatrix4 {
  if (!Array.isArray(m)) return false;
  if (m.length !== 16) return false;
  return m.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Filtra anchors por proyecto Y por kind opcional. Pure — usable en
 * tests o en hooks que reciben la lista completa.
 */
export function filterAnchors<T extends ArAnchor>(
  anchors: ArAnchor[],
  opts: { projectId: string; kind?: AnchorKind; tags?: string[] },
): T[] {
  return anchors.filter((a) => {
    if (a.projectId !== opts.projectId) return false;
    if (opts.kind && a.kind !== opts.kind) return false;
    if (opts.tags && opts.tags.length > 0) {
      const aTags = a.tags ?? [];
      if (!opts.tags.every((t) => aTags.includes(t))) return false;
    }
    return true;
  }) as T[];
}

/**
 * Detecta proximidad ENTRE 2 anchors de tipos potencialmente
 * incompatibles. Pensado para warehouse planning: si placean un
 * extintor CO2 cerca de un evacuation_route, el sistema sugiere
 * mover. Reusa la decisión semántica — no la matriz IMDG (eso es
 * para sustancias químicas, no para EPP estático).
 *
 * Devuelve la lista de pares cuyo `distanceM` es menor al threshold.
 */
export function findProximityPairs(
  anchors: WarehouseObjectAnchor[],
  thresholdM: number,
): Array<{ a: WarehouseObjectAnchor; b: WarehouseObjectAnchor; distanceM: number }> {
  const pairs: Array<{ a: WarehouseObjectAnchor; b: WarehouseObjectAnchor; distanceM: number }> = [];
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const a = anchors[i]!;
      const b = anchors[j]!;
      const d = distanceM(a, b);
      if (d <= thresholdM) {
        pairs.push({ a, b, distanceM: d });
      }
    }
  }
  return pairs;
}
