// Praeventio Guard — §12.5.1 split step 13: Gemini predictive bundle.
//
// Extraído VERBATIM de `services/geminiBackend.ts` (movement-only, zero
// behavior change — precedente del split de billing). Decimotercera
// extracción del split. Bundles 5 funciones predictivas/forecast:
//
//   1. generateRealisticIoTEvent(context) — evento IoT simulado
//      (temperatura/gas/ruido/vibración/biometría) para demos.
//   2. generatePredictiveForecast(projectName, context, weatherContext?) —
//      pronóstico de riesgo 48h con "Prevención Empática".
//   3. forecastSafetyEvents(nodesContext, historicalData?) — pronóstico
//      semanal con días críticos y tendencias.
//   4. predictAccidents(nodesContext, telemetryContext) — predicciones de
//      accidentes cruzando Red Neuronal + telemetría, con fundamento BCN.
//   5. analyzeSiteMapDensity(nodesContext, workersContext, assetsContext) —
//      puntos calientes geoespaciales por densidad/proximidad.
//
// Funciones AI thin wrappers — no contienen lógica de negocio.

import { GoogleGenAI, Type } from '@google/genai';
import { parseGeminiJson } from './parsing';
import { AI_MODEL_FAST } from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

export const generateRealisticIoTEvent = async (context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Genera un evento simulado de un sensor IoT industrial basado en el siguiente contexto:
    ${context}

    El evento debe ser realista y puede ser normal, una advertencia o crítico.
    Proporciona:
    1. deviceId (ej. SENSOR-TEMP-01)
    2. type (temperature, gas, noise, vibration, biometric)
    3. value (número)
    4. unit (°C, ppm, dB, mm/s, bpm)
    5. status (normal, warning, critical)
    6. message (descripción breve del evento)`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          deviceId: { type: Type.STRING },
          type: { type: Type.STRING, enum: ["temperature", "gas", "noise", "vibration", "biometric"] },
          value: { type: Type.NUMBER },
          unit: { type: Type.STRING },
          status: { type: Type.STRING, enum: ["normal", "warning", "critical"] },
          message: { type: Type.STRING }
        },
        required: ["deviceId", "type", "value", "unit", "status", "message"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const generatePredictiveForecast = async (projectName: string, context: string, weatherContext?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `
    Actúa como un experto en análisis predictivo de seguridad industrial (HSE) con un enfoque de "Prevención Empática".
    Tu objetivo no es solo evitar accidentes, sino cuidar el bienestar físico y mental de los trabajadores.

    Basado en los siguientes datos del proyecto "${projectName}":

    CONTEXTO OPERATIVO Y DE RIESGOS:
    ${context}

    CONTEXTO AMBIENTAL (CLIMA/SISMOS):
    ${weatherContext || 'Sin datos ambientales recientes.'}

    Genera un pronóstico de riesgo para las próximas 48 horas.
    Cruza los datos ambientales con las tareas operativas para sugerir medidas de cuidado activo (ej. si hay mucho calor y trabajo físico, sugerir pausas de hidratación y rotaciones cortas).

    Responde en formato JSON con la siguiente estructura:
    {
      "riskLevel": "Bajo" | "Medio" | "Alto" | "Crítico",
      "score": number (0-100),
      "topRisks": [
        { "title": string, "probability": number, "impact": string, "mitigation": string }
      ],
      "recommendations": [string],
      "empatheticActions": [string],
      "aiInsight": string
    }
  `;

  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskLevel: { type: Type.STRING, enum: ["Bajo", "Medio", "Alto", "Crítico"] },
          score: { type: Type.NUMBER },
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
          },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          empatheticActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          aiInsight: { type: Type.STRING }
        },
        required: ["riskLevel", "score", "topRisks", "recommendations", "empatheticActions", "aiInsight"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const forecastSafetyEvents = async (nodesContext: string, historicalData?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Actúa como un analista predictivo de seguridad industrial.
    Realiza un pronóstico de eventos de seguridad para los próximos 7 días basado en la red de conocimiento actual y datos históricos.

    RED DE CONOCIMIENTO (Red Neuronal):
    ${nodesContext}

    DATOS HISTÓRICOS / TENDENCIAS:
    ${historicalData || 'No hay datos históricos específicos proporcionados.'}

    Identifica tendencias, días de mayor riesgo y áreas críticas que requieren atención preventiva.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pronosticoSemanal: { type: Type.STRING, description: "Resumen ejecutivo del pronóstico" },
          diasCriticos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dia: { type: Type.STRING },
                nivelRiesgo: { type: Type.STRING, enum: ["Bajo", "Medio", "Alto", "Crítico"] },
                razon: { type: Type.STRING }
              },
              required: ["dia", "nivelRiesgo", "razon"]
            }
          },
          tendenciasDetectadas: { type: Type.ARRAY, items: { type: Type.STRING } },
          recomendacionesEstrategicas: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["pronosticoSemanal", "diasCriticos", "tendenciasDetectadas", "recomendacionesEstrategicas"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const predictAccidents = async (nodesContext: string, telemetryContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Actúa como "El Guardián", el núcleo de IA predictiva de Praeventio Guard.
    Analiza los datos históricos de la Red Neuronal y la telemetría actual para predecir posibles accidentes antes de que ocurran.

    HISTORIAL RED NEURONAL:
    ${nodesContext}

    TELEMETRÍA ACTUAL (Clima, IoT, Biometría):
    ${telemetryContext}

    Identifica patrones y genera predicciones de riesgos inminentes. Para cada predicción, proporciona una probabilidad (0-100), una descripción detallada del riesgo cruzando variables (ej. Clima + Fatiga + Tipo de Faena), y una medida de control inmediata basada en la normativa chilena de la Biblioteca del Congreso Nacional (BCN) (ej. DS 594, Ley 16.744).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          predictions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Título corto de la predicción." },
                probability: { type: Type.NUMBER, description: "Probabilidad del 0 al 100." },
                description: { type: Type.STRING, description: "Descripción detallada cruzando variables." },
                preventiveAction: { type: Type.STRING, description: "Medida de control inmediata y fundamento legal." },
                severity: { type: Type.STRING, description: "Severidad: 'Baja', 'Media', 'Alta', 'Crítica'" }
              },
              required: ["title", "probability", "description", "preventiveAction", "severity"]
            }
          }
        },
        required: ["predictions"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const analyzeSiteMapDensity = async (nodesContext: string, workersContext: string, assetsContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Analiza la densidad y distribución geoespacial del proyecto para identificar riesgos por aglomeración o proximidad a peligros.

    RIESGOS E INCIDENTES (Red Neuronal):
    ${nodesContext}

    UBICACIÓN DE PERSONAL:
    ${workersContext}

    UBICACIÓN DE ACTIVOS Y SENSORES:
    ${assetsContext}

    Identifica "puntos calientes" de riesgo y proporciona recomendaciones de redistribución o alerta.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          puntosCalientes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sector: { type: Type.STRING },
                nivelRiesgo: { type: Type.STRING, enum: ["Bajo", "Medio", "Alto", "Crítico"] },
                descripcion: { type: Type.STRING },
                recomendacion: { type: Type.STRING }
              },
              required: ["sector", "nivelRiesgo", "descripcion", "recomendacion"]
            }
          },
          insightGlobal: { type: Type.STRING },
          alertaInmediata: { type: Type.BOOLEAN }
        },
        required: ["puntosCalientes", "insightGlobal", "alertaInmediata"]
      }
    }
  });

  return parseGeminiJson(response);
};
