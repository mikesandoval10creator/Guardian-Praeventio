import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const analyzeChemicalRisk = async (sdsText: string, storageConditions: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un Experto en Sustancias Peligrosas (HAZMAT) y Sistema Globalmente Armonizado (GHS).
    
    Texto de la Hoja de Seguridad (SDS/MSDS):
    "${sdsText}"
    
    Condiciones de Almacenamiento Actuales:
    "${storageConditions}"
    
    Analiza:
    1. Incompatibilidades químicas críticas.
    2. Requerimientos de EPP específicos.
    3. Riesgo de incendio, reactividad y salud.
    4. Acciones en caso de derrame según el contexto de almacenamiento.
    
    Respuesta en JSON:
    {
      "chemicalName": "string",
      "ghsClassification": ["string"],
      "criticalRisks": ["string"],
      "incompatibilities": ["string"],
      "ppeRequired": ["string"],
      "emergencyProcedures": {
        "spillControl": "string",
        "firstAid": "string"
      },
      "storageEvaluation": "string"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: prompt,
    generationConfig: {
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
          storageEvaluation: { type: Type.STRING }
        },
        required: ["chemicalName", "ghsClassification", "criticalRisks", "incompatibilities", "ppeRequired", "emergencyProcedures", "storageEvaluation"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const suggestChemicalSubstitution = async (currentChemical: string, purpose: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Sugiere alternativas menos peligrosas (Sustitución química) para el uso de "${currentChemical}" con el propósito de "${purpose}".
    Considera la toxicidad, inflamabilidad y costo-efectividad.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: prompt
  });

  return response.text;
};
