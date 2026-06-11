// Praeventio Guard — §12.5.1 split step 5: Gemini multimodal/vision.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Quinta
// extracción del split. Bundles 3 funciones vision/multimodal:
//
//   1. analyzePostureWithAI(base64Image, mimeType) — ergonomía RULA/REBA
//      score 1-10 + findings + recommendations.
//   2. analyzeSafetyImage(base64Image, mimeType, context) — análisis
//      seguridad industrial (condiciones inseguras + EPP faltante).
//   3. analyzeBioImage(base64Image) — detección EPP rápida (cumplimiento
//      0-100 + detected + missing + alerts).
//
// IMPORTANTE — biometric/visión 100% on-device es la directiva del
// producto (CLAUDE.md regla #12). Estas funciones SOLO se usan en
// modos servidor explícitos (DIAT investigaciones, audit retroactivo),
// NO en el flow operativo del trabajador donde el detector edge
// (services/ai/eppDetectorOnDevice.ts) es la canonical path.

import { GoogleGenAI, Type } from '@google/genai';
import { parseGeminiJson } from './parsing';
import { AI_MODEL_VISION, AI_MODEL_VISION_FAST } from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

export const analyzePostureWithAI = async (
  base64Image: string,
  mimeType: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_VISION,
    contents: [
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
      {
        text: `Analiza esta imagen de un trabajador en su puesto de trabajo.
        Realiza una evaluación ergonómica rápida (basada en principios RULA/REBA).

        Proporciona:
        1. Una puntuación de riesgo ergonómico del 1 al 10 (10 siendo el riesgo más alto).
        2. Una lista de hallazgos específicos sobre la postura (ej. "Cuello flexionado más de 20 grados", "Hombros elevados").
        3. Una lista de recomendaciones inmediatas para corregir la postura.`,
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['score', 'findings', 'recommendations'],
      },
    },
  });

  return parseGeminiJson(response);
};

export const analyzeSafetyImage = async (
  base64Image: string,
  mimeType: string,
  context: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_VISION,
    contents: [
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
      {
        text: `Analiza esta imagen en el contexto de seguridad industrial.
        Contexto del proyecto: ${context}

        Identifica posibles riesgos, condiciones inseguras o falta de EPP.
        Proporciona:
        1. Título sugerido para el hallazgo.
        2. Descripción detallada de lo que se observa.
        3. Nivel de severidad (Alta, Media, Baja).
        4. Categoría (Seguridad, Salud, Medio Ambiente, Calidad).
        5. Lista de condiciones inseguras observadas.
        6. Lista de EPP faltante (si aplica).
        7. Acción inmediata recomendada.
        8. Etiquetas (tags) relevantes.`,
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ['Alta', 'Media', 'Baja'] },
          category: { type: Type.STRING },
          unsafeConditions: { type: Type.ARRAY, items: { type: Type.STRING } },
          missingEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          immediateAction: { type: Type.STRING },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'severity', 'category'],
      },
    },
  });

  return parseGeminiJson(response);
};

export const analyzeBioImage = async (base64Image: string): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_VISION_FAST,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image,
          },
        },
        {
          text: `Analiza esta imagen de un trabajador en un entorno industrial/laboral.
          Evalúa los siguientes aspectos y devuelve un JSON estricto:
          1. epp: Cumplimiento general de EPP (0 a 100).
          2. detectedEPP: Array de strings con los EPP que SÍ tiene puestos (ej. "Casco", "Lentes", "Chaleco Reflectante", "Guantes").
          3. missingEPP: Array de strings con los EPP básicos que le FALTAN (ej. "Lentes de seguridad", "Protección auditiva").
          4. alerts: Array de strings con alertas críticas detectadas (ej. "Falta casco", "Falta arnés en altura"). Si todo está bien, array vacío.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          epp: { type: Type.NUMBER },
          detectedEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          missingEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          alerts: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['epp', 'detectedEPP', 'missingEPP', 'alerts'],
      },
    },
  });

  return parseGeminiJson(response);
};
