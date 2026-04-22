import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const analyzePsychosocialRisks = async (surveyResults: any[], organizationalContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un Psicólogo Organizacional experto en el protocolo ISTAS-21 y riesgos psicosociales en el trabajo.
    
    Resultados de Encuestas/Observaciones:
    ${JSON.stringify(surveyResults)}
    
    Contexto Organizacional:
    "${organizationalContext}"
    
    Tu tarea es:
    1. Identificar dimensiones críticas (Doble presencia, Exigencias psicológicas, Apoyo social, etc.).
    2. Correlacionar estos riesgos con posibles ausentismos o accidentes.
    3. Proponer un plan de bienestar organizacional.
    
    Respuesta en JSON:
    {
      "criticalDimensions": [
        {
          "dimension": "string",
          "riskLevel": "Crítico" | "Alto" | "Medio" | "Bajo",
          "finding": "string",
          "recommendation": "string"
        }
      ],
      "predictedImpact": "string",
      "wellbeingPlan": ["string"]
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criticalDimensions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dimension: { type: Type.STRING },
                riskLevel: { type: Type.STRING },
                finding: { type: Type.STRING },
                recommendation: { type: Type.STRING }
              },
              required: ["dimension", "riskLevel", "finding", "recommendation"]
            }
          },
          predictedImpact: { type: Type.STRING },
          wellbeingPlan: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["criticalDimensions", "predictedImpact", "wellbeingPlan"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateStressPreventionTips = async (role: string, criticalRisks: string[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Genera 5 consejos prácticos de manejo de estrés para un trabajador con el cargo de "${role}".
    Riesgos detectados: ${criticalRisks.join(", ")}.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });

  return response.text;
};
