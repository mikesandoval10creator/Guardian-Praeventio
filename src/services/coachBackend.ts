import { Type } from "@google/genai";
import { createGeminiClient } from './ai/geminiClientFactory.js';
import { AI_MODEL_FAST } from '../config/aiModels';
import { getGeminiApiKey } from './ai/geminiApiKey.js';


export const getSafetyCoachResponse = async (uid: string, userStats: any, recentIncidents: any[], userMessage: string) => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const ai = createGeminiClient({ apiKey: apiKey });

  const prompt = `
    Eres "Praeventio AI Coach", un mentor de seguridad industrial empático y experto.
    Estás hablando con el trabajador ${uid}.
    
    Perfil del Trabajador:
    - Puntos: ${userStats.points}
    - Medallas: ${JSON.stringify(userStats.medals)}
    - Racha actual: ${userStats.loginStreak} días
    
    Incidentes Recientes en su área:
    ${JSON.stringify(recentIncidents)}
    
    Mensaje del Trabajador: "${userMessage}"
    
    Tu objetivo es:
    1. Responder su duda de seguridad.
    2. Motivarlo a seguir subiendo su puntaje y manteniendo su racha.
    3. Recordarle algún punto crítico de los incidentes recientes de forma constructiva.
    
    Responde de forma concisa y amigable.
  `;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: prompt
  });

  return response.text;
};
