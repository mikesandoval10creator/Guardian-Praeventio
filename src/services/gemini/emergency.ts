// Praeventio Guard — §12.5.1 split step 8: Gemini emergency planning.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Octava
// extracción del split. Bundles 3 funciones de planificación de
// emergencias:
//
//   1. generateEmergencyPlan(projectName, context, industry) — texto
//      libre del plan (objetivos + amenazas + roles + evacuación +
//      recursos + comunicaciones).
//   2. generateEmergencyScenario(context) — escenario simulado JSON
//      estructurado (Incendio/Derrame/Sismo/Accidente/Explosión) con
//      coordenadas mapa + EPP + contactos.
//   3. generateEmergencyPlanJSON(scenario, description, normative,
//      industry) — Plan estructurado con marco legal BCN + evaluación
//      matemática LaTeX ($MR = P × C$) + cadena de mando.

import { GoogleGenAI, Type } from '@google/genai';
import { parseGeminiJson } from './parsing';

const API_KEY = process.env.GEMINI_API_KEY;

export const generateEmergencyPlan = async (
  projectName: string,
  context: string,
  industry?: string,
): Promise<string | undefined> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: `Actúa como un experto en gestión de emergencias industriales.
    Genera un Plan de Emergencia detallado para el proyecto ${projectName} en la industria ${industry || 'general'}.

    Utiliza el siguiente contexto de riesgos identificados en el proyecto:
    ${context}

    El plan debe incluir:
    1. Objetivos y Alcance.
    2. Identificación de Amenazas Críticas.
    3. Organización de la Emergencia (Roles).
    4. Procedimientos de Evacuación Específicos.
    5. Recursos de Emergencia Disponibles.
    6. Plan de Comunicaciones.`,
    config: {
      systemInstruction:
        'Eres un experto en gestión de emergencias y protección civil. Tu lenguaje es técnico, estructurado y orientado a la acción inmediata.',
    },
  });

  return response.text;
};

export const generateEmergencyScenario = async (context: string): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Genera un escenario de emergencia simulado basado en el siguiente contexto de la red de riesgos:
    ${context}

    Proporciona un escenario realista y desafiante.
    Incluye:
    1. Título del escenario.
    2. Tipo de emergencia (Incendio, Derrame, Sismo, Accidente, Explosión).
    3. Descripción detallada de la situación.
    4. Ubicación simulada en la planta.
    5. Coordenadas relativas (x, y) entre 0 y 100 para un mapa.
    6. Nivel de criticidad (Alta, Crítica).
    7. Pasos de respuesta inmediata esperados.
    8. EPP requerido para la respuesta.
    9. Contactos de emergencia a notificar.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: {
            type: Type.STRING,
            enum: ['Incendio', 'Derrame', 'Sismo', 'Accidente', 'Explosión'],
          },
          description: { type: Type.STRING },
          location: { type: Type.STRING },
          coordinates: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
            },
            required: ['x', 'y'],
          },
          criticality: { type: Type.STRING, enum: ['Alta', 'Crítica'] },
          responseSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
          requiredEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          emergencyContacts: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'title',
          'type',
          'description',
          'location',
          'coordinates',
          'criticality',
          'responseSteps',
          'requiredEPP',
          'emergencyContacts',
        ],
      },
    },
  });

  return parseGeminiJson(response);
};

/** Shape of a generated emergency plan (matches the Gemini responseSchema). */
export interface EmergencyPlanJSON {
  objetivo: string;
  alcance: string;
  marcoLegal: string[];
  evaluacionMatematica: string;
  cadenaMando: string[];
  accionesInmediatas: string[];
  evacuacion: string[];
  equipos: string[];
  /** true when this plan came from the deterministic fallback (AI unavailable). */
  generadoSinIA?: boolean;
}

/** A parsed value is a usable plan only if every required field is present and non-empty. */
function isUsableEmergencyPlan(v: unknown): v is EmergencyPlanJSON {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  const nonEmptyStr = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
  // Every array element must itself be a non-empty string: the UI renders these
  // values directly as React children, so a `[{}]` or `[null]` element would
  // crash the preview instead of degrading to the safe baseline.
  const nonEmptyStrArr = (x: unknown) =>
    Array.isArray(x) && x.length > 0 && x.every(nonEmptyStr);
  return (
    nonEmptyStr(p.objetivo) &&
    nonEmptyStr(p.alcance) &&
    nonEmptyStrArr(p.marcoLegal) &&
    nonEmptyStr(p.evaluacionMatematica) &&
    nonEmptyStrArr(p.cadenaMando) &&
    nonEmptyStrArr(p.accionesInmediatas) &&
    nonEmptyStrArr(p.evacuacion) &&
    nonEmptyStrArr(p.equipos)
  );
}

/**
 * Deterministic, normative-grounded emergency plan used when the AI is
 * unavailable or returns an empty/malformed response. This is a LIFE-SAFETY
 * feature: a worker facing an emergency must ALWAYS get a usable plan, never an
 * error screen or a blank object. The content is a conservative baseline
 * protocol the prevencionista must review/adapt to the site (flagged via
 * `generadoSinIA`). Legal references are real Chilean norms (no fabricated
 * article numbers).
 */
export function baselineEmergencyPlan(
  scenario: string,
  description: string,
  normative: string,
  _industry?: string,
): EmergencyPlanJSON {
  return {
    generadoSinIA: true,
    objetivo:
      `Plan de emergencia base para el escenario "${scenario}". NOTA: generado sin asistencia ` +
      `de IA (servicio no disponible); el prevencionista DEBE revisarlo y adaptarlo al sitio ` +
      `antes de su uso formal.`,
    alcance:
      `Aplica a todas las personas presentes en la faena (trabajadores, contratistas y visitas) ` +
      `ante el escenario descrito: ${description}.`,
    marcoLegal: [
      'Ley N° 16.744 — Seguro Social contra Riesgos de Accidentes del Trabajo y Enfermedades Profesionales.',
      'Art. 184 del Código del Trabajo — deber del empleador de proteger eficazmente la vida y salud de los trabajadores, incluidas condiciones de emergencia y evacuación.',
      'DS N° 594/1999 MINSAL — condiciones sanitarias y ambientales básicas en los lugares de trabajo.',
      'DS N° 44/2024 — Reglamento sobre gestión preventiva de los riesgos laborales (Ley 16.744).',
      `Normativa indicada para este escenario: ${normative} (verificar artículos aplicables con el prevencionista).`,
    ],
    evaluacionMatematica:
      `Evaluación del riesgo: $MR = P \\times C$. Sin datos específicos del sitio se asume el caso ` +
      `conservador (P y C altos ⇒ MR máximo) hasta que el prevencionista ajuste la Probabilidad (P) ` +
      `y la Consecuencia (C) según el escenario "${scenario}".`,
    cadenaMando: [
      '1) La persona que detecta la emergencia da la alarma de inmediato.',
      '2) El supervisor/líder de área asume el mando inicial y verifica la alarma.',
      '3) El jefe de emergencia / prevencionista coordina la respuesta.',
      '4) Se informa al Comité Paritario de Higiene y Seguridad (CPHS).',
      '5) Gerencia y mutualidad (ACHS / IST / ISL) son notificadas según la gravedad.',
    ],
    accionesInmediatas: [
      'Detener las actividades y dar la alarma.',
      'Asegurar la zona y cortar energías/fuentes de riesgo solo si es seguro hacerlo.',
      'Evacuar a las personas por la vía de evacuación señalizada.',
      'Llamar a emergencias: SAMU 131, Bomberos 132, Carabineros 133; mutualidad ACHS 1404.',
      'No reingresar al área hasta que el jefe de emergencia lo autorice.',
    ],
    evacuacion: [
      'Usar las vías de evacuación señalizadas; NO usar ascensores.',
      'Dirigirse al punto de encuentro definido para la faena.',
      'Realizar el conteo de personas (headcount) y reportar a quien falte.',
      'Asistir a personas con movilidad reducida.',
      'Mantener despejadas las salidas de emergencia en todo momento.',
    ],
    equipos: [
      'Extintores adecuados a la clase de fuego del escenario.',
      'Botiquín de primeros auxilios y DEA (desfibrilador) si está disponible.',
      'Señalética de evacuación y luces de emergencia operativas.',
      'Sistema de alarma y medio de comunicación.',
      'EPP acorde al riesgo del escenario.',
    ],
  };
}

/**
 * Turn a Gemini response into a usable plan: use the model's plan when it is
 * complete, otherwise fall back to the deterministic baseline. NEVER returns an
 * empty object or throws on a bad model response — life-safety must degrade
 * gracefully into a real plan.
 */
export function emergencyPlanFromResponse(
  response: { text?: string },
  scenario: string,
  description: string,
  normative: string,
  industry?: string,
): EmergencyPlanJSON {
  try {
    const parsed = parseGeminiJson<unknown>(response);
    if (isUsableEmergencyPlan(parsed)) return parsed;
  } catch {
    // AI returned empty/malformed JSON — fall through to the baseline.
  }
  return baselineEmergencyPlan(scenario, description, normative, industry);
}

export const generateEmergencyPlanJSON = async (
  scenario: string,
  description: string,
  normative: string,
  industry?: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `
    Genera un Plan de Emergencia detallado para el siguiente escenario:
    Escenario: ${scenario}
    Descripción: ${description}
    Normativa Principal a Cumplir: ${normative}
    ${industry ? `Industria: ${industry} (Adapta el plan a los estándares de este rubro)` : ''}

    El Plan de Emergencia debe incluir:
    1. Objetivo del Plan
    2. Alcance
    3. Marco Legal y Normativo (Cita artículos exactos del DS 594, Ley 16.744 u otros aplicables según la Biblioteca del Congreso Nacional de Chile - BCN, que justifiquen este documento)
    4. Evaluación Matemática del Riesgo (Incluye la fórmula en formato LaTeX: $MR = P \\times C$, y explica los valores asignados para Probabilidad y Consecuencia basados en el escenario)
    5. Cadena de Mando y Comunicaciones
    6. Acciones Inmediatas (Primeros 5 minutos)
    7. Procedimiento de Evacuación
    8. Equipos de Emergencia Requeridos

    Asegúrate de que el contenido sea profesional, técnico y cumpla estrictamente con la normativa indicada (${normative}).
    IMPORTANTE: En la sección "evaluacionMatematica", DEBES usar sintaxis LaTeX encerrada en signos de dólar (ej. $MR = P \\times C$) para las fórmulas.
  `;

  // The request itself can reject (transient 503, network failure, safety
  // block). For a life-safety feature that must still produce a usable plan, a
  // request failure degrades to the deterministic baseline exactly like an
  // empty/malformed response does — never propagate the error to the worker.
  let response: { text?: string };
  try {
    response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            objetivo: { type: Type.STRING },
            alcance: { type: Type.STRING },
            marcoLegal: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Citas exactas de artículos de leyes chilenas aplicables',
            },
            evaluacionMatematica: {
              type: Type.STRING,
              description: 'Evaluación del riesgo incluyendo fórmulas en LaTeX como $MR = P \\times C$',
            },
            cadenaMando: { type: Type.ARRAY, items: { type: Type.STRING } },
            accionesInmediatas: { type: Type.ARRAY, items: { type: Type.STRING } },
            evacuacion: { type: Type.ARRAY, items: { type: Type.STRING } },
            equipos: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'objetivo',
            'alcance',
            'marcoLegal',
            'evaluacionMatematica',
            'cadenaMando',
            'accionesInmediatas',
            'evacuacion',
            'equipos',
          ],
        },
      },
    });
  } catch {
    return baselineEmergencyPlan(scenario, description, normative, industry);
  }

  return emergencyPlanFromResponse(response, scenario, description, normative, industry);
};
