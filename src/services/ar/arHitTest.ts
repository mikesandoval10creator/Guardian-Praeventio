// Praeventio Guard — AR hit-test pure logic.
//
// El navegador entrega resultados de hit-test (un array de
// `XRHitTestResult` por frame). Esta capa es PURA y consume las poses
// resultantes (que el caller extrae con `result.getPose(refSpace)`) y
// decide:
//
//   - Si la pose es estable (no fluctúa frame-a-frame por jitter)
//   - Si el ángulo de la superficie es "horizontal-piso" / "vertical-pared"
//   - Si vale la pena renderizar el reticle (mover N veces por segundo es UX pobre)
//   - Si el usuario "tocó" y se debe convertir el reticle en un anchor
//
// Sin esto, el componente WebXR mezcla matemática de poses con
// lifecycle React + cleanup de XRFrame requestCallback — un nido de
// bugs.

/**
 * Vector 3D minimalista — usamos los components separados en lugar de
 * `Float32Array` para que sea trivialmente testeable.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Pose 6-DOF simplificada (posición + orientación quaternion). */
export interface Pose {
  position: Vec3;
  /** Quaternion XYZW. */
  orientation: { x: number; y: number; z: number; w: number };
}

export interface ReticleSnapshot {
  /** Pose detectada en el último frame de hit-test. null = no hay hit. */
  pose: Pose | null;
  /** Timestamp ms del frame. */
  capturedAtMs: number;
  /** Cuántos frames consecutivos tuvieron hit válido. */
  stabilityFrames: number;
  /** Clasificación de la superficie (heurística por orientación). */
  surfaceKind: SurfaceKind;
}

export type SurfaceKind = 'floor' | 'wall' | 'ceiling' | 'sloped' | 'unknown';

/** Estabilidad mínima antes de permitir "tap → place anchor". */
export const MIN_STABILITY_FRAMES = 5;
/** Distancia (en metros) que la pose puede saltar entre frames sin
 *  considerarse jitter. */
export const MAX_JITTER_METERS = 0.05;

// ────────────────────────────────────────────────────────────────────────
// Surface classification
// ────────────────────────────────────────────────────────────────────────

/**
 * Heurística para clasificar el tipo de superficie a partir del up-vector
 * de la pose (derivado del quaternion). Threshold en grados.
 *
 *   - horizontal arriba (up.y > 0.95) → floor o suelo de pasarela
 *   - horizontal abajo (up.y < -0.95) → ceiling (techo)
 *   - vertical (|up.y| < 0.3) → wall
 *   - intermedio → sloped (talud, rampa, terreno irregular)
 */
export function classifySurface(pose: Pose): SurfaceKind {
  const upY = quaternionUpY(pose.orientation);
  if (upY > 0.95) return 'floor';
  if (upY < -0.95) return 'ceiling';
  if (Math.abs(upY) < 0.3) return 'wall';
  return 'sloped';
}

/** Componente Y del vector "up" derivado del quaternion. */
function quaternionUpY(q: { x: number; y: number; z: number; w: number }): number {
  // Rotación de (0,1,0) por el quaternion. up.y = 1 - 2*(q.x² + q.z²)
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

// ────────────────────────────────────────────────────────────────────────
// Reticle accumulator (stability filter)
// ────────────────────────────────────────────────────────────────────────

/**
 * Reduce hit-test results frame a frame en un `ReticleSnapshot` que
 * mide estabilidad. Se reseta cuando la pose salta más de
 * `MAX_JITTER_METERS` (= probablemente nueva superficie).
 *
 * Esto evita el bug clásico "el reticle parpadea entre dos superficies
 * y el usuario tapea entre dos y se coloca el anchor en el aire".
 */
export function updateReticleSnapshot(
  prev: ReticleSnapshot | null,
  freshPose: Pose | null,
  nowMs: number,
): ReticleSnapshot {
  if (!freshPose) {
    return {
      pose: null,
      capturedAtMs: nowMs,
      stabilityFrames: 0,
      surfaceKind: 'unknown',
    };
  }
  const surface = classifySurface(freshPose);
  if (!prev || !prev.pose) {
    return {
      pose: freshPose,
      capturedAtMs: nowMs,
      stabilityFrames: 1,
      surfaceKind: surface,
    };
  }
  // Distancia entre poses para decidir si es "la misma" superficie.
  const dx = freshPose.position.x - prev.pose.position.x;
  const dy = freshPose.position.y - prev.pose.position.y;
  const dz = freshPose.position.z - prev.pose.position.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > MAX_JITTER_METERS || surface !== prev.surfaceKind) {
    // Reset — superficie distinta.
    return {
      pose: freshPose,
      capturedAtMs: nowMs,
      stabilityFrames: 1,
      surfaceKind: surface,
    };
  }
  // Misma superficie — incrementa stability + smooth position (EMA).
  const alpha = 0.7; // peso al pasado para suavizar
  const smoothed: Pose = {
    position: {
      x: prev.pose.position.x * alpha + freshPose.position.x * (1 - alpha),
      y: prev.pose.position.y * alpha + freshPose.position.y * (1 - alpha),
      z: prev.pose.position.z * alpha + freshPose.position.z * (1 - alpha),
    },
    orientation: freshPose.orientation,
  };
  return {
    pose: smoothed,
    capturedAtMs: nowMs,
    stabilityFrames: prev.stabilityFrames + 1,
    surfaceKind: surface,
  };
}

/**
 * True si el caller puede confiar en el reticle para colocar un anchor
 * (el usuario tapea sobre el reticle).
 */
export function canPlaceAnchor(snap: ReticleSnapshot | null): boolean {
  if (!snap || !snap.pose) return false;
  return snap.stabilityFrames >= MIN_STABILITY_FRAMES;
}

// ────────────────────────────────────────────────────────────────────────
// Anchor placement decision — qué tipo de marker se permite
// ────────────────────────────────────────────────────────────────────────

export type ArMarkerKind =
  | 'hazard_label' // peligro genérico — texto + icono
  | 'evacuation_route' // ruta de evacuación — flecha 3D
  | 'assembly_point' // punto de encuentro — esfera + label
  | 'extinguisher' // ubicación de extintor
  | 'first_aid' // botiquín
  | 'restricted_zone' // marca de zona restringida — color rojo
  | 'measurement_probe' // pin para mediciones (sonómetro, lux, gas)
  | 'note'; // anotación libre

/** Markers que SOLO pueden ir en piso (no walls / ceiling). */
const FLOOR_ONLY_MARKERS: ArMarkerKind[] = [
  'evacuation_route',
  'assembly_point',
];

/** Markers que SOLO pueden ir en wall (no piso). */
const WALL_ONLY_MARKERS: ArMarkerKind[] = ['extinguisher', 'first_aid'];

/**
 * Valida que un marker es válido para una superficie dada. El caller
 * usa esto para activar/desactivar opciones en el menu de placement.
 */
export function isMarkerKindValidForSurface(
  kind: ArMarkerKind,
  surface: SurfaceKind,
): boolean {
  if (FLOOR_ONLY_MARKERS.includes(kind)) {
    return surface === 'floor' || surface === 'sloped';
  }
  if (WALL_ONLY_MARKERS.includes(kind)) {
    return surface === 'wall';
  }
  // Resto: cualquier superficie excepto ceiling (ahí no se ven bien).
  return surface !== 'ceiling';
}

/**
 * Filtra el catálogo de markers por superficie + estabilidad. Devuelve
 * los kinds válidos en este momento. Si el reticle no está estable,
 * devuelve `[]` (UX: deshabilitar el menu).
 */
export function availableMarkerKinds(
  snap: ReticleSnapshot | null,
  catalog: ArMarkerKind[] = [
    'hazard_label',
    'evacuation_route',
    'assembly_point',
    'extinguisher',
    'first_aid',
    'restricted_zone',
    'measurement_probe',
    'note',
  ],
): ArMarkerKind[] {
  if (!canPlaceAnchor(snap)) return [];
  return catalog.filter((k) =>
    isMarkerKindValidForSurface(k, snap!.surfaceKind),
  );
}
