import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const suggestMeetingAgenda = async (projectRisks: any[], pendingAgreements: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Genera una tabla de contenidos y agenda para la reunión del Comité Paritario de Higiene y Seguridad (CPHS).
    
    Riesgos Críticos Recientes: ${JSON.stringify(projectRisks)}
    Acuerdos Pendientes: ${JSON.stringify(pendingAgreements)}
    
    Asegúrate de incluir los puntos obligatorios por el DS 54 de Chile.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          agendaTitle: { type: Type.STRING },
          points: { type: Type.ARRAY, items: { type: Type.STRING } },
          specialFocus: { type: Type.STRING, description: "Un tema crítico para tratar basándose en los riesgos" },
          regulatoryNotes: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["agendaTitle", "points", "specialFocus"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const summarizeAgreements = async (rawMeetingNotes: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Analiza las notas de una reunión del Comité Paritario y extrae los ACUERDOS de forma estructurada.
    
    Notas:
    ${rawMeetingNotes}
    
    Para cada acuerdo indica: descripción, responsable, y plazo sugerido.
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
            descripcion: { type: Type.STRING },
            responsable: { type: Type.STRING },
            fechaPlazo: { type: Type.STRING },
            complejidad: { type: Type.STRING, enum: ["Baja", "Media", "Alta"] }
          },
          required: ["descripcion", "responsable", "fechaPlazo"]
        }
      }
    }
  });

  return JSON.parse(response.text);
};
