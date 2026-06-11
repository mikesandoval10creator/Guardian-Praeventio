import { GoogleGenAI, Type } from "@google/genai";
import { parseGeminiJson } from './gemini/parsing';
import { MEDICINE_PROMPT } from "./coach/prompts.js";
import { NormativeRagService, type NormativeChunk } from "./coach/normativeRag.js";
import { AI_MODEL_FAST, AI_MODEL_REASONING } from '../config/aiModels.js';

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
  const fewShots = MEDICINE_PROMPT.examples
    .map((e, i) => `Ejemplo ${i + 1}:\nP: ${e.input}\nR: ${e.output}`)
    .join("\n\n");
  return `${MEDICINE_PROMPT.systemPrompt}\n\nRegla operacional: ${MEDICINE_PROMPT.rule}\n\nProtocolos a respetar: ${MEDICINE_PROMPT.citations.join(", ")}\n\n${fewShots}\n`;
};

export const mapRisksToSurveillance = async (risks: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `vigilancia médica protocolo ${JSON.stringify(risks)}`,
    "medicine",
    5,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Basado en la siguiente lista de riesgos identificados en una faena, determina
qué protocolos de vigilancia médica MINSAL son aplicables y qué exámenes
específicos deben realizarse a los trabajadores. Asegúrate de citar el
protocolo exacto y la periodicidad reglamentaria.

Riesgos:
${JSON.stringify(risks)}

Considera protocolos: PREXOR (ruido), PLANESI (sílice), Vigilancia UV,
CEAL-SM/SUSESO (psicosocial — Circular 3.241), TMERT-EESS (TME),
Ley 20.001 + DS 63 (carga manual).

Responde en JSON con la estructura:
{ "protocol": string, "riskFactor": string, "requiredExams": string[],
  "periodicityInMonths": number, "regulatoryRef": string }[]`;

  const response = await ai.models.generateContent({
    model: AI_MODEL_REASONING,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            protocol: { type: Type.STRING },
            riskFactor: { type: Type.STRING },
            requiredExams: { type: Type.ARRAY, items: { type: Type.STRING } },
            periodicityInMonths: { type: Type.NUMBER },
            regulatoryRef: { type: Type.STRING }
          },
          required: ["protocol", "riskFactor", "requiredExams", "periodicityInMonths"]
        }
      }
    }
  });

  if (!response.text) throw new Error('gemini_empty_response');
  const parsed = parseGeminiJson(response);
  // Attach RAG citations as a separate metadata field on a wrapper if the
  // shape is an array. Callers that expect the bare array still work
  // because we only attach a non-enumerable property when possible.
  if (Array.isArray(parsed)) {
    Object.defineProperty(parsed, "citations", {
      value: usedCitations,
      enumerable: false,
    });
  }
  return parsed;
};

export const analyzeHealthPatterns = async (medicalRecords: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `vigilancia epidemiológica enfermedad profesional brote`,
    "medicine",
    5,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Realiza una vigilancia epidemiológica basada en los siguientes registros
médicos (anonimizados). Busca patrones que sugieran brotes de enfermedades
profesionales, fatiga generalizada o sub-diagnóstico. NO atribuyas causalidad
laboral sin justificar tasa o razón de prevalencia. Si hay sospecha de EP,
indica explícitamente la necesidad de DIEP a la mutualidad (DS 101/1968).

Registros:
${JSON.stringify(medicalRecords)}

Proporciona resumen, alertas y citations.`;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedHealthTrends: { type: Type.ARRAY, items: { type: Type.STRING } },
          criticalAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedInterventions: { type: Type.ARRAY, items: { type: Type.STRING } },
          healthIndexChange: { type: Type.NUMBER, description: "Cambio porcentual estimado en la salud de la población" },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["detectedHealthTrends", "criticalAlerts", "recommendedInterventions"]
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

export const generateCompensatoryExercises = async (fatigue: number, posture: number, attention: number) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `pausa activa ergonomía TMERT fatiga`,
    "medicine",
    3,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Genera una rutina de "Pausa Activa" o "Ejercicios Compensatorios"
personalizada, alineada con TMERT-EESS y la Ley 20.001 + DS 63 cuando aplique.

Niveles detectados (0-100):
- Fatiga: ${fatigue}
- Mala Postura: ${posture}
- Falta de Atención: ${attention}

Crea 3-5 ejercicios cortos que se puedan realizar en el puesto de trabajo.
Incluye explicación clínica y citations al protocolo aplicable.`;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          routineTitle: { type: Type.STRING },
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                durationSeconds: { type: Type.NUMBER },
                benefit: { type: Type.STRING }
              },
              required: ["name", "description", "durationSeconds"]
            }
          },
          aiMedicalAdvice: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["routineTitle", "exercises", "aiMedicalAdvice"]
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
