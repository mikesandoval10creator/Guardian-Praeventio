import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";

const API_KEY = process.env.GEMINI_API_KEY;

export const generateShiftHandoverInsights = async (previousShiftEvents: any[], currentRisks: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un Jefe de Turno experto en Seguridad Industrial. 
    Tu objetivo es redactar un "Briefing de Traspaso de Turno" (Handover) crítico.
    
    Eventos del Turno Anterior:
    ${JSON.stringify(previousShiftEvents)}
    
    Riesgos Críticos Actuales:
    ${JSON.stringify(currentRisks)}
    
    Identifica:
    1. Tareas inconclusas con riesgo residual.
    2. Alarmas o eventos de telemetría que requieren seguimiento.
    3. Recomendaciones de seguridad para el equipo entrante.
    
    Respuesta en JSON:
    {
      "summary": "string",
      "criticalWarnings": ["string"],
      "pendingActions": [
        { "action": "string", "priority": "Alta" | "Media", "context": "string" }
      ],
      "safetyMantra": "string (una frase corta y potente para el equipo)"
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
          summary: { type: Type.STRING },
          criticalWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
          pendingActions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                action: { type: Type.STRING },
                priority: { type: Type.STRING },
                context: { type: Type.STRING }
              },
              required: ["action", "priority", "context"]
            }
          },
          safetyMantra: { type: Type.STRING }
        },
        required: ["summary", "criticalWarnings", "pendingActions", "safetyMantra"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const analyzeShiftFatiguePatterns = async (attendanceData: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Analiza los patrones de asistencia y horas extra para detectar fatiga laboral acumulada.
    Datos: ${JSON.stringify(attendanceData)}
    
    Identifica trabajadores o equipos con alto riesgo de accidente por fatiga.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: prompt
  });

  return response.text;
};
