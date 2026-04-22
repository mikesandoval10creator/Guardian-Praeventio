import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const mapRisksToSurveillance = async (risks: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Basado en la siguiente lista de riesgos identificados en una faena, determina qué protocolos de vigilancia médica (Ministerio de Salud de Chile) son aplicables y qué exámenes específicos deben realizarse a los trabajadores.
    
    Riesgos:
    ${JSON.stringify(risks)}
    
    Considera protocolos como:
    - Ruido (PREXOR)
    - Sílice (PLANESI)
    - Radiación UV
    - Riesgos Psicosociales (SUSESO-ISTAS 21)
    - Manejo Manual de Carga
    
    Responde en JSON con la estructura:
    { "protocol": string, "riskFactor": string, "requiredExams": string[], "periodicityInMonths": number, "regulatoryRef": string }[]
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

  return JSON.parse(response.text);
};

export const analyzeHealthPatterns = async (medicalRecords: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Realiza una vigilancia epidemiológica basada en los siguientes registros médicos (anonimizados).
    Busca patrones que sugieran brotes de enfermedades profesionales o fatiga generalizada.
    
    Registros:
    ${JSON.stringify(medicalRecords)}
    
    Proporciona un resumen de hallazgos y alertas preventivas.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedHealthTrends: { type: Type.ARRAY, items: { type: Type.STRING } },
          criticalAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedInterventions: { type: Type.ARRAY, items: { type: Type.STRING } },
          healthIndexChange: { type: Type.NUMBER, description: "Cambio porcentual estimado en la salud de la población" }
        },
        required: ["detectedHealthTrends", "criticalAlerts", "recommendedInterventions"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateCompensatoryExercises = async (fatigue: number, posture: number, attention: number) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Genera una rutina de "Pausa Activa" o "Ejercicios Compensatorios" personalizada.
    
    Niveles detectados (0-100):
    - Fatiga: ${fatigue}
    - Mala Postura: ${posture}
    - Falta de Atención: ${attention}
    
    Crea 3-5 ejercicios cortos que se puedan realizar en el puesto de trabajo.
    Incluye una breve explicación de por qué estos ejercicios ayudan según los niveles detectados.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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
          aiMedicalAdvice: { type: Type.STRING }
        },
        required: ["routineTitle", "exercises", "aiMedicalAdvice"]
      }
    }
  });

  return JSON.parse(response.text);
};
