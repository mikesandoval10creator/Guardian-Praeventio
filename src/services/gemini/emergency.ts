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

  const response = await ai.models.generateContent({
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

  return JSON.parse(response.text || '{}');
};
