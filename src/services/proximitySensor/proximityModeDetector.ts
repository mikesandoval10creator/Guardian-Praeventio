// Praeventio Guard — Sprint 49 C.3: Proximity Sensor + Mode Detection.
//
// Cierra C.3 del plan maestro (capacitor-proximity sensor de
// bolsillo/casco). Plugin @capgo/capacitor-proximity instalado.
//
// Política Guardian:
//   - inPocket (sensor close + accelerometer mostly still): aumentar
//     sensibilidad detección impactos, desactivar toques accidentales
//   - nearCasco (proximity close + tilted hands-free): activar modo
//     conducción / operación maquinaria
//   - inAir (sensor far + accelerometer moving): modo normal
//
// El motor es PURO. El caller wirea el plugin nativo y este motor
// clasifica readings + decide transiciones.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ProximityState = 'near' | 'far';

export interface AccelerometerSample {
  x: number;
  y: number;
  z: number;
  /** Magnitud en G (9.81 m/s² = 1G). */
  magnitudeG: number;
  /** ISO-8601. */
  at: string;
}

export interface ProximityReading {
  state: ProximityState;
  /** ISO-8601. */
  at: string;
}

export type DeviceMode =
  | 'normal'           // mano + visible + visible
  | 'in_pocket'        // proximity near + accel quiet → bolsillo
  | 'near_head'        // proximity near + accel mostly still + tilted → llamada/cabeza
  | 'in_helmet_mount'  // proximity near sostenido + accel inclinado fijo → montaje casco
  | 'face_down';       // proximity near + accel inverted → cara abajo

export interface ModeDetectorState {
  currentMode: DeviceMode;
  /** Cuándo entró al modo actual. */
  enteredAt: string;
  /** Confianza 0-1 en la clasificación. */
  confidence: number;
  /** Razones detrás de la decisión (audit). */
  reasons: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Heuristics
// ────────────────────────────────────────────────────────────────────────

const ACCEL_QUIET_THRESHOLD_G = 1.05; // ±0.05G de gravedad neta = device estático
const POCKET_DURATION_MS = 5_000; // 5s consistente para "in_pocket"

function isAccelQuiet(sample: AccelerometerSample): boolean {
  return Math.abs(sample.magnitudeG - 1.0) < (ACCEL_QUIET_THRESHOLD_G - 1.0);
}

/**
 * Detecta si el dispositivo está inclinado en helmet mount (z lateral
 * dominante, magnitud cercana a 1G = fijo).
 */
function isHelmetMounted(sample: AccelerometerSample): boolean {
  if (!isAccelQuiet(sample)) return false;
  // Casco: z eje suele estar entre 0.4-0.7 (tilt 45-60°)
  const tilt = Math.abs(sample.z) / sample.magnitudeG;
  return tilt > 0.4 && tilt < 0.85;
}

/**
 * Detecta si el dispositivo está cara abajo (y eje invertido +
 * magnitud cercana a 1G).
 */
function isFaceDown(sample: AccelerometerSample): boolean {
  if (!isAccelQuiet(sample)) return false;
  return sample.y < -0.85; // cara abajo: y ≈ -1
}

/**
 * Detecta si está en bolsillo: proximity near + accel quiet o caminata
 * típica (~1.5G picos).
 */
function isInPocket(
  proximity: ProximityState,
  recentAccel: ReadonlyArray<AccelerometerSample>,
): boolean {
  if (proximity !== 'near') return false;
  if (recentAccel.length === 0) return false;
  const avg = recentAccel.reduce((s, a) => s + a.magnitudeG, 0) / recentAccel.length;
  // Bolsillo durante caminata: 0.8-1.5G promedio (impactos paso)
  return avg > 0.7 && avg < 1.5;
}

// ────────────────────────────────────────────────────────────────────────
// Detection API
// ────────────────────────────────────────────────────────────────────────

export interface DetectionInput {
  proximity: ProximityReading;
  recentAccelerometer: ReadonlyArray<AccelerometerSample>;
  /** Estado previo (para detectar entradas/salidas). */
  previousMode?: ModeDetectorState;
  now: Date;
}

export function classifyMode(input: DetectionInput): ModeDetectorState {
  const reasons: string[] = [];
  let mode: DeviceMode = 'normal';
  let confidence = 0.7;

  const latestAccel = input.recentAccelerometer[input.recentAccelerometer.length - 1];

  if (input.proximity.state === 'far') {
    mode = 'normal';
    reasons.push('proximity=far → modo visible normal');
    confidence = 0.9;
  } else if (latestAccel && isFaceDown(latestAccel)) {
    mode = 'face_down';
    reasons.push('y eje invertido + accel quiet → cara abajo (posible caída inconsciente)');
    confidence = 0.85;
  } else if (latestAccel && isHelmetMounted(latestAccel)) {
    mode = 'in_helmet_mount';
    reasons.push('proximity=near + tilt 45-60° estable → montaje casco');
    confidence = 0.8;
  } else if (isInPocket(input.proximity.state, input.recentAccelerometer)) {
    mode = 'in_pocket';
    reasons.push('proximity=near + accel pattern bolsillo (paseo/quieto) → in_pocket');
    confidence = 0.75;
  } else {
    mode = 'near_head';
    reasons.push('proximity=near + accel sin pattern claro → cerca cabeza (llamada/lectura cercana)');
    confidence = 0.6;
  }

  // Stickiness: si previousMode coincide, mantén enteredAt original
  const enteredAt =
    input.previousMode?.currentMode === mode
      ? input.previousMode.enteredAt
      : input.now.toISOString();

  return { currentMode: mode, enteredAt, confidence, reasons };
}

// ────────────────────────────────────────────────────────────────────────
// Policy: qué hace el sistema en cada modo
// ────────────────────────────────────────────────────────────────────────

export interface ModePolicy {
  /** Multiplier para sensibilidad de fall detection (más alto = más sensible). */
  fallDetectionMultiplier: number;
  /** Si los toques accidentales en pantalla se ignoran. */
  suppressAccidentalTaps: boolean;
  /** Si la UI cambia a modo manos-libres (voz). */
  enableVoiceMode: boolean;
  /** Si activa heartbeat acelerado para SOS proactivo. */
  acceleratedHeartbeat: boolean;
  /** Si pide check-in voluntario al usuario (face_down sospechoso). */
  promptManualCheckin: boolean;
}

export function policyForMode(mode: DeviceMode): ModePolicy {
  switch (mode) {
    case 'in_pocket':
      return {
        fallDetectionMultiplier: 1.3,
        suppressAccidentalTaps: true,
        enableVoiceMode: false,
        acceleratedHeartbeat: false,
        promptManualCheckin: false,
      };
    case 'in_helmet_mount':
      return {
        fallDetectionMultiplier: 1.5,
        suppressAccidentalTaps: true,
        enableVoiceMode: true,
        acceleratedHeartbeat: true,
        promptManualCheckin: false,
      };
    case 'face_down':
      return {
        fallDetectionMultiplier: 2.0,
        suppressAccidentalTaps: false,
        enableVoiceMode: false,
        acceleratedHeartbeat: true,
        promptManualCheckin: true, // posible inconsciente → escalación
      };
    case 'near_head':
      return {
        fallDetectionMultiplier: 1.0,
        suppressAccidentalTaps: true,
        enableVoiceMode: false,
        acceleratedHeartbeat: false,
        promptManualCheckin: false,
      };
    case 'normal':
    default:
      return {
        fallDetectionMultiplier: 1.0,
        suppressAccidentalTaps: false,
        enableVoiceMode: false,
        acceleratedHeartbeat: false,
        promptManualCheckin: false,
      };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Plugin contract (DI for tests)
// ────────────────────────────────────────────────────────────────────────

export interface ProximityPluginContract {
  /** Suscribe a cambios de proximity. Returns un handle para unsubscribe. */
  addListener(
    eventName: 'proximityChanged',
    cb: (e: { state: 'near' | 'far'; timestamp: number }) => void,
  ): { remove(): Promise<void> };
  /** Lectura puntual del sensor. */
  getCurrent(): Promise<{ state: 'near' | 'far' }>;
}
