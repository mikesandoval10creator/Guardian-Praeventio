// Praeventio Guard — §12.5.1 split step 9: Gemini safety documents.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Novena
// extracción del split. Bundles 3 funciones de generación de docs:
//
//   1. generatePTS(taskName, taskDescription, riskLevel, normative,
//      _glossary, envContext, zkContext, documentType) — Procedimiento
//      de Trabajo Seguro JSON estructurado.
//   2. generatePTSWithManufacturerData(...) — PTS + manuales fabricante
//      via Gemini Search tool.
//   3. generateSafetyReport(reportType, context) — borrador Markdown
//      (PTS / PE / AST).

import { GoogleGenAI, Type } from '@google/genai';
import { parseGeminiJson } from './parsing';

const API_KEY = process.env.GEMINI_API_KEY;

export const generatePTS = async (
  taskName: string,
  taskDescription: string,
  riskLevel: string,
  normative: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _glossary: any,
  envContext: string,
  zkContext: string,
  documentType: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: `Actúa como un experto en prevención de riesgos chileno certificado en ISO 45001.
    Genera un documento de tipo ${documentType} para la tarea: "${taskName}".
    Descripción: ${taskDescription}
    Nivel de Riesgo: ${riskLevel}. Normativa: ${normative}.
    Contexto Ambiental: ${envContext}
    Contexto Zettelkasten: ${zkContext}
    Sé específico, técnico y alineado con la legislación chilena (DS 594, Ley 16.744).`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          objetivo: { type: Type.STRING },
          alcance: { type: Type.STRING },
          marcoLegal: { type: Type.ARRAY, items: { type: Type.STRING } },
          evaluacionMatematica: { type: Type.STRING },
          responsabilidades: { type: Type.ARRAY, items: { type: Type.STRING } },
          epp: { type: Type.ARRAY, items: { type: Type.STRING } },
          riesgos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                riesgo: { type: Type.STRING },
                control: { type: Type.STRING },
              },
              required: ['riesgo', 'control'],
            },
          },
          pasos: { type: Type.ARRAY, items: { type: Type.STRING } },
          emergencias: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'objetivo',
          'alcance',
          'marcoLegal',
          'evaluacionMatematica',
          'responsabilidades',
          'epp',
          'riesgos',
          'pasos',
          'emergencias',
        ],
      },
    },
  });

  return parseGeminiJson(response);
};

export const generatePTSWithManufacturerData = async (
  taskName: string,
  taskDescription: string,
  machineryDetails: string,
  riskLevel: string,
  normative: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _glossary: any,
  envContext: string,
  zkContext: string,
  documentType: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: `Actúa como un experto en prevención de riesgos y mantenimiento industrial chileno.
    Genera un documento de tipo ${documentType} para la tarea: "${taskName}".
    Descripción: ${taskDescription}
    Herramientas y Maquinaria: ${machineryDetails}
    Nivel de Riesgo: ${riskLevel}. Normativa: ${normative}.
    Contexto Ambiental: ${envContext}
    Contexto Zettelkasten: ${zkContext}

    USA la búsqueda web para obtener información REAL de los manuales de seguridad del fabricante para cada herramienta o maquinaria indicada. Integra esas especificaciones en los pasos y medidas de control.

    Devuelve ÚNICAMENTE JSON válido con esta estructura (sin bloques markdown):
    {
      "objetivo": "...",
      "alcance": "...",
      "marcoLegal": ["..."],
      "evaluacionMatematica": "...",
      "responsabilidades": ["..."],
      "epp": ["..."],
      "riesgos": [{"riesgo": "...", "control": "..."}],
      "pasos": ["..."],
      "emergencias": ["..."],
      "fuentesFabricante": ["URL o referencia del manual consultado"]
    }`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const raw = (response.text || '{}')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(raw);
};

export const generateSafetyReport = async (
  reportType: 'PTS' | 'PE' | 'AST',
  context: string,
): Promise<string | undefined> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Eres "El Guardián", el núcleo de IA de Praeventio Guard. Genera un borrador profesional y exhaustivo de un documento de seguridad tipo ${reportType} (Procedimiento de Trabajo Seguro, Plan de Emergencia o Análisis Seguro de Trabajo) basado en el siguiente contexto:

    CONTEXTO:
    ${context}

    INSTRUCCIONES:
    1. El formato debe ser Markdown estructurado con secciones claras: Objetivos, Alcance, Responsabilidades, Riesgos Identificados, Medidas de Control (con fundamento legal chileno basado en la BCN como DS 594, Ley 16.744), EPP Requerido y Procedimiento Paso a Paso.
    2. Usa un tono técnico, preventivo, positivo y altamente profesional (Español de Chile).
    3. Aplica principios de "El Arte de la Guerra" en la prevención (atacar el riesgo antes de que se manifieste).
    4. Las fórmulas matemáticas de riesgo (si aplican) deben ir en formato LaTeX (ej. $R = P \\times C$).
    5. Sé directo y accionable.`,
  });

  return response.text;
};
