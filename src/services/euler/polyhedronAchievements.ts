// SPDX-License-Identifier: MIT
/**
 * Característica de Euler V-E+F=2 — Fase 10 del plan Euler-Matrix
 * (Gamificación con Poliedros).
 *
 * Para todo poliedro convexo se cumple: número de vértices menos
 * número de aristas más número de caras es igual a 2.
 *
 *   V - E + F = 2  (χ = 2 — característica de Euler)
 *
 * Aplicación a prevención: gamificación. Los logros de aprendizaje
 * normativo se modelan como poliedros — cada vértice es un quiz
 * correcto, cada arista es una conexión normativa entendida (p. ej.,
 * "Ley 16.744 + DS 594" leídos juntos), y cada cara es un módulo
 * completado. La geometría asegura que los logros sean inherentemente
 * proporcionados — no se puede "saltar" la dificultad: la fórmula
 * impone consistencia entre los tres tipos de progreso.
 *
 * Origen: Euler 1758 ("Elementa doctrinae solidorum"). La fórmula
 * fue independientemente notada por Descartes ~1630 (en su manuscrito
 * "De solidorum elementis", redescubierto en 1860) pero Euler la
 * publicó primero. Es un invariante topológico — cualquier
 * deformación que preserve la conectividad preserva χ. Por eso
 * sirve como ancla de coherencia: si un sistema reporta logros que
 * violan V-E+F=2, sabemos que la contabilidad está rota antes de
 * que el usuario lo note.
 *
 * Pareja físico-matemática: junto con `graphConnectivity` (Euler
 * 1736 — Königsberg) y los buckets de carga crítica / ODE, esta
 * fase cierra el plan Euler-Matrix con una aplicación didáctica
 * que conecta geometría pura con aprendizaje normativo. La
 * formalización geométrica disciplina la gamificación contra el
 * antipatrón "puntos por aire" — todo logro tiene una topología
 * verificable.
 *
 * Pure functions, sin side effects, sin deps externas.
 */

/**
 * Los cinco sólidos platónicos. Todos satisfacen V - E + F = 2.
 * Three.js provee geometrías nativas para los cinco
 * (`TetrahedronGeometry`, `BoxGeometry` para el cubo,
 * `OctahedronGeometry`, `DodecahedronGeometry`,
 * `IcosahedronGeometry`) — sin deps adicionales.
 */
export type PolyhedronShape =
  | 'tetrahedron' // V=4, E=6, F=4 → χ=2
  | 'cube' // V=8, E=12, F=6 → χ=2
  | 'octahedron' // V=6, E=12, F=8 → χ=2
  | 'dodecahedron' // V=20, E=30, F=12 → χ=2
  | 'icosahedron'; // V=12, E=30, F=20 → χ=2

/** Especificación combinatoria de un poliedro: vértices, aristas, caras. */
export interface PolyhedronSpec {
  shape: PolyhedronShape;
  /** Vértices (V). */
  V: number;
  /** Aristas (E). */
  E: number;
  /** Caras (F). */
  F: number;
}

/**
 * Tabla canónica de los 5 sólidos platónicos. `as const` la hace
 * inmutable a nivel TypeScript — los consumidores no pueden
 * mutarla por error y romper la invariante V-E+F=2 que pinea esta
 * fase.
 */
export const PLATONIC_SOLIDS = {
  tetrahedron: { shape: 'tetrahedron', V: 4, E: 6, F: 4 },
  cube: { shape: 'cube', V: 8, E: 12, F: 6 },
  octahedron: { shape: 'octahedron', V: 6, E: 12, F: 8 },
  dodecahedron: { shape: 'dodecahedron', V: 20, E: 30, F: 12 },
  icosahedron: { shape: 'icosahedron', V: 12, E: 30, F: 20 },
} as const satisfies Record<PolyhedronShape, PolyhedronSpec>;

/**
 * χ = V - E + F. Para todo poliedro convexo es 2; para géneros
 * mayores (toro, doble toro, etc.) decrece de a -2 por cada asa,
 * pero esos casos no son admitidos en este sistema de logros.
 */
export function eulerCharacteristic(spec: { V: number; E: number; F: number }): number {
  return spec.V - spec.E + spec.F;
}

/**
 * True si el spec satisface V-E+F=2 Y no es la "esfera degenerada"
 * (V=1, E=0, F=1) que también cumple la fórmula pero no es un
 * poliedro convexo en el sentido geométrico.
 *
 * Caso límite documentado: {V:1, E:0, F:1} cumple V-E+F=2 pero
 * representa un punto-más-cara, no un poliedro real. Lo excluimos
 * exigiendo V >= 4 (el tetraedro es el poliedro convexo mínimo).
 */
export function isValidConvexPolyhedron(spec: { V: number; E: number; F: number }): boolean {
  if (spec.V < 4 || spec.E < 6 || spec.F < 4) return false;
  return eulerCharacteristic(spec) === 2;
}

/**
 * Progreso de un logro: cuántos vértices, aristas y caras del
 * poliedro objetivo ha desbloqueado el usuario hasta ahora.
 *
 * `chiPartial` se acerca a 2 conforme `completionPercent` se
 * acerca a 100. No es una métrica de "calidad" sino de
 * coherencia — si el progreso parcial está cerca de 2 antes de
 * 100 % es porque el usuario tiene un perfil "redondo" (vértices,
 * aristas y caras balanceadas). Si está lejos de 2, hay un sesgo
 * (p. ej., muchos quizzes pero pocos módulos completados).
 */
export interface AchievementProgress {
  shape: PolyhedronShape;
  unlockedV: number;
  unlockedE: number;
  unlockedF: number;
  /** Porcentaje acumulado: (V+E+F desbloqueados) / (V+E+F totales). 0-100. */
  completionPercent: number;
  /** χ_partial = unlockedV - unlockedE + unlockedF. Converge a 2 cuando completion → 100 %. */
  chiPartial: number;
  /** True cuando el poliedro está totalmente completado. */
  isComplete: boolean;
}

/**
 * Estado del quiz que mapea a progreso de poliedro.
 *  - correctAnswers → vértices.
 *  - topicalConnections (pares de temas entendidos juntos) → aristas.
 *  - modulesCompleted → caras.
 */
export interface QuizState {
  correctAnswers: number;
  topicalConnections: number;
  modulesCompleted: number;
}

/**
 * Mapea estado del quiz a progreso de un poliedro objetivo. Cap
 * (clamp) cada componente al máximo geométrico (V, E, F) — un
 * usuario no puede "sobrellenar" un tetraedro con 100 quizzes:
 * solo cuentan los primeros 4. Esto preserva la invariante
 * geométrica.
 */
export function progressFromQuiz(
  quiz: QuizState,
  target: PolyhedronShape,
): AchievementProgress {
  const spec = PLATONIC_SOLIDS[target];

  // Clamp a [0, max] para preservar la invariante. Negativos no
  // tienen sentido geométrico — los tratamos como 0.
  const unlockedV = clamp(Math.floor(quiz.correctAnswers), 0, spec.V);
  const unlockedE = clamp(Math.floor(quiz.topicalConnections), 0, spec.E);
  const unlockedF = clamp(Math.floor(quiz.modulesCompleted), 0, spec.F);

  const total = spec.V + spec.E + spec.F;
  const unlocked = unlockedV + unlockedE + unlockedF;
  const completionPercent = total === 0 ? 0 : (unlocked / total) * 100;

  const chiPartial = unlockedV - unlockedE + unlockedF;
  const isComplete =
    unlockedV === spec.V && unlockedE === spec.E && unlockedF === spec.F;

  return {
    shape: target,
    unlockedV,
    unlockedE,
    unlockedF,
    completionPercent,
    chiPartial,
    isComplete,
  };
}

/**
 * Sugerencia de poliedro según nivel del usuario. Un principiante
 * empieza por el tetraedro (4 vértices, accesible). Un avanzado
 * recibe el icosaedro (12 vértices, 30 aristas — el más exigente
 * en aristas/conexiones normativas).
 */
export function suggestedPolyhedron(
  userLevel: 'beginner' | 'intermediate' | 'advanced',
): PolyhedronShape {
  switch (userLevel) {
    case 'beginner':
      return 'tetrahedron';
    case 'intermediate':
      return 'cube';
    case 'advanced':
      return 'icosahedron';
  }
}

/** Clamp utility — sin deps. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}
