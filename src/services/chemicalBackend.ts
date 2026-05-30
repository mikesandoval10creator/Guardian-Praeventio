import { GoogleGenAI, Type } from "@google/genai";
import { CHEMICAL_PROMPT } from "./coach/prompts.js";
import { NormativeRagService, type NormativeChunk } from "./coach/normativeRag.js";

const API_KEY = process.env.GEMINI_API_KEY;

// Lazy-initialized RAG (constructed on first use). One instance is enough —
// the hermetic in-memory retrieval is cheap and stateless per call.
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
  const fewShots = CHEMICAL_PROMPT.examples
    .map((e, i) => `Ejemplo ${i + 1}:\nP: ${e.input}\nR: ${e.output}`)
    .join("\n\n");
  return `${CHEMICAL_PROMPT.systemPrompt}\n\nRegla operacional: ${CHEMICAL_PROMPT.rule}\n\nNormas a citar (cuando aplique): ${CHEMICAL_PROMPT.citations.join(", ")}\n\n${fewShots}\n`;
};

export const analyzeChemicalRisk = async (sdsText: string, storageConditions: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `${sdsText}\n${storageConditions}`,
    "chemical",
    5,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Texto de la Hoja de Seguridad (SDS/MSDS):
"${sdsText}"

Condiciones de Almacenamiento Actuales:
"${storageConditions}"

Analiza:
1. Incompatibilidades químicas críticas (citar DS 148/2003 si aplica).
2. Requerimientos de EPP específicos (controles jerárquicos primero).
3. Riesgo de incendio, reactividad y salud (clasificar GHS).
4. Acciones en caso de derrame según el contexto de almacenamiento.

Responde en JSON estricto incluyendo el array "citations" con las
referencias normativas que respaldan cada hallazgo.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          chemicalName: { type: Type.STRING },
          ghsClassification: { type: Type.ARRAY, items: { type: Type.STRING } },
          criticalRisks: { type: Type.ARRAY, items: { type: Type.STRING } },
          incompatibilities: { type: Type.ARRAY, items: { type: Type.STRING } },
          ppeRequired: { type: Type.ARRAY, items: { type: Type.STRING } },
          emergencyProcedures: {
            type: Type.OBJECT,
            properties: {
              spillControl: { type: Type.STRING },
              firstAid: { type: Type.STRING }
            },
            required: ["spillControl", "firstAid"]
          },
          storageEvaluation: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["chemicalName", "ghsClassification", "criticalRisks", "incompatibilities", "ppeRequired", "emergencyProcedures", "storageEvaluation"]
      }
    }
  });

  if (!response.text) throw new Error('gemini_empty_response');
  const parsed = JSON.parse(response.text);
  // Ensure RAG citations are always present in the response, even if Gemini
  // omitted them, so downstream UI can always render the source list.
  parsed.citations = Array.from(
    new Set([...(parsed.citations ?? []), ...usedCitations]),
  );
  return parsed;
};

export const designHazmatStorage = async (storageType: string, volume: number, materialClass: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `almacenamiento ${storageType} ${materialClass} ${volume}`,
    "chemical",
    5,
  );
  const usedCitations = ragChunks.map((c) => c.citation);

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Diseña un plan de almacenamiento seguro para sustancias peligrosas (HAZMAT).

Tipo de Almacenamiento: ${storageType}
Volumen: ${volume} Litros/Kilos
Clase de Material: ${materialClass}

Define:
1. Especificaciones estructurales necesarias.
2. Sistema de contención de derrames.
3. Ventilación y control de temperatura.
4. Distancias de segregación recomendadas (citar DS 148/2003 si aplica).

Responde en JSON e incluye "citations" con las normas usadas.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          structuralRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
          containmentDesign: { type: Type.STRING },
          safetyFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
          segregationAdvice: { type: Type.STRING },
          complianceNotes: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["structuralRequirements", "containmentDesign", "safetyFeatures"]
      }
    }
  });

  if (!response.text) throw new Error('gemini_empty_response');
  const parsed = JSON.parse(response.text);
  parsed.citations = Array.from(
    new Set([...(parsed.citations ?? []), ...usedCitations]),
  );
  return parsed;
};

export const suggestChemicalSubstitution = async (currentChemical: string, purpose: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const rag = getRag();
  const ragChunks = await rag.searchTopK(
    `${currentChemical} sustitución ${purpose}`,
    "chemical",
    3,
  );

  const prompt = `${renderPersonaHeader()}${renderRagContext(ragChunks)}

Sugiere alternativas menos peligrosas (Sustitución química) para el uso de
"${currentChemical}" con el propósito de "${purpose}".
Considera la toxicidad (LPP DS 594 anexo 4), inflamabilidad (categorías GHS)
y costo-efectividad. Cita la normativa que respalda la jerarquía de control.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });

  return response.text;
};
