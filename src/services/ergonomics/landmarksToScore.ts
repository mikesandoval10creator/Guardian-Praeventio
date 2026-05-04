/**
 * landmarksToScore — convierte 33 landmarks 3D MediaPipe Pose en los inputs
 * deterministas que consumen `calculateReba` y `calculateRula`.
 *
 * Reglas de diseño:
 *   - Pura matemática 3D (vectores, ángulos). Sin DOM, sin browser APIs.
 *     → Testeable end-to-end con vitest sin requerir WebAssembly.
 *   - Asimetría: cuando los lados izquierdo/derecho difieren, se usa el
 *     PEOR ángulo (más alejado de neutro) por conservadurismo ergonómico.
 *   - Visibilidad: si todos los landmarks de un segmento tienen
 *     `visibility < MIN_VISIBILITY`, el helper lanza un error explícito —
 *     el caller decide caer al fallback (Gemini) o pedir otra foto.
 *   - Carga (REBA load.kg / RULA force.kg): NO se puede inferir desde la
 *     imagen. Se acepta `loadKg` como input opcional que el modal pide al
 *     usuario; default = 0.
 *
 * Índices de landmarks (MediaPipe Pose 33-point schema):
 *   0  nose
 *   11 left shoulder         12 right shoulder
 *   13 left elbow            14 right elbow
 *   15 left wrist            16 right wrist
 *   23 left hip              24 right hip
 *   25 left knee             26 right knee
 *   27 left ankle            28 right ankle
 */

import type { PoseLandmark } from '../../hooks/useMediaPipePose';
import type { RebaInput } from './reba';
import type { RulaInput } from './rula';

// ─────────────────────────────────────────────────────────────────────
// Constantes de schema
// ─────────────────────────────────────────────────────────────────────

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
} as const;

const MIN_VISIBILITY = 0.5;

// ─────────────────────────────────────────────────────────────────────
// Vector helpers (3D)
// ─────────────────────────────────────────────────────────────────────

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function mag(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Ángulo (en grados) entre tres puntos, con `b` como vértice. */
export function angleAt(b: PoseLandmark, a: PoseLandmark, c: PoseLandmark): number {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const m1 = mag(v1);
  const m2 = mag(v2);
  if (m1 === 0 || m2 === 0) return 0;
  const cosTheta = Math.max(-1, Math.min(1, dot(v1, v2) / (m1 * m2)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * Ángulo de inclinación de un segmento `from→to` respecto al eje vertical
 * (eje Y de MediaPipe; en imagen 2D, Y crece hacia abajo).
 *
 * Devuelve un valor en grados:
 *   0°    = segmento perfectamente vertical (apuntando hacia arriba/abajo).
 *   90°   = segmento horizontal.
 *   180°  = segmento vertical invertido.
 *
 * El signo (flexión vs extensión) lo decide el caller comparando z o el
 * eje horizontal según el contexto (tronco/cuello: flexión hacia adelante
 * suele significar `to.z > from.z` con la cámara enfrente).
 */
export function inclinationFromVertical(from: PoseLandmark, to: PoseLandmark): number {
  const v = sub(to, from);
  const m = mag(v);
  if (m === 0) return 0;
  // Eje vertical "hacia arriba" en MediaPipe imagen = (0, -1, 0).
  const upY = -1;
  const cosTheta = Math.max(-1, Math.min(1, (v.y * upY) / m));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

// ─────────────────────────────────────────────────────────────────────
// Visibility & midpoints
// ─────────────────────────────────────────────────────────────────────

function visibleEnough(...lms: PoseLandmark[]): boolean {
  return lms.every((l) => (l?.visibility ?? 0) >= MIN_VISIBILITY);
}

function midpoint(a: PoseLandmark, b: PoseLandmark): PoseLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 0, b.visibility ?? 0),
  };
}

function ensureLandmarks(landmarks: PoseLandmark[]): void {
  if (!Array.isArray(landmarks) || landmarks.length < 29) {
    throw new Error(
      `landmarksToScore: se esperan al menos 29 landmarks (recibidos ${landmarks?.length ?? 0}).`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cálculo de ángulos articulares "humanos" (flexión/extensión en grados)
// ─────────────────────────────────────────────────────────────────────

interface JointAngles {
  trunkFlexionDeg: number;
  neckFlexionDeg: number;
  /** Peor lado (mayor flexión) entre brazo izq./der. */
  upperArmFlexionDeg: number;
  /** Peor lado: ángulo articular del codo (180 = extendido, 90 = flexionado). */
  lowerArmFlexionDeg: number;
  /** Peor lado: flexión rodilla (0 = recta). */
  kneeFlexionDeg: number;
  /** True si la diferencia entre piernas sugiere apoyo unilateral. */
  asymmetricStance: boolean;
}

/** Convierte ángulo articular del codo (0..180°) en "flexión REBA/RULA":
 *  el worksheet considera 100° como rango neutro de codo (mano frente al
 *  cuerpo). Aquí mapeamos: jointAngle 180° → 0° flex, 90° → 90° flex. */
function elbowJointToFlexion(jointAngleDeg: number): number {
  return 180 - jointAngleDeg;
}

/** Calcula los ángulos clave a partir de los landmarks. */
export function computeJointAngles(landmarks: PoseLandmark[]): JointAngles {
  ensureLandmarks(landmarks);

  const lShoulder = landmarks[LM.L_SHOULDER];
  const rShoulder = landmarks[LM.R_SHOULDER];
  const lHip = landmarks[LM.L_HIP];
  const rHip = landmarks[LM.R_HIP];
  const nose = landmarks[LM.NOSE];

  if (!visibleEnough(lShoulder, rShoulder, lHip, rHip)) {
    throw new Error(
      'landmarksToScore: hombros o caderas no visibles (visibility < 0.5). Recapturar imagen con cuerpo completo.'
    );
  }

  const shoulderMid = midpoint(lShoulder, rShoulder);
  const hipMid = midpoint(lHip, rHip);

  // Tronco: ángulo entre (hip→shoulder) y vertical.
  const trunkFlexionDeg = inclinationFromVertical(hipMid, shoulderMid);

  // Cuello: ángulo entre (shoulder→nose) y vertical.
  const neckFlexionDeg = visibleEnough(nose)
    ? inclinationFromVertical(shoulderMid, nose)
    : 0;

  // Brazos: flexión = inclinación del segmento shoulder→elbow respecto al
  // tronco (aprox. respecto a la vertical, ya que el tronco se asume
  // vertical en la cámara). Tomamos el peor lado.
  const lElbow = landmarks[LM.L_ELBOW];
  const rElbow = landmarks[LM.R_ELBOW];
  const lUpperArmDeg = visibleEnough(lShoulder, lElbow)
    ? inclinationFromVertical(lShoulder, lElbow)
    : 0;
  const rUpperArmDeg = visibleEnough(rShoulder, rElbow)
    ? inclinationFromVertical(rShoulder, rElbow)
    : 0;
  // El brazo "neutro" cuelga hacia abajo (180° respecto a "up"); convertimos
  // a "flexión humana": brazo abajo = 0°, brazo arriba/adelante = 90°+.
  const lUaFlex = Math.abs(180 - lUpperArmDeg);
  const rUaFlex = Math.abs(180 - rUpperArmDeg);
  const upperArmFlexionDeg = Math.max(lUaFlex, rUaFlex);

  // Antebrazos: ángulo articular en el codo (shoulder-elbow-wrist).
  const lWrist = landmarks[LM.L_WRIST];
  const rWrist = landmarks[LM.R_WRIST];
  const lElbowJoint = visibleEnough(lShoulder, lElbow, lWrist)
    ? angleAt(lElbow, lShoulder, lWrist)
    : 90;
  const rElbowJoint = visibleEnough(rShoulder, rElbow, rWrist)
    ? angleAt(rElbow, rShoulder, rWrist)
    : 90;
  // REBA/RULA esperan flexión: 90° = óptimo, mucho menos o mucho más = malo.
  // Reportamos el ángulo articular crudo y dejamos que el adapter lo
  // interprete (REBA/RULA usan rangos 60-100°).
  const lowerArmFlexionDeg = Math.min(lElbowJoint, rElbowJoint);

  // Piernas: flexión rodilla.
  const lKnee = landmarks[LM.L_KNEE];
  const rKnee = landmarks[LM.R_KNEE];
  const lAnkle = landmarks[LM.L_ANKLE];
  const rAnkle = landmarks[LM.R_ANKLE];
  const lKneeAngle = visibleEnough(lHip, lKnee, lAnkle)
    ? angleAt(lKnee, lHip, lAnkle)
    : 180;
  const rKneeAngle = visibleEnough(rHip, rKnee, rAnkle)
    ? angleAt(rKnee, rHip, rAnkle)
    : 180;
  // Flexión = 180 - ángulo articular.
  const lKneeFlex = 180 - lKneeAngle;
  const rKneeFlex = 180 - rKneeAngle;
  const kneeFlexionDeg = Math.max(lKneeFlex, rKneeFlex);

  // Apoyo unilateral: diferencia significativa de altura de tobillos.
  const ankleDiffY =
    visibleEnough(lAnkle, rAnkle) ? Math.abs(lAnkle.y - rAnkle.y) : 0;
  // Threshold: 5% de la altura de imagen (landmarks normalizados 0..1).
  const asymmetricStance = ankleDiffY > 0.05;

  return {
    trunkFlexionDeg,
    neckFlexionDeg,
    upperArmFlexionDeg,
    lowerArmFlexionDeg,
    kneeFlexionDeg,
    asymmetricStance,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Adapters → REBA / RULA inputs
// ─────────────────────────────────────────────────────────────────────

export interface AdapterOptions {
  /** Carga manipulada por el trabajador. Default 0 (sin carga). */
  loadKg?: number;
  /** REBA: marca shock o movimiento rápido. */
  shockOrRapid?: boolean;
  /** REBA coupling. Default 'good'. */
  coupling?: RebaInput['coupling'];
  /** RULA force pattern. Default 'intermittent'. */
  forcePattern?: RulaInput['force']['pattern'];
}

export function landmarksToRebaInput(
  landmarks: PoseLandmark[],
  opts: AdapterOptions = {}
): RebaInput {
  const j = computeJointAngles(landmarks);
  // El ángulo articular del codo (0..180) se convierte en "flexión REBA"
  // donde 90° (codo doblado) → REBA flex 90°, 180° (codo extendido) → 0°.
  // Reusamos `lowerArmFlexionDeg` que ya viene como ángulo articular crudo;
  // REBA califica 60-100° como "neutro" (1) — pasamos el ángulo articular.
  return {
    trunk: { flexionDeg: round(j.trunkFlexionDeg) },
    neck: { flexionDeg: round(j.neckFlexionDeg) },
    legs: {
      bilateralSupport: !j.asymmetricStance,
      kneeFlexionDeg: round(Math.max(0, j.kneeFlexionDeg)),
    },
    upperArm: { flexionDeg: round(j.upperArmFlexionDeg) },
    lowerArm: { flexionDeg: round(j.lowerArmFlexionDeg) },
    wrist: { flexionDeg: 0 }, // landmarks de muñeca no dan flexión fina; default neutro.
    load: { kg: opts.loadKg ?? 0, shockOrRapid: opts.shockOrRapid ?? false },
    coupling: opts.coupling ?? 'good',
    activity: {},
  };
}

export function landmarksToRulaInput(
  landmarks: PoseLandmark[],
  opts: AdapterOptions = {}
): RulaInput {
  const j = computeJointAngles(landmarks);
  return {
    upperArm: { flexionDeg: round(j.upperArmFlexionDeg) },
    lowerArm: { flexionDeg: round(j.lowerArmFlexionDeg) },
    wrist: { flexionDeg: 0 },
    wristTwist: 'mid',
    neck: { flexionDeg: round(j.neckFlexionDeg) },
    trunk: {
      flexionDeg: round(j.trunkFlexionDeg),
      wellSupported: false,
    },
    legs: { supportedAndBalanced: !j.asymmetricStance },
    muscleUse: {},
    force: {
      kg: opts.loadKg ?? 0,
      pattern: opts.forcePattern ?? 'intermittent',
    },
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
