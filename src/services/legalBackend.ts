import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const auditLegalGap = async (companyProcedures: any[], applicableNormatives: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un Auditor Legal experto en la Ley 16.744 y normativas de seguridad industrial (ISO 45001, OHSAS).
    
    Procedimientos de la Empresa:
    ${JSON.stringify(companyProcedures)}
    
    Normativas Aplicables:
    ${JSON.stringify(applicableNormatives)}
    
    Tu tarea es:
    1. Identificar brechas (gaps) donde los procedimientos no cumplen con la normativa.
    2. Evaluar el riesgo legal (Multas, Clausura, Responsabilidad Civil/Penal).
    3. Sugerir acciones correctivas inmediatas.
    
    Respuesta en formato JSON:
    {
      "gaps": [
        {
          "normativeReference": "string",
          "finding": "string",
          "riskLevel": "Crítico" | "Alto" | "Medio" | "Bajo",
          "legalConsequence": "string",
          "recommendation": "string"
        }
      ],
      "complianceScore": number (0-100)
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          gaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                normativeReference: { type: Type.STRING },
                finding: { type: Type.STRING },
                riskLevel: { type: Type.STRING },
                legalConsequence: { type: Type.STRING },
                recommendation: { type: Type.STRING }
              },
              required: ["normativeReference", "finding", "riskLevel", "legalConsequence", "recommendation"]
            }
          },
          complianceScore: { type: Type.NUMBER }
        },
        required: ["gaps", "complianceScore"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const evaluateNormativeImpact = async (newNormativeText: string, currentOperations: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Analiza el impacto de esta nueva normativa en las operaciones actuales de la empresa.
    
    Nueva Normativa: "${newNormativeText}"
    
    Operaciones Actuales:
    ${JSON.stringify(currentOperations)}
    
    Determina qué procesos deben cambiar y el nivel de esfuerzo requerido.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt
  });

  return response.text;
};
