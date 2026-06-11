// Praeventio Guard — §12.5.1 split step 15: Gemini normative-compliance bundle.
//
// Extraído VERBATIM de `services/geminiBackend.ts` (movement-only, zero
// behavior change — precedente del split de billing). Decimoquinta
// extracción del split. Bundles 5 funciones de compliance normativo:
//
//   1. generateOperationalTasks(normativeTitle, normativeDescription) —
//      traduce una normativa en 5-7 tareas operativas verificables.
//   2. evaluateMinsalCompliance(protocolTitle, context, industry?) —
//      auditoría MINSAL con contexto legal RAG (BCN). Devuelve Markdown;
//      degrada a string de error en castellano (nunca propaga).
//   3. calculateComplianceSummary(projectId, nodes) — score global 0-100
//      por categorías. Consumido también por `safetyEngineBackend.ts` vía
//      el barrel de geminiBackend.
//   4. processGlobalSafetyAudit(projectId, projectData) — auditoría master
//      con brechas críticas y correlaciones. Ídem safetyEngineBackend.
//   5. scanLegalUpdates(normativeTitle, normativeText, modulesSummary) —
//      impacto de actualizaciones normativas sobre los módulos. Consumido
//      también por `src/server/routes/misc.ts` vía el barrel.
//
// Funciones AI thin wrappers — no contienen lógica de negocio.

import { GoogleGenAI, Type } from '@google/genai';
import { searchRelevantContext } from '../ragService';
import { logger } from '../../utils/logger';
import { parseGeminiJson } from './parsing';
import {
  AI_MODEL_FAST,
  AI_MODEL_FAST_STABLE,
  AI_MODEL_REASONING,
} from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

export const generateOperationalTasks = async (normativeTitle: string, normativeDescription: string): Promise<string[]> => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `
    Eres un experto en Prevención de Riesgos y Compliance Normativo en Chile.
    Tu tarea es traducir la siguiente normativa legal en una lista de tareas operativas claras y accionables para los trabajadores y supervisores en terreno.

    Normativa: ${normativeTitle}
    Descripción: ${normativeDescription}

    Genera una lista de 5 a 7 tareas operativas específicas, escritas en lenguaje claro y directo.
    Cada tarea debe ser una acción concreta que se pueda verificar (ej. "Revisar que el arnés tenga su certificación al día antes de cada uso").

    Devuelve ÚNICAMENTE un array de strings en formato JSON.
  `;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING
        }
      }
    }
  });

  return parseGeminiJson(response);
};

export const evaluateMinsalCompliance = async (protocolTitle: string, context: string, industry?: string) => {
  try {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    // Get relevant legal context using RAG
    const legalContext = await searchRelevantContext(`Exigencias y sanciones del protocolo MINSAL: ${protocolTitle} en la industria ${industry || 'general'}`);

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = `
      Actúa como un Auditor Senior del Ministerio de Salud de Chile (MINSAL) y experto en la Ley 16.744, utilizando siempre como base la Biblioteca del Congreso Nacional de Chile (BCN).
      Necesito evaluar el nivel de cumplimiento del siguiente protocolo en mi proyecto:
      Protocolo: ${protocolTitle}
      Industria: ${industry || 'General'}
      Contexto Actual del Proyecto (Hallazgos, Riesgos, Incidentes):
      ${context || 'Sin datos específicos registrados aún.'}

      CONTEXTO LEGAL Y REQUISITOS (RAG):
      ${legalContext}

      Por favor, genera un informe de auditoría estructurado que incluya:
      1. **Estado de Cumplimiento Estimado**: (Cumple, En Riesgo, No Cumple) basado en el contexto.
      2. **Brechas Identificadas**: Qué falta según las exigencias del protocolo (ej. evaluaciones ambientales, vigilancia médica, capacitación).
      3. **Plan de Acción Inmediato**: Pasos operativos claros para cerrar las brechas.
      4. **Multas o Sanciones Potenciales**: Qué riesgos legales enfrenta la empresa si no regulariza la situación (referencia a la ley y multas del Código Sanitario).

      Responde en formato Markdown, estructurado, claro y profesional.
    `;

    const result = await ai.models.generateContent({
      model: AI_MODEL_REASONING,
      contents: prompt
    });
    return result.text || 'No se pudo generar la evaluación.';
  } catch (error) {
    logger.error('Error evaluating MINSAL compliance:', error);
    return 'Error al evaluar el cumplimiento del protocolo. Por favor, intente nuevamente.';
  }
};

export const calculateComplianceSummary = async (projectId: string, nodes: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // Filter nodes for the project
  const projectNodes = nodes.filter(n => n.projectId === projectId);

  const summaryContext = projectNodes.map(n => ({
    type: n.type,
    title: n.title,
    status: n.metadata?.status || n.metadata?.estado || "pending"
  }));

  const prompt = `
    Analiza el estado de cumplimiento de seguridad para el proyecto ${projectId}.
    Desglose:
    ${JSON.stringify(summaryContext)}

    Proporciona un puntaje global (0-100), desglose por categorías y 3 acciones críticas.
  `;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          globalScore: { type: Type.NUMBER },
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                score: { type: Type.NUMBER }
              },
              required: ["name", "score"]
            }
          },
          criticalActions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["globalScore", "categories", "criticalActions"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const processGlobalSafetyAudit = async (_projectId: string, projectData: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Auditoría Master de Seguridad - Proyecto: ${projectData.name}.
    Reportes: ${JSON.stringify(projectData.reports || [])}
    Controles: ${JSON.stringify(projectData.controls || [])}
    Nodos: ${JSON.stringify(projectData.nodesSummary || [])}

    Identifica brechas críticas y correlaciones de riesgo.
  `;

  const response = await ai.models.generateContent({
    model: AI_MODEL_REASONING,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          auditTitle: { type: Type.STRING },
          keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
          riskCorrelations: { type: Type.ARRAY, items: { type: Type.STRING } },
          criticalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          healthIndex: { type: Type.NUMBER }
        },
        required: ["auditTitle", "keyFindings", "riskCorrelations", "criticalGaps", "recommendations", "healthIndex"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const scanLegalUpdates = async (normativeTitle: string, normativeText: string, modulesSummary: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un experto en normativa de seguridad laboral chilena (DS 594, DS 44/2024, Ley 16.744, SUSESO).
    Se ha publicado o actualizado la siguiente norma: "${normativeTitle}".
    Extracto: ${normativeText.slice(0, 1500)}

    Módulos operativos actuales del sistema: ${modulesSummary.slice(0, 800)}

    Analiza si esta actualización normativa afecta alguno de los módulos. Responde en JSON.
  `;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST_STABLE,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          affected: { type: Type.BOOLEAN },
          impactLevel: { type: Type.STRING, enum: ["Crítico", "Alto", "Moderado", "Bajo", "Sin impacto"] },
          affectedModules: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          recommendedAction: { type: Type.STRING }
        },
        required: ["affected", "impactLevel", "affectedModules", "summary", "recommendedAction"]
      }
    }
  });

  return parseGeminiJson(response);
};
