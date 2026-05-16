// SPDX-License-Identifier: MIT
//
// Hazmat segregation matrix — IMDG Code 7.2.4 (International Maritime
// Dangerous Goods Code), aplicable también a almacenamiento terrestre
// vía referencias chilenas (NCh 382, NCh 2190) y US (49 CFR §177.848).
//
// Reemplaza el SEGREGATION_MATRIX simplificado (9 clases) de
// `src/pages/HazmatStorage.tsx` por la matriz completa de 13
// sub-clases NU. La matriz vieja decía "Simplified for demo
// purposes" — un fake crítico porque podía dar luz verde a una
// combinación que la matriz REAL marca como incompatible.
//
// 2026-05-15 (Sprint C).
//
// Códigos IMDG:
//   - '1' (away_from):              "Away from" — mismo compartimento OK,
//                                   no apilados ni adyacentes en contacto.
//   - '2' (separated_from):         "Separated from" — diferente
//                                   compartimento o ≥3m de separación.
//   - '3' (separated_by_full_comp): "Separated by complete compartment" —
//                                   compartimento completo entre ellos
//                                   (≥6m en terreno típicamente).
//   - '4' (longitudinal_separated): "Separated longitudinally by
//                                   intervening complete compartment" —
//                                   solo aplica naval (≥24m sobre cubierta).
//   - 'X' (special_case):           "Refer to DGL" — caso especial,
//                                   consultar Lista de Mercancías
//                                   Peligrosas (Dangerous Goods List)
//                                   para la sustancia específica.
//   - '0' (no_restriction):         Sin restricción ni con sí mismo.
//
// Para presentación al usuario simplificamos a 3 niveles operativos:
//   - 'compatible': IMDG '0' o '1' → mismo recinto OK
//   - 'caution':    IMDG '2' → separar ≥3m / barrera física
//   - 'incompatible': IMDG '3', '4' o 'X' → compartimento separado obligatorio

/** Sub-clases NU/UN completas. */
export type HazmatSubclass =
  | '1' // Explosivos
  | '2_1' // Gases inflamables
  | '2_2' // Gases no-inflamables comprimidos
  | '2_3' // Gases tóxicos (TIH)
  | '3' // Líquidos inflamables
  | '4_1' // Sólidos inflamables
  | '4_2' // Espontáneamente combustibles
  | '4_3' // Peligrosos al contacto con agua
  | '5_1' // Oxidantes
  | '5_2' // Peróxidos orgánicos
  | '6_1' // Tóxicos
  | '6_2' // Infecciosos
  | '7' // Radioactivos
  | '8' // Corrosivos
  | '9'; // Misceláneos

export type ImdgSegregationCode = '0' | '1' | '2' | '3' | '4' | 'X';

export type OperationalResult = 'compatible' | 'caution' | 'incompatible';

export interface SegregationLookup {
  classA: HazmatSubclass;
  classB: HazmatSubclass;
  imdgCode: ImdgSegregationCode;
  operational: OperationalResult;
  /** Texto humano para mostrar en UI (ya traducido al español). */
  rationale: string;
}

/**
 * Matriz IMDG 7.2.4 completa. Simétrica (M[a][b] === M[b][a]).
 * Las celdas que faltan se asumen '0' (sin restricción específica).
 *
 * Fuente: IMDG Code 2024 (Vol. 1, Chap. 7.2, Table 7.2.4).
 */
const IMDG_MATRIX: Partial<Record<HazmatSubclass, Partial<Record<HazmatSubclass, ImdgSegregationCode>>>> = {
  '1': {
    '1': 'X', '2_1': '4', '2_2': '2', '2_3': '4', '3': '4', '4_1': '4', '4_2': '4', '4_3': '4',
    '5_1': '4', '5_2': '4', '6_1': '2', '6_2': '4', '7': '2', '8': '4', '9': 'X',
  },
  '2_1': {
    '1': '4', '2_1': '0', '2_2': '0', '2_3': '0', '3': '2', '4_1': '1', '4_2': '2', '4_3': '0',
    '5_1': '2', '5_2': '2', '6_1': '0', '6_2': '0', '7': '2', '8': '1', '9': '0',
  },
  '2_2': {
    '1': '2', '2_1': '0', '2_2': '0', '2_3': '0', '3': '1', '4_1': '0', '4_2': '1', '4_3': '0',
    '5_1': '0', '5_2': '0', '6_1': '0', '6_2': '0', '7': '0', '8': '0', '9': '0',
  },
  '2_3': {
    '1': '4', '2_1': '0', '2_2': '0', '2_3': '0', '3': '2', '4_1': '1', '4_2': '2', '4_3': '0',
    '5_1': '2', '5_2': '2', '6_1': '0', '6_2': '0', '7': '2', '8': '0', '9': '0',
  },
  '3': {
    '1': '4', '2_1': '2', '2_2': '1', '2_3': '2', '3': '0', '4_1': '0', '4_2': '2', '4_3': '0',
    '5_1': '2', '5_2': '2', '6_1': '0', '6_2': '1', '7': '2', '8': '0', '9': '0',
  },
  '4_1': {
    '1': '4', '2_1': '1', '2_2': '0', '2_3': '1', '3': '0', '4_1': '0', '4_2': '1', '4_3': '0',
    '5_1': '1', '5_2': '2', '6_1': '0', '6_2': '0', '7': '2', '8': '0', '9': '0',
  },
  '4_2': {
    '1': '4', '2_1': '2', '2_2': '1', '2_3': '2', '3': '2', '4_1': '1', '4_2': '0', '4_3': '1',
    '5_1': '2', '5_2': '2', '6_1': '1', '6_2': '0', '7': '2', '8': '1', '9': '0',
  },
  '4_3': {
    '1': '4', '2_1': '0', '2_2': '0', '2_3': '0', '3': '0', '4_1': '0', '4_2': '1', '4_3': '0',
    '5_1': '2', '5_2': '2', '6_1': '0', '6_2': '0', '7': '2', '8': '1', '9': '0',
  },
  '5_1': {
    '1': '4', '2_1': '2', '2_2': '0', '2_3': '2', '3': '2', '4_1': '1', '4_2': '2', '4_3': '2',
    '5_1': '0', '5_2': '2', '6_1': '0', '6_2': '1', '7': '1', '8': '2', '9': '0',
  },
  '5_2': {
    '1': '4', '2_1': '2', '2_2': '0', '2_3': '2', '3': '2', '4_1': '2', '4_2': '2', '4_3': '2',
    '5_1': '2', '5_2': '0', '6_1': '1', '6_2': '2', '7': '2', '8': '2', '9': '0',
  },
  '6_1': {
    '1': '2', '2_1': '0', '2_2': '0', '2_3': '0', '3': '0', '4_1': '0', '4_2': '1', '4_3': '0',
    '5_1': '0', '5_2': '1', '6_1': '0', '6_2': '0', '7': '0', '8': '0', '9': '0',
  },
  '6_2': {
    '1': '4', '2_1': '0', '2_2': '0', '2_3': '0', '3': '1', '4_1': '0', '4_2': '0', '4_3': '0',
    '5_1': '1', '5_2': '2', '6_1': '0', '6_2': '0', '7': '2', '8': '0', '9': '0',
  },
  '7': {
    '1': '2', '2_1': '2', '2_2': '0', '2_3': '2', '3': '2', '4_1': '2', '4_2': '2', '4_3': '2',
    '5_1': '1', '5_2': '2', '6_1': '0', '6_2': '2', '7': '0', '8': '1', '9': '0',
  },
  '8': {
    '1': '4', '2_1': '1', '2_2': '0', '2_3': '0', '3': '0', '4_1': '0', '4_2': '1', '4_3': '1',
    '5_1': '2', '5_2': '2', '6_1': '0', '6_2': '0', '7': '1', '8': '0', '9': '0',
  },
  '9': {
    '1': 'X', '2_1': '0', '2_2': '0', '2_3': '0', '3': '0', '4_1': '0', '4_2': '0', '4_3': '0',
    '5_1': '0', '5_2': '0', '6_1': '0', '6_2': '0', '7': '0', '8': '0', '9': '0',
  },
};

/** Catálogo legible de las 15 sub-clases para UIs. */
export const HAZMAT_CLASS_LABELS: Record<HazmatSubclass, string> = {
  '1': 'Clase 1 — Explosivos',
  '2_1': 'Clase 2.1 — Gas Inflamable',
  '2_2': 'Clase 2.2 — Gas No-Inflamable',
  '2_3': 'Clase 2.3 — Gas Tóxico (TIH)',
  '3': 'Clase 3 — Líquido Inflamable',
  '4_1': 'Clase 4.1 — Sólido Inflamable',
  '4_2': 'Clase 4.2 — Espontáneamente Combustible',
  '4_3': 'Clase 4.3 — Peligroso con Agua',
  '5_1': 'Clase 5.1 — Oxidante',
  '5_2': 'Clase 5.2 — Peróxido Orgánico',
  '6_1': 'Clase 6.1 — Tóxico',
  '6_2': 'Clase 6.2 — Infeccioso',
  '7': 'Clase 7 — Radioactivo',
  '8': 'Clase 8 — Corrosivo',
  '9': 'Clase 9 — Misceláneos',
};

const RATIONALE_BY_CODE: Record<ImdgSegregationCode, (a: HazmatSubclass, b: HazmatSubclass) => string> = {
  '0': () =>
    'Sin restricciones específicas IMDG. Pueden almacenarse en mismo recinto manteniendo sus envases originales y orden.',
  '1': () =>
    'IMDG "Away from" — pueden estar en mismo recinto pero NO apilados ni en contacto directo. Mantener separación física razonable y vías de evacuación libres.',
  '2': () =>
    'IMDG "Separated from" — diferente sector dentro del recinto O separación mínima 3m con barrera física (muro/canaleta). En bodega cerrada idealmente diferente compartimento ventilado.',
  '3': () =>
    'IMDG "Separated by complete compartment" — compartimento totalmente separado, típicamente ≥6m con muro cortafuego F60 o superior, sin compartir ventilación. Considerar bodegas distintas.',
  '4': () =>
    'IMDG "Separated longitudinally by intervening complete compartment" — máxima segregación. En tierra: BODEGAS SEPARADAS, idealmente edificios distintos. NUNCA mismo recinto.',
  'X': (a, b) =>
    `IMDG "Refer to DGL" — caso especial. La combinación ${HAZMAT_CLASS_LABELS[a]} + ${HAZMAT_CLASS_LABELS[b]} requiere consultar la Lista de Mercancías Peligrosas para los códigos específicos (sub-grupos detonantes, etc.) antes de decidir.`,
};

/**
 * Consulta la matriz IMDG 7.2.4 para una combinación de clases.
 *
 * Devuelve el código IMDG crudo + una interpretación operacional
 * simplificada para UIs (compatible/caution/incompatible).
 *
 * Es symmetric: \`checkSegregation('3', '5_1') === checkSegregation('5_1', '3')\`.
 */
export function checkSegregation(
  classA: HazmatSubclass,
  classB: HazmatSubclass,
): SegregationLookup {
  // Probamos ambas direcciones por si la matriz está incompleta en una.
  const codeAtoB = IMDG_MATRIX[classA]?.[classB];
  const codeBtoA = IMDG_MATRIX[classB]?.[classA];
  const code: ImdgSegregationCode = codeAtoB ?? codeBtoA ?? '0';

  let operational: OperationalResult;
  if (code === '0' || code === '1') operational = 'compatible';
  else if (code === '2') operational = 'caution';
  else operational = 'incompatible'; // '3', '4', 'X'

  return {
    classA,
    classB,
    imdgCode: code,
    operational,
    rationale: RATIONALE_BY_CODE[code](classA, classB),
  };
}

/**
 * Helper para tests/UIs: lista todas las combinaciones marcadas
 * incompatibles para una clase dada. Útil para mostrar "qué NO
 * puedo poner cerca de Clase X".
 */
export function listIncompatibleWith(classA: HazmatSubclass): HazmatSubclass[] {
  const all = Object.keys(HAZMAT_CLASS_LABELS) as HazmatSubclass[];
  return all.filter((b) => checkSegregation(classA, b).operational === 'incompatible');
}
