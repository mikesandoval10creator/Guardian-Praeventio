// Praeventio Guard — §12.5.1 split step 7: Gemini proactive suggestions.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Séptima
// extracción del split. Bundles 2 funciones de sugerencia proactiva:
//
//   1. suggestRisksWithAI(industry, context) — sugiere 5 riesgos críticos
//      para una industria/contexto. Devuelve P y S separados (1-5) pero
//      NO `criticidad` — esa la deriva consumer vía iper.ts P×S
//      determinístico (lock R1 doctrine).
//   2. suggestNormativesWithAI(industry) — 3 normativas/decretos chilenos
//      específicos por industria (excluye Ley 16.744 + DS 594 generales).
//
// Funciones AI thin wrappers — no contienen lógica de negocio.

import { GoogleGenAI, Type } from '@google/genai';
import { parseGeminiJson } from './parsing';
import { AI_MODEL_FAST } from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

export const suggestRisksWithAI = async (
  industry: string,
  context: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  // Round 16 (R1) doctrine — `criticidad` is intentionally OMITTED from
  // the prompt and the response schema. Risk-level classification is a
  // legal output of the deterministic IPER P×S matrix
  // (`calculateIper()` / `src/services/protocols/iper.ts`) and Ley
  // 16.744 attaches liability to that classification. The LLM exposes
  // only Probabilidad and Severidad as numeric inputs (1–5); the
  // consumer (Matrix.tsx) must derive `criticidad` via the
  // deterministic P×S ladder so auditors cannot mistake an AI guess
  // for a deterministic figure.
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Basado en el rubro "${industry}" y el contexto del proyecto "${context}", sugiere 5 riesgos críticos que deberían estar en la matriz IPERC.
    Para cada riesgo, asigna un valor de Probabilidad (1-5) y Severidad (1-5) según la metodología de evaluación de riesgos.

    IMPORTANTE: NO devuelvas criticidad — la clasificación legal viene de IPER P×S deterministic en \`calculateIper()\`. Tu rol se limita a estimar P y S como inputs numéricos, junto con recomendaciones, controles (Jerarquía: eliminación → sustitución → ingeniería → administrativo → EPP) y normativa aplicable (DS 594, DS 44/2024 [ex DS 54 y ex DS 40, derogados 01-02-2025], Ley 16.744, NCh ISO 45001).`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Título corto del peligro' },
            actividad: {
              type: Type.STRING,
              description: 'La actividad o tarea específica donde ocurre el peligro',
            },
            description: { type: Type.STRING, description: 'Descripción detallada del peligro' },
            riesgo: {
              type: Type.STRING,
              description: 'El riesgo asociado (ej: Caída, Atrapamiento)',
            },
            consecuencia: {
              type: Type.STRING,
              description: 'Consecuencia potencial (ej: Fractura, Muerte)',
            },
            probabilidad: { type: Type.NUMBER, description: 'Valor de 1 a 5' },
            severidad: { type: Type.NUMBER, description: 'Valor de 1 a 5' },
            recomendaciones: { type: Type.ARRAY, items: { type: Type.STRING } },
            controles: { type: Type.ARRAY, items: { type: Type.STRING } },
            normativa: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'title',
            'actividad',
            'description',
            'riesgo',
            'consecuencia',
            'probabilidad',
            'severidad',
            'recomendaciones',
            'controles',
            'normativa',
          ],
        },
      },
    },
  });
  return parseGeminiJson(response);
};

export const suggestNormativesWithAI = async (industry: string): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Genera una lista de 3 normativas, leyes o decretos chilenos específicos y críticos para la industria: ${industry}. No incluyas la Ley 16.744 ni el DS 594 que son generales. Enfócate en riesgos específicos del rubro.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            code: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING },
          },
          required: ['title', 'code', 'description', 'category'],
        },
      },
    },
  });

  return parseGeminiJson(response);
};
