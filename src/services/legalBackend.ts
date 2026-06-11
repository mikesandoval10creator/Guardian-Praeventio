import { GoogleGenAI, Type } from "@google/genai";
import { parseGeminiJson } from './gemini/parsing';
import { LEGAL_PROMPT } from "./coach/prompts.js";
import { NormativeRagService, type NormativeChunk } from "./coach/normativeRag.js";
import { AI_MODEL_FAST_STABLE, AI_MODEL_REASONING } from '../config/aiModels.js';

const API_KEY = process.env.GEMINI_API_KEY;

let ragSingleton: NormativeRagService | null = null;
const getRag = (): NormativeRagService => {
  if (!ragSingleton) ragSingleton = NormativeRagService.fromEnv();
  return ragSingleton;
};

const renderRagContext = (chunks: NormativeChunk[]): string => {
  if (chunks.length === 0) return "";
  const body = chunks
    .map((c, i) => `[${i + 1}] (${c.citation}) ${c.text}`)
    .join("\n");
  return `\n\nContexto normativo CL recuperado:\n${body}\n`;
};

const renderPersonaHeader = (): string => {
  const fewShots = LEGAL_PROMPT.examples
    .map((e, i) => `Ejemplo ${i + 1}:\nP: ${e.input}\nR: ${e.output}`)
    .join("\n\n");
  return `${LEGAL_PROMPT.systemPrompt}\n\nRegla operacional: ${LEGAL_PROMPT.rule}\n\nNormas troncales: ${LEGAL_PROMPT.citations.join(", ")}\n\n${fewShots}\n`;
};

export const auditLegalGap = async (companyProcedures: any[], applicableNormatives: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `auditoría legal cumplimiento ${JSON.stringify(applicableNormatives)}`,
    "legal",
    5,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Procedimientos de la Empresa:
${JSON.stringify(companyProcedures)}

Normativas Aplicables (input del usuario):
${JSON.stringify(applicableNormatives)}

Tarea:
1. Identificar brechas (gaps) donde los procedimientos no cumplen con la
   normativa. Cita SIEMPRE (ley/decreto + artículo).
2. Evaluar el riesgo legal (Multas en UTM, Clausura, Responsabilidad
   Civil/Penal, indemnizaciones por Ley 16.744).
3. Sugerir acciones correctivas inmediatas + plazo legal.

Respuesta en JSON estricto, incluyendo "citations" con TODAS las normas
referenciadas.`;

  const response = await ai.models.generateContent({
    model: AI_MODEL_REASONING,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          gaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                normativeReference: { type: Type.STRING },
                finding: { type: Type.STRING },
                riskLevel: { type: Type.STRING },
                legalConsequence: { type: Type.STRING },
                recommendation: { type: Type.STRING }
              },
              required: ["normativeReference", "finding", "riskLevel", "legalConsequence", "recommendation"]
            }
          },
          complianceScore: { type: Type.NUMBER },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["gaps", "complianceScore"]
      }
    }
  });

  if (!response.text) throw new Error('gemini_empty_response');
  const parsed = parseGeminiJson(response);
  parsed.citations = Array.from(
    new Set([...(parsed.citations ?? []), ...usedCitations]),
  );
  return parsed;
};

export const evaluateNormativeImpact = async (newNormativeText: string, currentOperations: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `impacto operacional nueva normativa ${newNormativeText.slice(0, 200)}`,
    "legal",
    4,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Analiza el impacto de esta nueva normativa en las operaciones actuales de
la empresa. Indica los procesos afectados, esfuerzo (alto/medio/bajo) y
plazos legales si los hay.

Nueva Normativa: "${newNormativeText}"

Operaciones Actuales:
${JSON.stringify(currentOperations)}`;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST_STABLE,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          procesosAfectados: { type: Type.ARRAY, items: { type: Type.STRING } },
          nivelEsfuerzo: { type: Type.STRING },
          recomendaciones: { type: Type.ARRAY, items: { type: Type.STRING } },
          resumen: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  });

  const parsed = parseGeminiJson(response);
  parsed.citations = Array.from(
    new Set([...(parsed.citations ?? []), ...usedCitations]),
  );
  return parsed;
};
