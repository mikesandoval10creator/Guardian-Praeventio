import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const generateCustomSafetyTraining = async (gapDescription: string, audienceProfile: string, industry: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Genera un micro-curso de capacitación de seguridad (Cápsula de 5 minutos).
    
    Brecha Detectada: "${gapDescription}"
    Perfil del Público: "${audienceProfile}"
    Industria: "${industry}"
    
    Estructura la respuesta en JSON:
    {
      "title": "string",
      "learningObjectives": ["string"],
      "keyMessage": "string",
      "practicalActivities": ["string"],
      "quiz": [
        { "question": "string", "options": ["string"], "correctIndex": number }
      ]
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
          title: { type: Type.STRING },
          learningObjectives: { type: Type.ARRAY, items: { type: Type.STRING } },
          keyMessage: { type: Type.STRING },
          practicalActivities: { type: Type.ARRAY, items: { type: Type.STRING } },
          quiz: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.NUMBER }
              },
              required: ["question", "options", "correctIndex"]
            }
          }
        },
        required: ["title", "learningObjectives", "keyMessage", "practicalActivities", "quiz"]
      }
    }
  });

  return JSON.parse(response.text);
};
