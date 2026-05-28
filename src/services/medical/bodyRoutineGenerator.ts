// Praeventio Guard — §12.6.5: HumanBodyViewer rutinas auto-generadas
// desde ergonomicAssessments.
//
// Cuando un trabajador tiene assessment REBA/RULA con score alto,
// generamos rutina de ejercicios compensatorios + estiramientos
// dirigidos a las regiones del cuerpo afectadas. La UI HumanBodyViewer
// muestra mapa anatómico con regiones highlighted + lista de ejercicios.
//
// Determinístico — basado en biblioteca de ejercicios curados (no LLM).
//
// Fuentes referenciales:
//   - NIOSH/OSHA stretch protocols
//   - DS 594 art. 110 Bis (pantallas + sedentarismo)
//   - DS 63 / Ley 20.001 (manejo manual cargas)
//   - American Academy of Orthopedic Surgeons (AAOS)

export type BodyRegion =
  | 'neck'
  | 'shoulders'
  | 'upper_back'
  | 'lower_back'
  | 'arms'
  | 'wrists'
  | 'hips'
  | 'knees'
  | 'ankles'
  | 'core';

export interface CompensatoryExercise {
  /** ID estable. */
  id: string;
  /** Nombre del ejercicio. */
  name: string;
  /** Regiones del cuerpo trabajadas. */
  regions: BodyRegion[];
  /** Duración recomendada en segundos. */
  durationSec: number;
  /** Repeticiones (si aplica). */
  repetitions?: number;
  /** Descripción paso a paso. */
  instructions: string[];
  /** Categoría: stretch/strength/mobility. */
  category: 'stretch' | 'strength' | 'mobility';
  /** Nivel dificultad. */
  difficulty: 'easy' | 'medium' | 'hard';
  /** Contraindicaciones (no hacer si...). */
  contraindications?: string[];
}

export interface BodyRoutine {
  /** ID estable de la rutina. */
  id: string;
  /** Nombre descriptivo. */
  name: string;
  /** Worker para quien se generó. */
  workerUid: string;
  /** Score REBA/RULA que motivó la generación. */
  triggeredByScore?: number;
  /** Regiones del cuerpo cubiertas. */
  targetRegions: BodyRegion[];
  /** Lista de ejercicios ordenados. */
  exercises: CompensatoryExercise[];
  /** Duración total estimada en minutos. */
  totalDurationMin: number;
  /** Frecuencia recomendada (e.g. "2× al día durante 4 semanas"). */
  recommendedFrequency: string;
  /** ISO 8601 generación. */
  generatedAt: string;
}

// Biblioteca curada de ejercicios. NO usar `as const` para que sea
// extensible runtime (cuando agreguemos catálogo desde Firestore).
const EXERCISE_LIBRARY: CompensatoryExercise[] = [
  {
    id: 'neck_lateral_stretch',
    name: 'Estiramiento lateral de cuello',
    regions: ['neck'],
    durationSec: 30,
    repetitions: 2,
    instructions: [
      'Sentarse o pararse derecho.',
      'Inclinar suavemente la cabeza al hombro derecho (sin levantar el hombro).',
      'Mantener 15 segundos. Volver al centro.',
      'Repetir al lado izquierdo.',
    ],
    category: 'stretch',
    difficulty: 'easy',
    contraindications: ['Vértigo agudo', 'Lesión cervical reciente'],
  },
  {
    id: 'shoulder_rolls',
    name: 'Círculos de hombros',
    regions: ['shoulders', 'upper_back'],
    durationSec: 60,
    repetitions: 10,
    instructions: [
      'Pararse con brazos relajados a los lados.',
      'Rodar hombros hacia atrás en círculos amplios — 10 reps.',
      'Repetir hacia adelante — 10 reps.',
    ],
    category: 'mobility',
    difficulty: 'easy',
  },
  {
    id: 'thoracic_extension',
    name: 'Extensión torácica',
    regions: ['upper_back', 'shoulders'],
    durationSec: 60,
    instructions: [
      'Sentarse al borde de una silla con respaldo bajo.',
      'Manos detrás de la cabeza, codos abiertos.',
      'Inclinarse hacia atrás sobre el respaldo, abriendo el pecho.',
      'Mantener 5 segundos. Repetir 10 veces.',
    ],
    category: 'mobility',
    difficulty: 'medium',
  },
  {
    id: 'cat_camel',
    name: 'Gato-camello (gato)',
    regions: ['lower_back', 'core', 'upper_back'],
    durationSec: 90,
    repetitions: 10,
    instructions: [
      'En 4 puntos, manos bajo hombros y rodillas bajo caderas.',
      'Inspirar, hundir el abdomen, alzar la cabeza (camello).',
      'Espirar, encorvar la espalda como gato.',
      'Repetir 10 veces lentamente.',
    ],
    category: 'mobility',
    difficulty: 'easy',
  },
  {
    id: 'hip_flexor_stretch',
    name: 'Estiramiento flexor de cadera',
    regions: ['hips', 'lower_back'],
    durationSec: 60,
    repetitions: 2,
    instructions: [
      'Posición de zancada profunda con rodilla trasera en piso.',
      'Avanzar las caderas hacia adelante hasta sentir estiramiento.',
      'Mantener 30 segundos cada lado.',
    ],
    category: 'stretch',
    difficulty: 'medium',
  },
  {
    id: 'wrist_flexor_stretch',
    name: 'Estiramiento flexores de muñeca',
    regions: ['wrists', 'arms'],
    durationSec: 30,
    repetitions: 2,
    instructions: [
      'Brazo extendido al frente, palma hacia arriba.',
      'Con la otra mano, tirar suavemente los dedos hacia el cuerpo.',
      'Mantener 15 segundos. Repetir con la otra mano.',
    ],
    category: 'stretch',
    difficulty: 'easy',
  },
  {
    id: 'plank',
    name: 'Plancha frontal',
    regions: ['core', 'shoulders'],
    durationSec: 60,
    repetitions: 3,
    instructions: [
      'Posición de plancha sobre codos.',
      'Cuerpo recto desde cabeza a talones.',
      'Mantener 20 segundos. Descansar 10s. Repetir 3 veces.',
    ],
    category: 'strength',
    difficulty: 'medium',
    contraindications: ['Lumbalgia aguda', 'Hernia discal sin liberación médica'],
  },
  {
    id: 'glute_bridge',
    name: 'Puente glúteo',
    regions: ['hips', 'lower_back', 'core'],
    durationSec: 90,
    repetitions: 12,
    instructions: [
      'Boca arriba, rodillas flexionadas, pies en piso.',
      'Levantar caderas formando línea recta hombro-rodilla.',
      'Mantener 2 segundos arriba. Bajar lento.',
      'Repetir 12 veces.',
    ],
    category: 'strength',
    difficulty: 'easy',
  },
  {
    id: 'ankle_circles',
    name: 'Círculos de tobillo',
    regions: ['ankles'],
    durationSec: 60,
    repetitions: 10,
    instructions: [
      'Sentado, levantar un pie del piso.',
      'Hacer 10 círculos amplios con el tobillo en cada dirección.',
      'Cambiar de pie.',
    ],
    category: 'mobility',
    difficulty: 'easy',
  },
  {
    id: 'wall_sit',
    name: 'Sentadilla isométrica en pared',
    regions: ['knees', 'core'],
    durationSec: 60,
    repetitions: 3,
    instructions: [
      'Espalda apoyada en pared, pies a 50cm de la pared.',
      'Deslizarse hasta que muslos queden paralelos al piso.',
      'Mantener 20 segundos. Descansar. Repetir 3 veces.',
    ],
    category: 'strength',
    difficulty: 'medium',
    contraindications: ['Dolor agudo de rodilla', 'Lesión meniscal sin liberación'],
  },
];

/**
 * Mapea score REBA a regiones del cuerpo prioritarias.
 * REBA: 0-3 = bajo, 4-7 = medio, 8-10 = alto, 11+ = muy alto.
 */
function regionsForRebaScore(score: number): BodyRegion[] {
  if (score >= 11) {
    return ['neck', 'upper_back', 'lower_back', 'shoulders', 'hips', 'knees', 'core'];
  } else if (score >= 8) {
    return ['neck', 'upper_back', 'lower_back', 'shoulders', 'hips'];
  } else if (score >= 4) {
    return ['neck', 'shoulders', 'lower_back'];
  } else {
    return ['neck']; // mantenimiento preventivo
  }
}

/**
 * Mapea score RULA (1-4) a regiones (RULA enfoca brazos/cuello/postura
 * sedentaria).
 */
function regionsForRulaScore(score: number): BodyRegion[] {
  if (score >= 7) {
    return ['neck', 'shoulders', 'arms', 'wrists', 'upper_back', 'lower_back'];
  } else if (score >= 5) {
    return ['neck', 'shoulders', 'arms', 'wrists', 'upper_back'];
  } else if (score >= 3) {
    return ['neck', 'shoulders', 'wrists'];
  } else {
    return ['wrists']; // mantenimiento preventivo
  }
}

export interface GenerateRoutineInput {
  workerUid: string;
  assessmentType: 'REBA' | 'RULA';
  score: number;
  /** ISO 8601 timestamp generación. */
  generatedAt: string;
  /** Filtro opcional: excluir ejercicios con estos contraindications. */
  excludeContraindications?: string[];
  /** Máximo ejercicios en la rutina (default 5). */
  maxExercises?: number;
  /** ID generador (debe ser único para evitar collision). */
  routineId: string;
}

/**
 * Genera rutina de ejercicios compensatorios desde assessment.
 *
 * Algoritmo:
 *   1. Mapear score a regiones afectadas
 *   2. Filtrar ejercicios que cubran al menos 1 región
 *   3. Excluir ejercicios con contraindications del usuario
 *   4. Tomar top-N por overlap regional + diversidad de category
 *   5. Calcular duración total + recomendación frecuencia
 */
export function generateRoutineFromAssessment(
  input: GenerateRoutineInput,
): BodyRoutine {
  const regions =
    input.assessmentType === 'REBA'
      ? regionsForRebaScore(input.score)
      : regionsForRulaScore(input.score);

  // Filter exercises that target at least one of the regions
  const candidates = EXERCISE_LIBRARY.filter((ex) =>
    ex.regions.some((r) => regions.includes(r)),
  );

  // Filter out excluded contraindications
  const filtered = candidates.filter((ex) => {
    if (!ex.contraindications || !input.excludeContraindications) return true;
    return !ex.contraindications.some((c) =>
      input.excludeContraindications!.some((excluded) =>
        c.toLowerCase().includes(excluded.toLowerCase()),
      ),
    );
  });

  // Take top N maximizing region coverage + category diversity
  const max = input.maxExercises ?? 5;
  const selected: CompensatoryExercise[] = [];
  const coveredCategories = new Set<string>();
  const sorted = [...filtered].sort((a, b) => {
    // Priorizar ejercicios que cubran más regiones afectadas
    const aOverlap = a.regions.filter((r) => regions.includes(r)).length;
    const bOverlap = b.regions.filter((r) => regions.includes(r)).length;
    return bOverlap - aOverlap;
  });

  for (const ex of sorted) {
    if (selected.length >= max) break;
    // Bias hacia diversidad de category
    if (selected.length < 2 || !coveredCategories.has(ex.category)) {
      selected.push(ex);
      coveredCategories.add(ex.category);
    }
  }

  // Fill remaining slots si quedan menos de max
  for (const ex of sorted) {
    if (selected.length >= max) break;
    if (!selected.includes(ex)) selected.push(ex);
  }

  const totalDurationMin = Math.ceil(
    selected.reduce((acc, e) => acc + e.durationSec, 0) / 60,
  );

  const frequency = recommendFrequency(input.score, input.assessmentType);

  return {
    id: input.routineId,
    name: `Rutina ${input.assessmentType} score ${input.score}`,
    workerUid: input.workerUid,
    triggeredByScore: input.score,
    targetRegions: regions,
    exercises: selected,
    totalDurationMin,
    recommendedFrequency: frequency,
    generatedAt: input.generatedAt,
  };
}

function recommendFrequency(
  score: number,
  type: 'REBA' | 'RULA',
): string {
  if (type === 'REBA') {
    if (score >= 11) return '3× al día durante 4 semanas + evaluación médica';
    if (score >= 8) return '2× al día durante 4 semanas';
    if (score >= 4) return '1× al día durante 4 semanas';
    return '3× por semana mantenimiento preventivo';
  } else {
    // RULA 1-7
    if (score >= 7) return '3× al día + pausa cada 30min en pantalla';
    if (score >= 5) return '2× al día + pausa cada hora';
    if (score >= 3) return '1× al día + pausa cada 2h';
    return '3× por semana preventivo';
  }
}

/**
 * Exporta biblioteca pública para UI que quiera mostrar catálogo completo.
 */
export function getExerciseLibrary(): CompensatoryExercise[] {
  return [...EXERCISE_LIBRARY];
}
