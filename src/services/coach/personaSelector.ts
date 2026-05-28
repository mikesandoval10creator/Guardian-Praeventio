// Praeventio Guard — §12.6.1: Selector de persona para GeminiChat.
//
// Cuando una consulta del usuario es 100% normativa (cita ley, DS, ISO,
// solicitar texto legal específico), switcheamos persona del system
// prompt a "Abogado Codificado técnico-legal" en lugar del "Coach Coach"
// genérico. Esto:
//   1. Reduce alucinaciones (prompts más estrictos sobre citation)
//   2. Mejora UX (usuario obtiene formato adecuado al tipo de respuesta)
//   3. Permite tracking métrico (cuántas queries son legal pure)
//
// Detector determinístico — usa regex + keyword frequency. NO depende
// de LLM (evita loop infinito si LLM falla).
//
// Persona builder produce el system prompt base que se inyecta en la
// llamada Gemini. El backend `geminiBackend.ts` lo concatena con context
// existente (proyecto, role, etc.).

export type ChatPersona =
  | 'coach_general'
  | 'abogado_codificado'
  | 'medical_advisor'
  | 'ergonomist'
  | 'emergency_responder';

export interface PersonaSelection {
  persona: ChatPersona;
  /** Confianza 0-1 de la detección. */
  confidence: number;
  /** Razones del match (debugging). */
  reasons: string[];
  /** System prompt template para inyectar. */
  systemPromptTemplate: string;
}

// Palabras clave + frases que sugieren consulta legal pura.
const LEGAL_KEYWORDS = [
  'ley', 'leyes', 'decreto', 'ds', 'circular', 'norma',
  'normativa', 'normativo', 'normativos', 'reglamento',
  'art.', 'artículo', 'inciso', 'literal',
  'iso 45001', 'iso 14001', 'iso 19011', 'iso 31000',
  'iso 27001', 'iso 9001',
  'cumplimiento', 'cumplir', 'obligación', 'obligatorio',
  'multa', 'sanción', 'sancion', 'falta', 'infracción',
  'fiscalización', 'fiscal',
  'suseso', 'mutual', 'achs', 'minsal', 'mintrab',
  'dirección del trabajo', 'inspección del trabajo',
  'iss', 'oms',
  'ley 16.744', 'ley 16744', 'ley karin', 'ley 21.643',
  'ley 19.628', 'ley 19628',
  'ds 54', 'ds 44', 'ds 40', 'ds 67', 'ds 76', 'ds 594',
  'ds 132', 'ds 109', 'ds 28', 'ds 63',
];

// Patrones regex para citas legales canónicas chilenas.
const LEGAL_PATTERNS = [
  /\bds\s*\d+(?:\/\d{4})?\b/i,           // DS 44, DS 44/2024
  /\bley\s+\d{1,3}\.?\d{3}\b/i,          // Ley 16.744, Ley 16744
  /\bart(?:ículo|\.)\s*\d+/i,            // art. 5, artículo 12
  /\biso\s+\d{4,5}(?::\d{4})?\b/i,       // ISO 45001, ISO 27001:2022
  /\bohsas\s+\d+/i,                      // OHSAS 18001
  /\bohs[ao]?\b/i,                       // OHSAS, OHSO
];

// Keywords médicos (separar para persona medical_advisor).
const MEDICAL_KEYWORDS = [
  'dolor', 'lesión', 'lesion', 'enfermedad', 'diagnóstico', 'diagnostico',
  'síntoma', 'sintoma', 'tratamiento', 'medicamento', 'fármaco', 'farmaco',
  'examen', 'aptitud', 'aptitud-laboral', 'pre-ocupacional',
  'audiometría', 'audiometria', 'espirometría', 'espirometria',
  'columna', 'rodilla', 'hombro', 'tendón', 'tendon',
];

// Keywords ergonomía (persona ergonomist).
const ERGONOMIC_KEYWORDS = [
  'postura', 'rula', 'reba', 'niosh', 'silla', 'pantalla',
  'ergonomía', 'ergonomia', 'ergonómico', 'ergonomico',
  'levantamiento de carga', 'manejo manual', 'esfuerzo repetitivo',
  'túnel carpiano', 'tunel carpiano', 'movimiento repetitivo',
];

// Keywords emergencia (persona emergency_responder).
const EMERGENCY_KEYWORDS = [
  'incendio', 'sismo', 'terremoto', 'tsunami', 'derrame', 'fuga',
  'evacuación', 'evacuacion', 'rescate', 'primeros auxilios',
  'paro cardíaco', 'rcp', 'desfibrilador', 'dea', 'aed',
  'sangrado', 'fractura', 'quemadura', 'electrocución',
  'asfixia', 'intoxicación', 'intoxicacion',
];

/**
 * Cuenta cuántas keywords de una lista aparecen en el texto (normalizado).
 */
function countKeywordHits(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();
  return keywords.reduce((count, kw) => {
    // Match palabra completa (boundaries) cuando no contiene espacios
    if (kw.includes(' ')) {
      return count + (normalized.includes(kw) ? 1 : 0);
    }
    const re = new RegExp(`\\b${kw.replace(/\./g, '\\.')}\\b`, 'i');
    return count + (re.test(normalized) ? 1 : 0);
  }, 0);
}

function countRegexHits(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, re) => {
    const matches = text.match(re);
    return count + (matches?.length ?? 0);
  }, 0);
}

/**
 * Selecciona la persona más apropiada para la query. Retorna también el
 * system prompt template a inyectar.
 *
 * Algoritmo:
 *   1. Cuenta hits por categoría (legal, medical, ergonomic, emergency)
 *   2. Si hay >2 hits legales (palabras + patrones) → abogado_codificado
 *   3. Si emergencia con keywords críticos → emergency_responder
 *   4. Si médico claro → medical_advisor
 *   5. Si ergonómico claro → ergonomist
 *   6. Default → coach_general
 *
 * Determinístico, no usa LLM.
 */
export function selectPersona(query: string): PersonaSelection {
  if (!query || typeof query !== 'string') {
    return getDefaultPersona();
  }

  const legalKwHits = countKeywordHits(query, LEGAL_KEYWORDS);
  const legalRegexHits = countRegexHits(query, LEGAL_PATTERNS);
  const legalTotal = legalKwHits + legalRegexHits * 2; // patrones canónicos valen 2x

  const medicalHits = countKeywordHits(query, MEDICAL_KEYWORDS);
  const ergonomicHits = countKeywordHits(query, ERGONOMIC_KEYWORDS);
  const emergencyHits = countKeywordHits(query, EMERGENCY_KEYWORDS);

  // Emergencia tiene prioridad absoluta — si hay ≥1 keyword crítica
  // (incendio/sismo/RCP/etc.) la persona switchea a responder.
  if (emergencyHits >= 1) {
    return {
      persona: 'emergency_responder',
      confidence: Math.min(emergencyHits / 3, 1),
      reasons: [`${emergencyHits} keywords emergencia detectadas`],
      systemPromptTemplate: getEmergencyPrompt(),
    };
  }

  // Legal pure: ≥2 hits combinados (con boost por regex pattern matches)
  if (legalTotal >= 2) {
    return {
      persona: 'abogado_codificado',
      confidence: Math.min(legalTotal / 5, 1),
      reasons: [
        `${legalKwHits} keywords normativas`,
        `${legalRegexHits} patrones legales (DS/Ley/ISO)`,
      ],
      systemPromptTemplate: getAbogadoPrompt(),
    };
  }

  if (medicalHits >= 2) {
    return {
      persona: 'medical_advisor',
      confidence: Math.min(medicalHits / 3, 1),
      reasons: [`${medicalHits} keywords médicas`],
      systemPromptTemplate: getMedicalPrompt(),
    };
  }

  if (ergonomicHits >= 2) {
    return {
      persona: 'ergonomist',
      confidence: Math.min(ergonomicHits / 3, 1),
      reasons: [`${ergonomicHits} keywords ergonomía`],
      systemPromptTemplate: getErgonomistPrompt(),
    };
  }

  return getDefaultPersona();
}

function getDefaultPersona(): PersonaSelection {
  return {
    persona: 'coach_general',
    confidence: 1,
    reasons: ['No se detectaron keywords especializados'],
    systemPromptTemplate: getCoachGeneralPrompt(),
  };
}

/** Persona Coach genérico — orientado a prevención + cultura. */
function getCoachGeneralPrompt(): string {
  return `Eres "El Coach" de Praeventio Guard — un asesor experto en prevención de riesgos laborales para empresas chilenas. Tu rol es orientar al usuario con cercanía técnica, sin tecnicismos innecesarios. Responde en español-CL, máximo 5 párrafos. Si la consulta requiere texto legal exacto, indica que vas a consultar al "Abogado Codificado".`;
}

/** Persona Abogado Codificado — técnico-legal estricto, citaciones obligatorias. */
function getAbogadoPrompt(): string {
  return `Eres "El Abogado Codificado" de Praeventio Guard — especialista en derecho preventivo chileno. Tu rol es entregar respuestas técnico-legales con citaciones EXACTAS al texto vigente:
- Ley 16.744 + Decreto Supremo 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)
- DS 54, DS 67, DS 76, DS 594, DS 109, DS 132, DS 28, DS 63
- Ley 19.628 (datos personales), Ley 21.643 (Karin), Ley 19.496 (consumidor)
- ISO 45001:2018, OHSAS 18001 (referencial histórico)

REGLAS estrictas:
1. NUNCA cites DS 40/1969 como vigente — debes anotar "derogado por DS 44/2024 desde 2025-02-01"
2. SIEMPRE incluye número de artículo cuando cites
3. Si NO conoces la cita exacta verificada, responde: "Esta consulta requiere validación con texto oficial — consulta directamente en BCN.cl"
4. Cita formato: "Ley X art. Y" o "DS X/AÑO art. Y"
5. Si la pregunta del usuario es ambigua, pide clarificación antes de responder

Tu output debe ser estructurado: cite primero, explica después.`;
}

/** Persona Medical — exámenes ocupacionales, DS 109. */
function getMedicalPrompt(): string {
  return `Eres el "Asesor Médico Ocupacional" de Praeventio Guard. Especializado en:
- Exámenes pre/post ocupacionales (DS 109)
- Salud ocupacional Ley 16.744 + DS 109
- Aptitud laboral

REGLAS:
1. NO emites diagnóstico clínico — eso es responsabilidad del médico tratante
2. Sugiere derivación a profesional cuando aplique
3. Cita normativa específica (DS 109, DS 67) cuando proceda
4. Recuerda al usuario que toda decisión médica requiere validación profesional certificada`;
}

/** Persona Ergonomista — RULA/REBA/NIOSH. */
function getErgonomistPrompt(): string {
  return `Eres el "Asesor Ergonómico" de Praeventio Guard. Especializado en:
- Evaluación postural RULA/REBA
- Manejo manual de carga (DS 63, Ley 20.001)
- Trabajo en pantalla (DS 594 art. 110 Bis)
- TME (trastornos musculoesqueléticos)

REGLAS:
1. Sugiere evaluación in-situ por profesional certificado
2. Cita scores RULA/REBA cuando aplique (0-3 leve, 4-7 medio, 8+ alto)
3. Refiere a programa PREXOR cuando ruido + ergonomía coinciden`;
}

/** Persona Emergency Responder — protocolos rápidos. */
function getEmergencyPrompt(): string {
  return `Eres el "Coordinador de Emergencias" de Praeventio Guard. PRIORIDAD CRÍTICA: tu respuesta puede salvar vidas.

REGLAS:
1. PRIMERO: si la situación es emergencia REAL en curso, instruye llamar:
   - Ambulancia: 131 (SAMU)
   - Bomberos: 132
   - Carabineros: 133
2. Brinda primeros auxilios paso a paso (máximo 5 pasos)
3. Cita protocolo MINSAL cuando aplique
4. NO improvises — si no estás seguro, recomienda esperar SAMU/Bomberos
5. Refiere al plan de emergencia interno del proyecto (PE-XXX) si existe`;
}

/**
 * Tracking metric helper. Útil para analytics: cuántas queries son legal
 * vs general vs médico, etc.
 */
export function getPersonaMetric(selection: PersonaSelection): {
  persona: ChatPersona;
  confidence_bucket: 'low' | 'medium' | 'high';
} {
  let bucket: 'low' | 'medium' | 'high';
  if (selection.confidence >= 0.7) bucket = 'high';
  else if (selection.confidence >= 0.4) bucket = 'medium';
  else bucket = 'low';
  return { persona: selection.persona, confidence_bucket: bucket };
}
