import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const calculatePreventionROI = async (projectData: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Calcula el Retorno de Inversión (ROI) preventivo para un proyecto de seguridad industrial.
    
    Datos del Proyecto:
    - Nombre: ${projectData.name}
    - Incidentes este año: ${projectData.incidentsCount}
    - Inversión en prevención (EPP, Capacitaciones, Software): ${projectData.preventionInvestment}
    - Costo promedio industria por accidente: ${projectData.avgIndustryAccidentCost || 2500000}
    
    Proporciona:
    1. Estimación de accidentes prevenidos mediante el uso de Praeventio.
    2. Ahorro total estimado (ROI).
    3. Impacto en la cotización adicional (Ley 16.744 Chile).
    
    Responde en JSON.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          accidentsPrevented: { type: Type.NUMBER },
          totalSavings: { type: Type.NUMBER },
          roiPercentage: { type: Type.NUMBER },
          cotizacionImpact: { type: Type.STRING },
          financialSummary: { type: Type.STRING }
        },
        required: ["accidentsPrevented", "totalSavings", "roiPercentage", "cotizacionImpact", "financialSummary"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateSusesoFormMetadata = async (incident: any, projectContext: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Genera la metadata detallada para un formulario SUSESO (DIAT/DIEP) en Chile.
    
    Incidente:
    ${JSON.stringify(incident)}
    
    Empresa: ${projectContext.companyName || 'Praeventio Guard'}
    Proyecto: ${projectContext.name}
    
    Completa los campos técnicos necesarios para la plataforma de la Mutualidad.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          descripcionTecnica: { type: Type.STRING },
          codigoCausa: { type: Type.STRING, description: "Código de causa según codificación SUSESO" },
          causaRelacionada: { type: Type.STRING },
          agenteAccidente: { type: Type.STRING },
          gravedadEstimada: { type: Type.STRING, enum: ["Leve", "Grave", "Fatal"] },
          medidasInmediatas: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["descripcionTecnica", "codigoCausa", "causaRelacionada", "gravedadEstimada", "medidasInmediatas"]
      }
    }
  });

  return JSON.parse(response.text);
};
