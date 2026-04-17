import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const predictEPPReplacement = async (eppItem: any, usageData: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Predice la fecha de reemplazo recomendada para el siguiente EPP y calcula su vida útil remanente.
    
    Item: ${JSON.stringify(eppItem)}
    Uso detectado (horas/ambiente): ${JSON.stringify(usageData)}
    
    Considera factores de degradación (UV, químicos, desgaste mecánico) para la industria.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          remainingLifePercentage: { type: Type.NUMBER },
          predictedReplacementDate: { type: Type.STRING },
          degradationFactors: { type: Type.ARRAY, items: { type: Type.STRING } },
          safetyWarning: { type: Type.STRING }
        },
        required: ["remainingLifePercentage", "predictedReplacementDate", "degradationFactors"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const auditEPPCompliance = async (workerId: string, assignedEPP: any[], requiredEPP: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Realiza una auditoría de cumplimiento de EPP para el trabajador ${workerId}.
    
    EPP Asignado: ${JSON.stringify(assignedEPP)}
    EPP Requerido por Matriz de Riesgo: ${JSON.stringify(requiredEPP)}
    
    Identifica brechas y genera una alerta si falta equipo crítico.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isCompliant: { type: Type.BOOLEAN },
          missingEquipment: { type: Type.ARRAY, items: { type: Type.STRING } },
          expiredEquipment: { type: Type.ARRAY, items: { type: Type.STRING } },
          riskLevel: { type: Type.STRING, enum: ["None", "Low", "Medium", "High", "Critical"] },
          recommendation: { type: Type.STRING }
        },
        required: ["isCompliant", "missingEquipment", "expiredEquipment", "riskLevel", "recommendation"]
      }
    }
  });

  return JSON.parse(response.text);
};
