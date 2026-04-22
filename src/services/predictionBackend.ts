import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const generatePredictiveForecast = async (projectName: string, context: string, weatherContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Genera un pronóstico predictivo de seguridad para el proyecto: ${projectName}.
    
    Contexto de Riesgos (Red Neuronal):
    ${context}
    
    Contexto Ambiental (Telemetría):
    ${weatherContext}
    
    Eres el "Guardián Predictivo" de Praeventio.
    Tu tarea es anticipar los 3 riesgos más probables para las próximas 48 horas basándote en la combinación de factores ambientales y debilidades operativas identificadas.
    
    IMPORTANTE: Genera también "Acciones Empáticas" (human-centric) para los supervisores.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER, description: "Probabilidad global de incidente (0-100)" },
          riskLevel: { type: Type.STRING, enum: ["Bajo", "Medio", "Alto", "Crítico"] },
          aiInsight: { type: Type.STRING },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          empatheticActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          topRisks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                probability: { type: Type.NUMBER },
                impact: { type: Type.STRING },
                mitigation: { type: Type.STRING }
              },
              required: ["title", "probability", "impact", "mitigation"]
            }
          }
        },
        required: ["score", "riskLevel", "aiInsight", "recommendations", "topRisks"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const analyzeRiskCorrelations = async (nodes: any[], events: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Analiza correlaciones ocultas entre los nodos de la red de conocimiento y los eventos de telemetría recientes.
    
    Nodos: ${JSON.stringify(nodes.slice(0, 50))}
    Eventos: ${JSON.stringify(events.slice(0, 50))}
    
    Busca patrones no evidentes (ej. "Cada vez que sube la humedad, aumentan los reportes de resbalones en la zona B").
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            pattern: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            suggestedControl: { type: Type.STRING }
          },
          required: ["pattern", "confidence", "suggestedControl"]
        }
      }
    }
  });

  return JSON.parse(response.text);
};
