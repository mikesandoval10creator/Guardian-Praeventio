import { describe, it, expect } from 'vitest';
import {
  landmarksToRebaInput,
  landmarksToRulaInput,
  computeJointAngles,
  angleAt,
  inclinationFromVertical,
  LM,
} from './landmarksToScore';
import { calculateReba } from './reba';
import { calculateRula } from './rula';
import type { PoseLandmark } from '../../hooks/useMediaPipePose';

// ─────────────────────────────────────────────────────────────────────
// Helper: construye un array de 33 landmarks con visibility=1.0 por
// defecto. Aceptamos overrides para los índices que importen al test.
// MediaPipe usa coordenadas de imagen: y crece hacia abajo, x hacia la
// derecha. z negativo = hacia la cámara.
// ─────────────────────────────────────────────────────────────────────

function makeLandmarks(
  overrides: Record<number, Partial<PoseLandmark>>
): PoseLandmark[] {
  const arr: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1.0,
  }));
  for (const [idx, partial] of Object.entries(overrides)) {
    const i = Number(idx);
    arr[i] = { ...arr[i], ...partial };
  }
  return arr;
}

/**
 * Postura recta vertical, mirando a la cámara, brazos colgando, piernas
 * extendidas. Todas las articulaciones en x≈0.5, y escalonado por altura.
 *   nose y=0.10, shoulders y=0.25, hips y=0.55, knees y=0.78, ankles y=0.95
 */
function neutralStandingLandmarks(): PoseLandmark[] {
  return makeLandmarks({
    [LM.NOSE]: { x: 0.5, y: 0.1, z: 0 },
    [LM.L_SHOULDER]: { x: 0.42, y: 0.25, z: 0 },
    [LM.R_SHOULDER]: { x: 0.58, y: 0.25, z: 0 },
    [LM.L_ELBOW]: { x: 0.42, y: 0.4, z: 0 },
    [LM.R_ELBOW]: { x: 0.58, y: 0.4, z: 0 },
    [LM.L_WRIST]: { x: 0.42, y: 0.55, z: 0 },
    [LM.R_WRIST]: { x: 0.58, y: 0.55, z: 0 },
    [LM.L_HIP]: { x: 0.45, y: 0.55, z: 0 },
    [LM.R_HIP]: { x: 0.55, y: 0.55, z: 0 },
    [LM.L_KNEE]: { x: 0.45, y: 0.78, z: 0 },
    [LM.R_KNEE]: { x: 0.55, y: 0.78, z: 0 },
    [LM.L_ANKLE]: { x: 0.45, y: 0.95, z: 0 },
    [LM.R_ANKLE]: { x: 0.55, y: 0.95, z: 0 },
  });
}

// ─────────────────────────────────────────────────────────────────────
// 0. Helpers matemáticos
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — math helpers', () => {
  it('angleAt: 90° entre vectores ortogonales', () => {
    const b: PoseLandmark = { x: 0, y: 0, z: 0, visibility: 1 };
    const a: PoseLandmark = { x: 1, y: 0, z: 0, visibility: 1 };
    const c: PoseLandmark = { x: 0, y: 1, z: 0, visibility: 1 };
    expect(angleAt(b, a, c)).toBeCloseTo(90, 1);
  });

  it('inclinationFromVertical: segmento hacia "arriba" (y decreciente) = 0°', () => {
    const from: PoseLandmark = { x: 0, y: 1, z: 0, visibility: 1 };
    const to: PoseLandmark = { x: 0, y: 0, z: 0, visibility: 1 };
    expect(inclinationFromVertical(from, to)).toBeCloseTo(0, 1);
  });

  it('inclinationFromVertical: segmento horizontal = 90°', () => {
    const from: PoseLandmark = { x: 0, y: 0, z: 0, visibility: 1 };
    const to: PoseLandmark = { x: 1, y: 0, z: 0, visibility: 1 };
    expect(inclinationFromVertical(from, to)).toBeCloseTo(90, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 1. Postura recta vertical → REBA score bajo (1-2)
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — neutral standing posture', () => {
  it('postura vertical relajada produce REBA score 1-3 (bajo riesgo)', () => {
    const lms = neutralStandingLandmarks();
    const input = landmarksToRebaInput(lms);
    const result = calculateReba(input);
    expect(result.finalScore).toBeGreaterThanOrEqual(1);
    expect(result.finalScore).toBeLessThanOrEqual(3);
    expect(['negligible', 'low']).toContain(result.actionLevel);
  });

  it('joint angles para postura vertical: tronco ≈ 0°, cuello ≈ 0°', () => {
    const j = computeJointAngles(neutralStandingLandmarks());
    expect(j.trunkFlexionDeg).toBeLessThan(5);
    expect(j.neckFlexionDeg).toBeLessThan(5);
    expect(j.upperArmFlexionDeg).toBeLessThan(5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Tronco flexionado ~60° → REBA score elevado
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — trunk heavy flexion', () => {
  it('tronco flexionado ~60° eleva REBA finalScore', () => {
    // Mantenemos las caderas, "tiramos" los hombros hacia adelante (x mayor)
    // y un poco hacia abajo. tan(60°) ≈ 1.73; con dy=0.30, dx ≈ 0.52.
    const lms = neutralStandingLandmarks();
    // Reposicionamos hombros: tronco hip(0.5,0.55) → shoulder(?, 0.25).
    // Para 60° desde vertical, tan(60°)=√3, dx/|dy|=√3. dy=-0.3 → dx=0.52.
    lms[LM.L_SHOULDER] = { x: 0.42 + 0.52, y: 0.4, z: 0, visibility: 1 };
    lms[LM.R_SHOULDER] = { x: 0.58 + 0.52, y: 0.4, z: 0, visibility: 1 };
    // Mantenemos la nariz alineada con los hombros para no inducir flexión
    // del cuello adicional.
    lms[LM.NOSE] = { x: 0.5 + 0.52, y: 0.25, z: 0, visibility: 1 };

    const j = computeJointAngles(lms);
    expect(j.trunkFlexionDeg).toBeGreaterThan(45);

    const result = calculateReba(landmarksToRebaInput(lms, { loadKg: 0 }));
    // Tronco severo + brazos en cualquier ángulo eleva el score por encima
    // del baseline de 1.
    expect(result.finalScore).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Brazo extendido lateralmente 90° → RULA upperArmScore 3
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — arm 90° abducted', () => {
  it('brazo levantado lateralmente ~90° produce RULA upperArmScore ≥ 3', () => {
    const lms = neutralStandingLandmarks();
    // Brazo derecho horizontal: del hombro (0.58, 0.25) hacia (0.78, 0.25).
    // El segmento queda horizontal → flexión "humana" 90°.
    lms[LM.R_ELBOW] = { x: 0.78, y: 0.25, z: 0, visibility: 1 };
    lms[LM.R_WRIST] = { x: 0.95, y: 0.25, z: 0, visibility: 1 };

    const j = computeJointAngles(lms);
    // upperArmFlexionDeg debería ser ≈ 90°.
    expect(j.upperArmFlexionDeg).toBeGreaterThan(70);
    expect(j.upperArmFlexionDeg).toBeLessThan(110);

    const rula = calculateRula(landmarksToRulaInput(lms));
    // 45-90° flex → score 3 en upperArm.
    expect(rula.details.upperArmScore).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Cuello flexionado ~30° → RULA neck score ≥ 2
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — neck flexion 30°', () => {
  it('cuello flexionado ~30° produce RULA neckScore ≥ 2', () => {
    const lms = neutralStandingLandmarks();
    // Hombros en (0.5, 0.25). Para flex de 30°, nariz a 30° desde vertical.
    // dy = 0.15 (hacia arriba: y menor), dx = dy*tan(30°) ≈ 0.087.
    lms[LM.NOSE] = { x: 0.5 + 0.087, y: 0.1, z: 0, visibility: 1 };

    const j = computeJointAngles(lms);
    expect(j.neckFlexionDeg).toBeGreaterThan(20);

    const rula = calculateRula(landmarksToRulaInput(lms));
    expect(rula.details.neckScore).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Landmarks faltantes (visibility < 0.5) → throws
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — low visibility handling', () => {
  it('hombros con visibility < 0.5 → lanza error explícito', () => {
    const lms = neutralStandingLandmarks();
    lms[LM.L_SHOULDER] = { ...lms[LM.L_SHOULDER], visibility: 0.2 };
    lms[LM.R_SHOULDER] = { ...lms[LM.R_SHOULDER], visibility: 0.3 };
    expect(() => computeJointAngles(lms)).toThrow(/visibility|visibles/i);
  });

  it('array con menos de 29 landmarks → lanza error', () => {
    const tooFew = Array.from({ length: 10 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 1,
    }));
    expect(() => computeJointAngles(tooFew)).toThrow(/29 landmarks/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Asimetría: usa el peor lado (conservadurismo)
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — asymmetric arms use worst side', () => {
  it('un brazo en 90° y el otro relajado → upperArmFlexionDeg refleja el peor', () => {
    const lms = neutralStandingLandmarks();
    // Brazo izquierdo permanece colgando. Brazo derecho horizontal.
    lms[LM.R_ELBOW] = { x: 0.78, y: 0.25, z: 0, visibility: 1 };
    lms[LM.R_WRIST] = { x: 0.95, y: 0.25, z: 0, visibility: 1 };

    const j = computeJointAngles(lms);
    // El peor lado (~90°) gana. Si tomara el brazo izquierdo (0°), sería <10.
    expect(j.upperArmFlexionDeg).toBeGreaterThan(70);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Adapter pasa loadKg a REBA correctamente
// ─────────────────────────────────────────────────────────────────────
describe('landmarksToScore — load propagation', () => {
  it('loadKg 12 con coupling poor eleva REBA finalScore', () => {
    const lms = neutralStandingLandmarks();
    const noLoad = calculateReba(landmarksToRebaInput(lms, { loadKg: 0 }));
    const heavy = calculateReba(
      landmarksToRebaInput(lms, { loadKg: 12, coupling: 'poor' })
    );
    expect(heavy.finalScore).toBeGreaterThan(noLoad.finalScore);
  });
});
