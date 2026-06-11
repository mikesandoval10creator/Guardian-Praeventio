// Praeventio Guard — §12.5.1 split step 12: Gemini operations bundle.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos).
// Duodécima extracción del split. Bundles 7 funciones operacionales:
//
//   Audit:
//     1. generateISOAuditChecklist(topic, context) — checklist ISO 45001
//        adaptado con dependencias entre items.
//     2. auditAISuggestion(suggestion, context) — "Guardián de la Ética"
//        valida sugerencias IA contra normativa + valores empresa.
//     3. auditProjectComplianceWithAI(projectName, ctx, normativeCtx) —
//        auditoría completa con compliance score + gaps críticos.
//   Documents:
//     4. processDocumentToNodes(text) — chunking + extract concept nodes
//        del manual/ley/procedimiento.
//     5. analyzeDocumentCompliance(documentText, normativeContext) —
//        compliance check con score 0-100.
//   Incidents:
//     6. investigateIncidentWithAI(title, description, context) — ICAM
//        + 5 Porqués + Ishikawa con RAG marco legal Chile.
//     7. analyzeAttendancePatterns(projectName, attendanceData) —
//        detección patrones fatiga / turnos irregulares.

import * as Sentry from '@sentry/core';
import { GoogleGenAI, Type } from '@google/genai';
import type { RiskNode } from '../../types';
import { logger } from '../../utils/logger';
import { redactPii } from '../observability/piiRedactor';
import { searchRelevantContext } from '../ragService';
import { parseGeminiJson, withExponentialBackoff } from './parsing';
import { AI_MODEL_FAST, AI_MODEL_REASONING } from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

// TODO(§12.5.1 step 12 → step 2 merge): cuando PR #555 (gemini/pii.ts)
// mergee a main, reemplazar este helper inline por import compartido.
const redactPromptForVertex = (prompt: string, action: string): string => {
  const { redacted, count, categories } = redactPii(prompt);
  if (count > 0) {
    logger.info(
      `[pii.redaction] action=${action} count=${count} categories=${categories.join(',')}`,
    );
    try {
      Sentry.addBreadcrumb({
        category: 'pii.redaction',
        level: 'info',
        message: `Redacted ${count} PII token(s) before Vertex AI call`,
        data: { action, count, categories },
      });
    } catch {
      /* observability faults must not change control flow */
    }
  }
  return redacted;
};

export const generateISOAuditChecklist = async (
  topic: string,
  context: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_REASONING,
    contents: `Genera un checklist de auditoría basado en la norma ISO 45001 para el tema: "${topic}".

    Utiliza el siguiente contexto de riesgos del proyecto para adaptar las preguntas:
    ${context}

    Proporciona:
    1. Un título formal para la auditoría.
    2. Una breve descripción del alcance.
    3. Una lista de ítems a evaluar. Para cada ítem, incluye:
       - Un ID único (ej. ISO-45001-8.1.2).
       - La pregunta de auditoría.
       - La cláusula o referencia normativa.
       - Opcionalmente, dependsOnId (ID del ítem padre) y dependsOnStatus ("No Cumple" o "Cumple") cuando esta pregunta solo debe mostrarse si el ítem padre tiene ese estado. Úsalo para preguntas de seguimiento (ej. "¿Tiene plan de acción?" solo aparece si la pregunta anterior fue "No Cumple").`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                question: { type: Type.STRING },
                reference: { type: Type.STRING },
                dependsOnId: { type: Type.STRING },
                dependsOnStatus: { type: Type.STRING },
              },
              required: ['id', 'question', 'reference'],
            },
          },
        },
        required: ['title', 'description', 'items'],
      },
    },
  });

  return parseGeminiJson(response);
};

export const processDocumentToNodes = async (text: string): Promise<RiskNode[]> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // Chunking strategy to avoid token limits.
  const CHUNK_SIZE = 8000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  const allNodes: RiskNode[] = [];

  for (const chunk of chunks) {
    try {
      const chunkPrompt = `Analiza el siguiente fragmento de texto (un manual, ley o procedimiento) y extrae conceptos clave como "Nodos Maestros" para una base de conocimiento de seguridad industrial.

          Fragmento:
          ${chunk}

          Para cada nodo extraído, proporciona:
          1. title: Un título corto y representativo.
          2. content: Una descripción clara y concisa del concepto, regla o procedimiento.
          3. tags: Una lista de etiquetas relevantes para categorizar el nodo.`;
      const response = await withExponentialBackoff(() =>
        ai.models.generateContent({
          model: AI_MODEL_REASONING,
          contents: redactPromptForVertex(chunkPrompt, 'processDocumentToNodes'),
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['title', 'content', 'tags'],
              },
            },
          },
        }),
      );

      const nodes = parseGeminiJson<RiskNode[]>(response);
      allNodes.push(...nodes);
    } catch (e) {
      logger.error('Error processing chunk for document nodes:', e);
    }
  }

  return allNodes;
};

export const auditAISuggestion = async (
  suggestion: string,
  context: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Actúa como el "Guardián de la Ética" de Praeventio Guard.
    Audita la siguiente sugerencia de IA contra la normativa de seguridad y los valores de la empresa.

    SUGERENCIA A AUDITAR:
    ${suggestion}

    CONTEXTO NORMATIVO Y VALORES:
    ${context}

    Determina si la sugerencia es segura, ética y cumple con la ley.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isApproved: { type: Type.BOOLEAN },
          riskLevel: { type: Type.STRING, description: 'Bajo, Medio, Alto' },
          auditNotes: { type: Type.STRING },
          suggestedAdjustments: { type: Type.STRING },
        },
        required: ['isApproved', 'riskLevel', 'auditNotes', 'suggestedAdjustments'],
      },
    },
  });

  return parseGeminiJson(response);
};

export const analyzeDocumentCompliance = async (
  documentText: string,
  normativeContext: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Analiza el cumplimiento normativo del siguiente documento.
    TEXTO DEL DOCUMENTO:
    ${documentText}

    CONTEXTO NORMATIVO:
    ${normativeContext}

    Determina si el documento cumple con la normativa y qué falta.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isCompliant: { type: Type.BOOLEAN },
          complianceScore: { type: Type.NUMBER },
          findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['isCompliant', 'complianceScore', 'findings', 'recommendations'],
      },
    },
  });

  return parseGeminiJson(response);
};

export const investigateIncidentWithAI = async (
  incidentTitle: string,
  incidentDescription: string,
  context: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // Search for relevant investigation techniques and legal requirements (e.g., DIAT/DIEP).
  const searchTerms = `Metodología investigación incidentes Chile ley 16.744 ${incidentTitle}`;
  const investigationProtocolContent = await searchRelevantContext(searchTerms);

  const incidentPrompt = `Actúa como un experto en investigación de accidentes laborales utilizando metodologías como el Diagrama de Ishikawa y los 5 Porqués (ICAM).
    Investiga el siguiente incidente:

    Título: ${incidentTitle}
    Descripción: ${incidentDescription}
    Contexto General/Ambiental: ${context}

    Marco Normativo de Investigación (RAG):
    ${investigationProtocolContent}

    Proporciona un análisis detallado que incluya:
    1. Resumen del incidente.
    2. Causas Inmediatas.
    3. Causas Raíz (Basado en los 5 Porqués).
    4. Acciones Correctivas Sugeridas con prioridad.
    5. Lección Aprendida Global para la red neuronal de riesgos.
    6. Referencia a formularios legales chilenos (DIAT/DIEP) si aplica.`;
  const response = await ai.models.generateContent({
    model: AI_MODEL_REASONING,
    contents: redactPromptForVertex(incidentPrompt, 'investigateIncidentWithAI'),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          immediateCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
          rootCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctiveActions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                action: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ['Alta', 'Media', 'Baja'] },
              },
              required: ['action', 'priority'],
            },
          },
          globalRiskLesson: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['title', 'description'],
          },
          legalRequirementNote: { type: Type.STRING },
        },
        required: [
          'summary',
          'immediateCauses',
          'rootCauses',
          'correctiveActions',
          'globalRiskLesson',
        ],
      },
    },
  });

  return parseGeminiJson(response);
};

export const auditProjectComplianceWithAI = async (
  projectName: string,
  projectContext: string,
  normativeContext: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Actúa como un auditor senior de cumplimiento de seguridad y salud ocupacional.
    Realiza una auditoría de cumplimiento para el proyecto ${projectName}.

    CONTEXTO DEL PROYECTO (Red Neuronal):
    ${projectContext}

    CONTEXTO NORMATIVO (Leyes, Reglamentos):
    ${normativeContext}

    Identifica brechas de cumplimiento, riesgos no mitigados y proporciona recomendaciones de mejora.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          complianceScore: { type: Type.NUMBER, description: 'Puntaje de 0 a 100' },
          criticalGaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                gap: { type: Type.STRING },
                regulation: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ['Crítica', 'Alta', 'Media'] },
              },
              required: ['gap', 'regulation', 'severity'],
            },
          },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
        },
        required: ['complianceScore', 'criticalGaps', 'recommendations', 'summary'],
      },
    },
  });

  return parseGeminiJson(response);
};

export const analyzeAttendancePatterns = async (
  projectName: string,
  attendanceData: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Analiza los siguientes patrones de asistencia de trabajadores en busca de riesgos de fatiga o seguridad para el proyecto ${projectName}.
    DATOS DE ASISTENCIA:
    ${attendanceData}

    Identifica trabajadores con exceso de horas, turnos irregulares o patrones que podrían indicar un riesgo.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskLevel: { type: Type.STRING, enum: ['Bajo', 'Medio', 'Alto', 'Crítico'] },
          findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['riskLevel', 'findings', 'recommendations'],
      },
    },
  });

  return parseGeminiJson(response);
};
