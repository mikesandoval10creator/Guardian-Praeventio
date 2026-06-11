/**
 * CEAL-SM/SUSESO — instrument definition (data only, no logic).
 *
 * Cuestionario de Evaluación del Ambiente Laboral – Salud Mental / SUSESO.
 * Mandatory Chilean instrument for psychosocial risk surveillance since
 * 2023-01-01 (replaces SUSESO/ISTAS21).
 *
 * LEGAL SOURCE (instrument): "Manual del Método Cuestionario CEAL-SM /
 * SUSESO", Superintendencia de Seguridad Social, Intendencia de Seguridad y
 * Salud en el Trabajo, edición vigente (PDF fechado 2023-12-27), descargado
 * de https://cealsm.suseso.cl/Manual_Metodo_Cuestionario_CEAL_vigente.pdf
 * — items y puntajes: Anexo Nº 1 "Cuestionario CEAL-SM/SUSESO, con puntajes
 * para revisión" (pp. 61-70); composición de dimensiones: secciones
 * 2.1.1–2.1.12 (pp. 6-12); puntos de corte: Tabla 2 (p. 27).
 *
 * LEGAL SOURCE (protocol): "Protocolo de Vigilancia de Riesgos Psicosociales
 * en el Trabajo", MINSAL, octubre 2022 (Resolución Exenta Nº 1448 de
 * 2022-10-11, vigencia 2023-01-01) — periodicidad (sección 8), validez de la
 * evaluación ≥60% (sección 9), puntaje del centro de trabajo (Tabla 3) y
 * estados de riesgo + acciones (Tabla 4).
 *
 * Every item text below is a VERBATIM transcription from the official Anexo
 * Nº 1. Do NOT edit wording, add items, or translate item text — it is legal
 * instrument text (the official instrument exists only in Spanish-CL). UI
 * chrome around the items is translated via i18n; the items themselves are
 * rendered from this file.
 *
 * DELIBERATE v1 SCOPE (documented, not hidden):
 * - Only "Sección II — específica de riesgo psicosocial" (54 items, 12
 *   dimensions) is collected. This is the ONLY input required to compute the
 *   center risk state (Protocolo Tabla 3/4); the "Sección general" (34
 *   questions: demographics, TEA segmentation, GHQ-12, dolor, accidentes,
 *   licencias) is intentionally NOT collected: GHQ-12 is excluded from the
 *   center score by the manual itself ("La dimensión 'Salud mental' no se
 *   considera en el cálculo", p. 31) and collecting individual mental-health
 *   screening answers would raise ADR 0012 / Ley 19.628 exposure without
 *   being needed for the verdict.
 * - The official "no tengo compañeros(as) de trabajo" alternative of the
 *   Compañerismo items (manual §2.1.7) is not offered because the manual does
 *   not publish its score mapping; rather than invent one, v1 omits it.
 * - Unidades de análisis (TEA1-TEA3 segmentation, minimum 26 people per
 *   unit, manual §3.2.1.1) are out of scope in v1: results are computed for
 *   the whole centro de trabajo only, which avoids small-cell
 *   re-identification by construction.
 */

/** Two-letter dimension ids follow the manual's own abbreviations (§2.1.x). */
export type CealDimensionId =
  | 'CT' // Carga de trabajo
  | 'EM' // Exigencias emocionales
  | 'DP' // Desarrollo profesional
  | 'RC' // Reconocimiento y claridad de rol
  | 'CR' // Conflicto de rol
  | 'QL' // Calidad del liderazgo
  | 'CM' // Compañerismo
  | 'IT' // Inseguridad en las condiciones de trabajo
  | 'TV' // Equilibrio trabajo y vida privada
  | 'CJ' // Confianza y justicia organizacional
  | 'VU' // Vulnerabilidad
  | 'VA'; // Violencia y acoso

export type CealRiskLevel = 'bajo' | 'medio' | 'alto';

/**
 * Response scales of the Sección II items (Anexo Nº 1, pp. 67-70). The
 * stored answer is always the OFFICIAL POINT VALUE, not an option index.
 *
 * - frequency_risk:        Siempre=4 · A menudo=3 · A veces=2 · Rara vez=1 ·
 *                          Nunca/casi nunca=0 (higher frequency = more risk).
 * - frequency_protective:  Siempre=0 · A menudo=1 · A veces=2 · Rara vez=3 ·
 *                          Nunca/casi nunca=4 (reverse-scored).
 * - vulnerability:         Nunca=1 · Rara vez=2 · Casi siempre=3 · Siempre=4
 *                          (4-level scale, no 0 — manual p. 28: "El nivel
 *                          inferior del formato de respuesta tiene 1 punto").
 * - exposure:              No=0 · Sí, unas pocas veces=1 · Sí, mensualmente=2
 *                          · Sí, semanalmente=3 · Sí, diariamente=4.
 */
export type CealScale =
  | 'frequency_risk'
  | 'frequency_protective'
  | 'vulnerability'
  | 'exposure';

export interface CealScaleOption {
  /** es-CL label, verbatim from Anexo Nº 1. */
  label: string;
  /** Official point value codified for this option. */
  points: number;
}

export const CEAL_SCALE_OPTIONS: Record<CealScale, CealScaleOption[]> = {
  frequency_risk: [
    { label: 'Siempre', points: 4 },
    { label: 'A menudo', points: 3 },
    { label: 'A veces', points: 2 },
    { label: 'Rara vez', points: 1 },
    { label: 'Nunca/casi nunca', points: 0 },
  ],
  frequency_protective: [
    { label: 'Siempre', points: 0 },
    { label: 'A menudo', points: 1 },
    { label: 'A veces', points: 2 },
    { label: 'Rara vez', points: 3 },
    { label: 'Nunca/casi nunca', points: 4 },
  ],
  vulnerability: [
    { label: 'Nunca', points: 1 },
    { label: 'Rara vez', points: 2 },
    { label: 'Casi siempre', points: 3 },
    { label: 'Siempre', points: 4 },
  ],
  exposure: [
    { label: 'No', points: 0 },
    { label: 'Sí, unas pocas veces', points: 1 },
    { label: 'Sí, mensualmente', points: 2 },
    { label: 'Sí, semanalmente', points: 3 },
    { label: 'Sí, diariamente', points: 4 },
  ],
};

export interface CealItem {
  /** Official item code (Anexo Nº 1). */
  code: string;
  /** Verbatim es-CL item text (legal instrument text — do not edit). */
  text: string;
  scale: CealScale;
}

export interface CealDimension {
  id: CealDimensionId;
  /** Official dimension name (manual §2.1.x / Tabla 2). */
  name: string;
  items: CealItem[];
  /**
   * Tertile cut-offs, Tabla 2 (p. 27): score <= lowMax → riesgo bajo;
   * score <= mediumMax → riesgo medio; otherwise riesgo alto. "El valor del
   * punto de corte se incluye en el nivel de riesgo superior" (footnote 2).
   */
  cutoffs: { lowMax: number; mediumMax: number };
  /** Valid per-dimension score range (sum of item minimums/maximums). */
  scoreRange: { min: number; max: number };
}

// LEGAL SOURCE: item composition per dimension — manual §2.1.1-§2.1.12
// (pp. 6-12); item wording + point mapping — Anexo Nº 1 (pp. 67-70);
// cut-offs — Tabla 2 (p. 27).
export const CEAL_DIMENSIONS: CealDimension[] = [
  {
    id: 'CT',
    name: 'Carga de trabajo',
    items: [
      {
        code: 'QD1',
        text: '¿Su carga de trabajo se distribuye de manera desigual de modo que se le acumula el trabajo?',
        scale: 'frequency_risk',
      },
      {
        code: 'QD2',
        text: '¿Con qué frecuencia le falta tiempo para completar sus tareas?',
        scale: 'frequency_risk',
      },
      {
        code: 'QD3',
        text: '¿Se retrasa en la entrega de su trabajo?',
        scale: 'frequency_risk',
      },
    ],
    cutoffs: { lowMax: 1, mediumMax: 4 },
    scoreRange: { min: 0, max: 12 },
  },
  {
    id: 'EM',
    name: 'Exigencias emocionales',
    items: [
      {
        code: 'ED1',
        text: 'Su trabajo, ¿le coloca en situaciones emocionalmente perturbadoras?',
        scale: 'frequency_risk',
      },
      {
        code: 'ED2',
        text: 'Como parte de su trabajo, ¿tiene que lidiar con los problemas personales de usuarios o clientes?',
        scale: 'frequency_risk',
      },
      {
        code: 'HE2',
        text: 'Su trabajo, ¿le exige esconder sus emociones?',
        scale: 'frequency_risk',
      },
    ],
    cutoffs: { lowMax: 1, mediumMax: 5 },
    scoreRange: { min: 0, max: 12 },
  },
  {
    id: 'DP',
    name: 'Desarrollo profesional',
    items: [
      {
        code: 'DP2',
        text: '¿Tiene la posibilidad de adquirir nuevos conocimientos a través de su trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'DP3',
        text: 'En su trabajo, ¿puede utilizar sus habilidades o experiencia?',
        scale: 'frequency_protective',
      },
      {
        code: 'DP4',
        text: 'Su trabajo, ¿le da la oportunidad de desarrollar sus habilidades?',
        scale: 'frequency_protective',
      },
    ],
    cutoffs: { lowMax: 1, mediumMax: 5 },
    scoreRange: { min: 0, max: 12 },
  },
  {
    id: 'RC',
    name: 'Reconocimiento y claridad de rol',
    items: [
      {
        code: 'PR2',
        text: '¿Recibe toda la información que necesita para hacer bien su trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'RE1',
        text: 'Su trabajo, ¿es reconocido y valorado por sus superiores?',
        scale: 'frequency_protective',
      },
      {
        code: 'RE2',
        text: 'En su trabajo, ¿es respetado por sus superiores?',
        scale: 'frequency_protective',
      },
      {
        code: 'RE3',
        text: 'En su trabajo, ¿es tratado de forma justa?',
        scale: 'frequency_protective',
      },
      {
        code: 'MW1',
        text: 'Su trabajo, ¿tiene sentido para usted?',
        scale: 'frequency_protective',
      },
      {
        code: 'CL1',
        text: 'Su trabajo, ¿tiene objetivos claros?',
        scale: 'frequency_protective',
      },
      {
        code: 'CL2',
        text: 'En su trabajo, ¿sabe exactamente qué tareas son de su responsabilidad?',
        scale: 'frequency_protective',
      },
      {
        code: 'CL3',
        text: '¿Sabe exactamente lo que se espera de usted en el trabajo?',
        scale: 'frequency_protective',
      },
    ],
    cutoffs: { lowMax: 4, mediumMax: 9 },
    scoreRange: { min: 0, max: 32 },
  },
  {
    id: 'CR',
    name: 'Conflicto de rol',
    items: [
      {
        code: 'CO2',
        text: 'En su trabajo, ¿se le exigen cosas contradictorias?',
        scale: 'frequency_risk',
      },
      {
        code: 'CO3',
        text: '¿Tiene que hacer tareas que usted cree que deberían hacerse de otra manera?',
        scale: 'frequency_risk',
      },
      {
        code: 'IT1',
        text: '¿Tiene que realizar tareas que le parecen innecesarias?',
        scale: 'frequency_risk',
      },
    ],
    cutoffs: { lowMax: 2, mediumMax: 5 },
    scoreRange: { min: 0, max: 12 },
  },
  {
    id: 'QL',
    name: 'Calidad del liderazgo',
    items: [
      {
        code: 'QL3',
        text: 'Su superior inmediato, ¿planifica bien el trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'QL2',
        text: 'Su superior inmediato, ¿resuelve bien los conflictos?',
        scale: 'frequency_protective',
      },
      {
        code: 'SS1',
        text: 'Si usted lo necesita, ¿con qué frecuencia su superior inmediato está dispuesto a escuchar sus problemas en el trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'SS2',
        text: 'Si usted lo necesita, ¿con qué frecuencia obtiene ayuda y apoyo de su superior inmediato?',
        scale: 'frequency_protective',
      },
    ],
    cutoffs: { lowMax: 2, mediumMax: 7 },
    scoreRange: { min: 0, max: 16 },
  },
  {
    id: 'CM',
    name: 'Compañerismo',
    items: [
      {
        code: 'SC1',
        text: 'De ser necesario, ¿con qué frecuencia obtiene ayuda y apoyo de sus compañeros(as) de trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'SC2',
        text: 'De ser necesario, ¿con qué frecuencia sus compañeros(as) de trabajo están dispuestos(as) a escuchar sus problemas en el trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'SW1',
        text: '¿Hay un buen ambiente entre usted y sus compañeros(as) de trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'SW3',
        text: 'En su trabajo, ¿usted siente que forma parte de un equipo?',
        scale: 'frequency_protective',
      },
    ],
    cutoffs: { lowMax: 0, mediumMax: 4 },
    scoreRange: { min: 0, max: 16 },
  },
  {
    id: 'IT',
    name: 'Inseguridad en las condiciones de trabajo',
    items: [
      {
        code: 'IW1',
        text: '¿Está preocupado(a) de que le cambien sus tareas laborales en contra de su voluntad?',
        scale: 'frequency_risk',
      },
      {
        code: 'IW2',
        text: '¿Está preocupado(a) por si le trasladan a otro lugar de trabajo, obra, funciones, unidad, departamento o sección en contra de su voluntad?',
        scale: 'frequency_risk',
      },
      {
        code: 'IW3',
        text: '¿Está preocupado(a) de que le cambien el horario (turnos, días de la semana, hora de entrada y salida) en contra de su voluntad?',
        scale: 'frequency_risk',
      },
    ],
    cutoffs: { lowMax: 2, mediumMax: 5 },
    scoreRange: { min: 0, max: 12 },
  },
  {
    id: 'TV',
    name: 'Equilibrio trabajo y vida privada',
    items: [
      {
        code: 'WF2',
        text: '¿Siente que su trabajo le consume demasiada ENERGÍA teniendo un efecto negativo en su vida privada?',
        scale: 'frequency_risk',
      },
      {
        code: 'WF3',
        text: '¿Siente que su trabajo le consume demasiado TIEMPO teniendo un efecto negativo en su vida privada?',
        scale: 'frequency_risk',
      },
      {
        code: 'WF5',
        text: 'Las exigencias de su trabajo, ¿interfieren con su vida privada y familiar?',
        scale: 'frequency_risk',
      },
    ],
    cutoffs: { lowMax: 2, mediumMax: 5 },
    scoreRange: { min: 0, max: 12 },
  },
  {
    id: 'CJ',
    name: 'Confianza y justicia organizacional',
    items: [
      {
        code: 'TE1',
        text: 'En general, ¿los trabajadores(as) en su organización confían entre sí?',
        scale: 'frequency_protective',
      },
      {
        code: 'TM1',
        text: '¿Los gerentes o directivos confían en que los trabajadores(as) hacen bien su trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'TM2',
        text: '¿Los trabajadores(as) confían en la información que proviene de los gerentes, directivos o empleadores?',
        scale: 'frequency_protective',
      },
      {
        code: 'TM4',
        text: '¿Los trabajadores(as) pueden expresar sus opiniones y sentimientos?',
        scale: 'frequency_protective',
      },
      {
        code: 'JU1',
        text: 'En su trabajo ¿los conflictos se resuelven de manera justa?',
        scale: 'frequency_protective',
      },
      {
        code: 'JU2',
        text: '¿Se valora a los trabajadores(as) cuando han hecho un buen trabajo?',
        scale: 'frequency_protective',
      },
      {
        code: 'JU4',
        text: '¿Se distribuye el trabajo de manera justa?',
        scale: 'frequency_protective',
      },
    ],
    cutoffs: { lowMax: 7, mediumMax: 12 },
    scoreRange: { min: 0, max: 28 },
  },
  {
    id: 'VU',
    name: 'Vulnerabilidad',
    items: [
      {
        code: 'VU1',
        text: '¿Tiene miedo a pedir mejores condiciones de trabajo?',
        scale: 'vulnerability',
      },
      {
        code: 'VU2',
        text: '¿Se siente indefenso(a) ante el trato injusto de sus superiores?',
        scale: 'vulnerability',
      },
      {
        code: 'VU3',
        text: '¿Tiene miedo de que lo(la) despidan si no hace lo que le piden?',
        scale: 'vulnerability',
      },
      {
        code: 'VU4',
        text: '¿Considera que sus superiores lo(la) tratan de forma discriminatoria o injusta?',
        scale: 'vulnerability',
      },
      {
        code: 'VU5',
        text: '¿Considera que lo(la) tratan de forma autoritaria o violenta?',
        scale: 'vulnerability',
      },
      {
        code: 'VU6',
        text: '¿Lo(la) hacen sentir que usted puede ser fácilmente reemplazado(a)?',
        scale: 'vulnerability',
      },
    ],
    cutoffs: { lowMax: 6, mediumMax: 11 },
    scoreRange: { min: 6, max: 24 },
  },
  {
    id: 'VA',
    name: 'Violencia y acoso',
    items: [
      {
        code: 'CQ1',
        text: 'En su trabajo, durante los últimos 12 meses, ¿ha estado involucrado(a) en disputas o conflictos?',
        scale: 'exposure',
      },
      {
        code: 'UT1',
        text: 'En su trabajo, durante los últimos 12 meses, ¿ha estado expuesto(a) a bromas desagradables?',
        scale: 'exposure',
      },
      {
        code: 'HSM1',
        text: 'En los últimos 12 meses, ¿ha estado expuesto(a) a acoso relacionado al trabajo por correo electrónico, mensajes de texto y/o en las redes sociales (por ejemplo, Facebook, Instagram, Twitter)?',
        scale: 'exposure',
      },
      {
        code: 'SH1',
        text: 'En su trabajo, durante los últimos 12 meses, ¿ha estado expuesta(o) a acoso sexual?',
        scale: 'exposure',
      },
      {
        code: 'PV1',
        text: 'En su trabajo, en los últimos 12 meses, ¿ha estado expuesta(o) a violencia física?',
        scale: 'exposure',
      },
      {
        code: 'AL',
        text: 'El bullying o acoso significa que una persona está expuesta a un trato desagradable o denigrante, del cual le resulta difícil defenderse. En su trabajo, en los últimos 12 meses, ¿ha estado expuesto(a) a bullying o acoso?',
        scale: 'exposure',
      },
      {
        code: 'HO',
        text: '¿Con qué frecuencia se siente intimidado(a), colocado(a) en ridículo o injustamente criticado(a), frente a otros por sus compañeros(as) de trabajo o su superior?',
        scale: 'exposure',
      },
    ],
    // LEGAL SOURCE: manual p. 27 — los terciles de VA eran ambos 0, así que
    // SUSESO fijó: bajo = 0 puntos, medio = 1-14, alto = 15-28.
    cutoffs: { lowMax: 0, mediumMax: 14 },
    scoreRange: { min: 0, max: 28 },
  },
];

/** All 54 Sección II item codes, in official order. */
export const CEAL_ITEM_CODES: string[] = CEAL_DIMENSIONS.flatMap((d) =>
  d.items.map((i) => i.code),
);

/**
 * LEGAL SOURCE: Protocolo MINSAL oct. 2022, sección 9 — "Para que una
 * evaluación sea válida, al menos el 60% de los trabajadores/as del centro
 * de trabajo deberán haber formado parte del proceso de evaluación y
 * respondido el cuestionario".
 */
export const CEAL_MIN_PARTICIPATION = 0.6;

/**
 * LEGAL SOURCE: Protocolo MINSAL oct. 2022, sección 8 + Tabla 4 — "La
 * evaluación de riesgo psicosocial deberá realizarse cada dos años en cada
 * centro de trabajo"; el plazo de reevaluación de la Tabla 4 es de 2 años
 * para los tres estados de riesgo.
 */
export const CEAL_REEVALUATION_YEARS = 2;

/**
 * LEGAL SOURCE: Protocolo MINSAL oct. 2022, Tabla 3 — a dimension where
 * >= 50% of workers sit in a given individual risk level scores +2 (alto),
 * +1 (medio) or -2 (bajo, protección); otherwise 0. On a 50%/50% tie the
 * higher-risk level's points apply ("se asigna el puntaje del nivel de
 * riesgo mayor").
 */
export const CEAL_CENTER_PREVALENCE_THRESHOLD = 0.5;

/**
 * LEGAL SOURCE: Protocolo MINSAL oct. 2022, Tabla 4 — estado de riesgo del
 * centro de trabajo: de -24 a +1 → riesgo bajo; de +2 a +12 → riesgo medio;
 * desde +13 a +24 → riesgo alto.
 */
export const CEAL_CENTER_RISK_BANDS = {
  lowMax: 1,
  mediumMax: 12,
} as const;

/**
 * Anonymity suppression threshold for aggregates served by this app.
 *
 * LEGAL SOURCE: manual §3.2.1.1 (p. 17) — analysis units must not allow
 * identification (no fewer than 26 people per unit) and any unit measured
 * separately with FEWER THAN 10 workers requires a signed informed consent
 * from each worker. This platform cannot collect/verify that written
 * consent, so it refuses to reveal ANY aggregate while fewer than 10
 * responses exist. (Stricter than the k>=5 culture-pulse precedent, looser
 * than the 26-person unit rule — v1 has no sub-unit breakdown at all, only
 * the whole centro de trabajo.) Also manual §3.2.4: "en ningún caso se
 * podrán utilizar métodos … que puedan llevar a la identificación de los
 * participantes".
 */
export const CEAL_ANONYMITY_THRESHOLD = 10;
