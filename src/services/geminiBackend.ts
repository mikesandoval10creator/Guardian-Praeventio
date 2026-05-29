import { GoogleGenAI, Type, Modality, FunctionDeclaration } from "@google/genai";
import { RiskNode } from '../types';
import { searchRelevantContext, queryCommunityKnowledge } from './ragService';
import { calculateDeterministicSafeRoute } from './routingBackend.js';
import { logger } from '../utils/logger';
import { withSentryScope } from './observability/sentryInstrumentation';
// §12.5.1 split step 2 (2026-05-28): PII redaction moved to
// `services/gemini/pii.ts`. Import lifted; Sentry + redactPii imports
// removed since they were only used by this helper.
import { redactPromptForVertex } from './gemini/pii';
// Sprint 22 prod hardening (Bucket X) — circuit breaker + per-tenant
// quota tracking. The helpers `assertGeminiAllowed` /
// `recordGeminiOutcome` are called from the dispatch seam in
// `src/server/routes/gemini.ts`; defensive copies are also exported
// here so server-side jobs that bypass the HTTP layer (e.g.
// backgroundTriggers' embedding fan-out) can opt-in without recreating
// the wiring. Importing through a `.js` extension matches the rest of
// the file's TS-NodeNext module resolution.
import { geminiCircuit } from '../server/middleware/geminiCircuit.js';
import {
  trackGeminiUsage,
  checkQuotaLimit,
  type QuotaCheck,
} from './observability/quotaTracker.js';

// §12.5.1 split step 3 (2026-05-28): parsing helpers moved to
// `services/gemini/parsing.ts`. Helpers consumidos in-place sin cambio
// de behavior.
import { parseGeminiJson, withExponentialBackoff } from './gemini/parsing';

// §12.5.1 split step 1 (2026-05-28): governance helpers moved to
// `services/gemini/governance.ts`. Re-exported here for backwards
// compat — existing consumers (`src/server/routes/gemini.ts`) keep
// importing from `geminiBackend.ts` without changes. Migrate
// consumers to the direct path as part of follow-up cleanup.
export {
  assertGeminiAllowed,
  estimateGeminiCostUsd,
  recordGeminiOutcome,
} from './gemini/governance';

const API_KEY = process.env.GEMINI_API_KEY;

// §12.5.1 split step 4 (2026-05-28): embeddings + semantic search moved
// to `services/gemini/embeddings.ts`. Re-exported para backwards compat
// (consumers existentes: backgroundTriggers, ragService, etc).
export {
  generateEmbeddingsBatch,
  autoConnectNodes,
  semanticSearch,
  cosineSimilarity,
} from './gemini/embeddings';

// §12.5.1 split step 5 (2026-05-28): vision/multimodal moved to
// `services/gemini/vision.ts`. Re-exported para backwards compat.
export { analyzePostureWithAI, analyzeSafetyImage, analyzeBioImage } from './gemini/vision';

// §12.5.1 split step 6 (2026-05-28): risk analysis moved to
// `services/gemini/risk.ts`. Re-exported para backwards compat.
export {
  analyzeFastCheck,
  predictGlobalIncidents,
  analyzeRiskWithAI,
  analyzeRootCauses,
} from './gemini/risk';

// §12.5.1 split step 7 (2026-05-28): proactive suggestions moved to
// `services/gemini/suggestions.ts`. Re-exported para backwards compat.

// §12.5.1 split step 8 (2026-05-28): emergency planning moved to
// `services/gemini/emergency.ts`. Re-exported para backwards compat.
export {
  generateEmergencyPlan,
  generateEmergencyScenario,
  generateEmergencyPlanJSON,
} from './gemini/emergency';

// §12.5.1 split step 9 (2026-05-28): PTS + safety report moved to
// `services/gemini/safetyDocs.ts`. Re-exported para backwards compat.
export {
  generatePTS,
  generatePTSWithManufacturerData,
  generateSafetyReport,
} from './gemini/safetyDocs';

// §12.5.1 split step 10 (2026-05-28): chat + advice moved to
// `services/gemini/chat.ts`. Re-exported para backwards compat.
export { queryBCN, getChatResponse, getSafetyAdvice } from './gemini/chat';

// §12.5.1 split step 11 (2026-05-28): person-centric plans moved to
// `services/gemini/personPlans.ts`. Re-exported para backwards compat.
export {
  generateActionPlan,
  generatePersonalizedSafetyPlan,
  generateTrainingRecommendations,
  generateSafetyCapsule,
  generateCompensatoryExercises,
} from './gemini/personPlans';

// §12.5.1 split step 12 (2026-05-28): operations bundle moved to
// `services/gemini/operations.ts`. Audit + Documents + Incidents.
// Re-exported para backwards compat.
export {
  generateISOAuditChecklist,
  processDocumentToNodes,
  auditAISuggestion,
  analyzeDocumentCompliance,
  investigateIncidentWithAI,
  auditProjectComplianceWithAI,
  analyzeAttendancePatterns,
} from './gemini/operations';
export { suggestRisksWithAI, suggestNormativesWithAI } from './gemini/suggestions';






export const generateRealisticIoTEvent = async (context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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


export const simulateRiskPropagation = async (nodeTitle: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Simula la propagación de un riesgo en una red de seguridad industrial.
    
    Nodo de origen (riesgo inicial): "${nodeTitle}"
    
    Contexto de la red (nodos existentes):
    ${context}
    
    Proporciona:
    1. Una lista de títulos de nodos que probablemente se verían afectados por este riesgo (efecto dominó).
    2. Una breve descripción del impacto esperado en la red.
    3. El nivel de severidad general de la propagación (Alta, Media, Baja).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          affectedNodes: { type: Type.ARRAY, items: { type: Type.STRING } },
          impactDescription: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ["Alta", "Media", "Baja"] }
        },
        required: ["affectedNodes", "impactDescription", "severity"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const enrichNodeData = async (nodeData: Partial<RiskNode>): Promise<Partial<RiskNode>> => {
  if (!API_KEY) return nodeData;

  // Round 16 (R1) doctrine + R18 R6 MEDIUM #2 — Same doctrine applies here:
  // `criticidad` is intentionally OMITTED from prompt + schema even when
  // enriching a Riesgo node. Risk-level classification is a legal output of
  // the deterministic IPER P×S matrix (`calculateIper()`); Ley 16.744 / DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)
  // attach liability to that figure. This helper only enriches descriptive
  // fields (title, description). The prevencionista must classify via IPER.
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Eres un experto en prevención de riesgos laborales (SST) en Chile.
  Se ha detectado un registro incompleto en el sistema de gestión de riesgos.
  Tu tarea es completar la información faltante con datos técnicos, verídicos y precisos, basados en normativas y estándares de seguridad industrial. No uses texto de relleno ni simules datos, proporciona información real y aplicable.

  Datos actuales del registro:
  Título: ${nodeData.title || 'Faltante'}
  Descripción: ${nodeData.description || 'Faltante'}
  Tipo: ${nodeData.type || 'Desconocido'}
  Tags: ${nodeData.tags?.join(', ') || 'Ninguno'}

  Devuelve un JSON con los campos 'title' y 'description' completados profesionalmente.

  IMPORTANTE: NO devuelvas criticidad — la clasificación legal viene de IPER P×S deterministic en \`calculateIper()\`, operada por el prevencionista. Tu rol se limita a enriquecer título y descripción.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Título técnico y preciso" },
            description: { type: Type.STRING, description: "Descripción detallada, técnica y verídica del elemento" }
          },
          required: ["title", "description"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');

    return {
      ...nodeData,
      title: result.title || nodeData.title,
      description: result.description || nodeData.description,
      metadata: {
        ...nodeData.metadata
      }
    };
  } catch (error) {
    logger.error("Error enriching node data:", error);
    return nodeData;
  }
};




















// §12.5.1 step 5: analyzeBioImage moved to gemini/vision.ts (re-export at top).

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
    model: "gemini-3-flash-preview",
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

  return JSON.parse(response.text || '{}');
};

export const generateOperationalTasks = async (normativeTitle: string, normativeDescription: string): Promise<string[]> => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `
    Eres un experto en Prevención de Riesgos y Compliance Normativo en Chile.
    Tu tarea es traducir la siguiente normativa legal en una lista de tareas operativas claras y accionables para los trabajadores y supervisores en terreno.

    Normativa: ${normativeTitle}
    Descripción: ${normativeDescription}

    Genera una lista de 5 a 7 tareas operativas específicas, escritas en lenguaje claro y directo.
    Cada tarea debe ser una acción concreta que se pueda verificar (ej. "Revisar que el arnés tenga su certificación al día antes de cada uso").
    
    Devuelve ÚNICAMENTE un array de strings en formato JSON.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.STRING
        }
      }
    }
  });

  return JSON.parse(response.text || '[]');
};


export const forecastSafetyEvents = async (nodesContext: string, historicalData?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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

export const analyzeRiskNetwork = async (nodesContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza la red neuronal de conocimiento de Praeventio Guard.
    
    NODOS ACTUALES:
    ${nodesContext}
    
    Identifica patrones ocultos, riesgos sistémicos y proporciona recomendaciones estratégicas basadas en la interconexión de estos datos.
    Actúa como "El Guardián", una IA experta en prevención de riesgos.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: { type: Type.STRING, description: "Análisis profundo de la red." },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Recomendaciones estratégicas." }
        },
        required: ["analysis", "recommendations"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const predictAccidents = async (nodesContext: string, telemetryContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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
    model: "gemini-3-flash-preview",
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

  return JSON.parse(response.text || '{}');
};

export const generateTrainingQuiz = async (topic: string, description: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera un quiz de 3 preguntas de selección múltiple sobre el siguiente tema de capacitación:
    TEMA: ${topic}
    DESCRIPCIÓN: ${description}
    
    Cada pregunta debe tener 4 opciones y solo una correcta. 
    El tono debe ser educativo y enfocado en la prevención de riesgos.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctIndex: { type: Type.NUMBER, description: "Índice de la opción correcta (0-3)" },
            explanation: { type: Type.STRING, description: "Breve explicación de por qué es la correcta" }
          },
          required: ["question", "options", "correctIndex", "explanation"]
        }
      }
    }
  });

  return parseGeminiJson(response);
};

export const validateRiskImageClick = async (imageBase64: string, x: number, y: number, width: number, height: number, gameContext: string = '') => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  // Clean up base64 prefix if present
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Data,
            mimeType: "image/jpeg"
          }
        },
        {
          text: `
            Contexto del juego: ${gameContext}
            El usuario ha hecho clic en la imagen en las coordenadas relativas X: ${(x / width * 100).toFixed(2)}%, Y: ${(y / height * 100).toFixed(2)}%.
            Analiza la imagen en esa ubicación específica y determina si el usuario ha encontrado lo que se le pide en el contexto del juego.
            
            Devuelve el resultado en formato JSON con la siguiente estructura:
            {
              "isRisk": boolean, // true si el usuario acertó (encontró el riesgo/objetivo), false si no
              "foundObject": "Nombre del objeto encontrado (ej. 'Guardián Praeventio', 'Extintor'). Vacío si no encontró nada.",
              "riskDescription": "Descripción breve de lo que encontró (si isRisk es true)",
              "explanation": "Explicación de por qué acertó o falló."
            }
          `
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isRisk: { type: Type.BOOLEAN },
          foundObject: { type: Type.STRING },
          riskDescription: { type: Type.STRING },
          explanation: { type: Type.STRING }
        },
        required: ["isRisk", "foundObject", "riskDescription", "explanation"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const calculateDynamicEvacuationRoute = async (activeEmergencies: any[], workers: any[], machinery: any[], userBlockedAreas: string[] = []) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  // 1. Deterministic Calculation using our routing utility
  // Getting start point from the first worker or a default location
  const startPoint = workers.length > 0 && workers[0].position 
    ? { lat: workers[0].position[0], lng: workers[0].position[1] } 
    : { lat: -33.4489, lng: -70.6693 }; // Default Santiago
  
  // A known safe zone (Optimal meeting point)
  const destination = { lat: -33.4500, lng: -70.6700 };

  // Convert emergencies to hazard zones for the deterministic algorithm
  const hazards = activeEmergencies.map(e => ({
    center: e.location ? { lat: e.location.lat, lng: e.location.lng } : { lat: -33.4490, lng: -70.6690 },
    radius: e.severity === 'Crítica' ? 100 : 50 // Dynamic radius based on severity
  }));

  // Calculate safe route using a deterministic algorithm that avoids hazards
  const safeRoutePoints = calculateDeterministicSafeRoute(startPoint, destination, hazards);

  // 2. Use Gemini to translate the deterministic route into human instructions
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Actúa como un experto en logística de emergencias y evacuación industrial de Praeventio Guard. 
    Se ha calculado matemáticamente una ruta de evacuación segura que evita zonas de peligro. Tu tarea es traducir esta ruta en instrucciones claras, calmadas y precisas para el personal.
    
    DATOS DE LA RUTA CALCULADA:
    - Punto de Inicio: [${startPoint.lat}, ${startPoint.lng}]
    - Punto de Encuentro Óptimo: [${destination.lat}, ${destination.lng}]
    - Puntos intermedios seguros: ${safeRoutePoints.length} puntos calculados que evitan obstáculos.
    
    CONTEXTO DE LA EMERGENCIA:
    ${activeEmergencies.map(e => `- ${e.title}: ${e.description} (Severidad: ${e.severity})`).join('\n')}
    
    ESTADO DEL PERSONAL Y ACTIVOS:
    - Cantidad de Trabajadores: ${workers.length}
    - Maquinaria en Movimiento: ${machinery.length}
    ${workers.filter(w => w.isFallen).length > 0 ? `- ALERTA: Hay trabajadores caídos que requieren asistencia.` : ''}
    
    ÁREAS BLOQUEADAS POR SISTEMA O USUARIO:
    ${userBlockedAreas.length > 0 ? userBlockedAreas.join(', ') : 'Ninguna'}
    
    Instrucciones específicas:
    1. Proporciona un nombre descriptivo para la ruta.
    2. Identifica rutas alternativas si las principales están bloqueadas.
    3. Calcula el tiempo estimado (velocidad real: 1.2 m/s).
    4. Define el nivel de alerta (Verde, Amarillo, Rojo).
    5. Brinda los pasos de evacuación en orden cronológico.`,
    config: {
      responseMimeType: "application/json",
      temperature: 0.1,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          rutaSegura: { type: Type.STRING },
          rutasBloqueadas: { type: Type.ARRAY, items: { type: Type.STRING } },
          tiempoEstimado: { type: Type.STRING },
          nivelAlerta: { type: Type.STRING, enum: ["Rojo", "Amarillo", "Verde"] },
          instrucciones: { type: Type.ARRAY, items: { type: Type.STRING } },
          puntoEncuentroNombre: { type: Type.STRING },
          startPoint: {
            type: Type.OBJECT,
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER }
            },
            required: ["lat", "lng"]
          },
          endPoint: {
            type: Type.OBJECT,
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER }
            },
            required: ["lat", "lng"]
          }
        },
        required: ["rutaSegura", "rutasBloqueadas", "tiempoEstimado", "nivelAlerta", "instrucciones", "puntoEncuentroNombre", "startPoint", "endPoint"]
      }
    }
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return {
      ...result,
      routePoints: safeRoutePoints // Return the deterministically calculated points
    };
  } catch (e) {
    logger.error("Error parsing Gemini response for evacuation route:", e);
    return {
      rutaSegura: "Ruta de Evacuación Predeterminada",
      rutasBloqueadas: userBlockedAreas,
      tiempoEstimado: "5 minutos",
      nivelAlerta: "Rojo",
      instrucciones: ["Diríjase a la zona de seguridad más cercana."],
      puntoEncuentroNombre: "Zona de Seguridad",
      startPoint,
      endPoint: destination,
      routePoints: safeRoutePoints
    };
  }
};

export const processAudioWithAI = async (base64Audio: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const reportIncidentDeclaration: FunctionDeclaration = {
    name: "reportIncident",
    description: "Reporta un nuevo incidente, hallazgo o riesgo de seguridad en la faena.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Título breve del incidente" },
        description: { type: Type.STRING, description: "Descripción detallada de lo ocurrido" },
        severity: { type: Type.STRING, description: "Severidad: 'Baja', 'Media', 'Alta', 'Crítica'" },
        category: { type: Type.STRING, description: "Categoría: 'Seguridad', 'Salud Ocupacional', 'Medio Ambiente', 'Infraestructura'" }
      },
      required: ["title", "description", "severity", "category"]
    }
  };

  // 1. Transcribe and get AI response
  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "audio/webm",
              data: base64Audio,
            },
          },
          { text: "Eres el Guardián de Praeventio, un asistente experto en seguridad y salud ocupacional. Responde de forma concisa y profesional en español. Si el usuario quiere reportar un incidente, usa la herramienta reportIncident. Si pregunta algo sobre seguridad, dale una recomendación basada en normativas chilenas." },
        ],
      },
    ],
    config: {
      tools: [{ functionDeclarations: [reportIncidentDeclaration] }],
    }
  });

  let aiText = result.text || "";
  let functionCall: Record<string, unknown> | null = null;

  if (result.functionCalls && result.functionCalls.length > 0) {
    const call = result.functionCalls[0];
    if (call && call.name === "reportIncident" && call.args) {
      functionCall = call.args;
      aiText = `He registrado el incidente: ${call.args.title}. Se ha clasificado con severidad ${call.args.severity}. ¿Necesitas reportar algo más o requieres asistencia inmediata?`;
    }
  }

  if (!aiText) {
    aiText = "No pude entender el audio o procesar la solicitud.";
  }

  // 2. Generate Speech
  const ttsResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: aiText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64AudioResponse = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  return {
    text: aiText,
    audioBase64: base64AudioResponse,
    functionCall: functionCall
  };
};

export const analyzeVisionImage = async (base64Image: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          { text: "Analiza esta imagen de un entorno laboral. Identifica: 1. EPP detectado (casco, guantes, etc.). 2. Riesgos potenciales (caídas, cables, falta de orden). 3. Recomendaciones de seguridad. Responde en formato JSON con los campos: eppDetected (array), risksDetected (array), recommendations (array), summary (string)." },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          eppDetected: { type: Type.ARRAY, items: { type: Type.STRING } },
          risksDetected: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING }
        },
        required: ["eppDetected", "risksDetected", "recommendations", "summary"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const verifyEPPWithAI = async (base64Image: string, workerName: string, requiredEPP: string[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Analiza esta imagen de un trabajador (${workerName}). 
  EPP Requerido: ${requiredEPP.join(', ')}.
  Verifica si el trabajador está usando TODO el EPP requerido.
  Responde en formato JSON con los campos:
  isCompliant (boolean),
  detectedEPP (array de strings),
  missingEPP (array de strings),
  recommendations (array de strings),
  confidence (number entre 0 y 1).`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isCompliant: { type: Type.BOOLEAN },
          detectedEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          missingEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.NUMBER }
        },
        required: ["isCompliant", "detectedEPP", "missingEPP", "recommendations", "confidence"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const analyzeRiskNetworkHealth = async (nodes: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const nodesContext = nodes.map(n => `- [${n.type}] ID: ${n.id}, Título: ${n.title}, Descripción: ${n.description}`).join('\n');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza la salud de la red de conocimiento (Red Neuronal) de seguridad.
    Identifica:
    1. "Sinapsis Faltantes": Conexiones lógicas que deberían existir entre nodos (ej: un Riesgo y una Normativa, o un Trabajador y un EPP).
    2. "Brechas de Conocimiento": Temas críticos que no tienen suficientes nodos.
    3. "Nodos Aislados": Nodos importantes sin conexiones.
    
    RED ACTUAL:
    ${nodesContext}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          healthScore: { type: Type.NUMBER, description: "Puntaje de salud de la red (0-100)" },
          missingSynapses: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sourceId: { type: Type.STRING },
                targetId: { type: Type.STRING },
                reason: { type: Type.STRING },
                sourceTitle: { type: Type.STRING },
                targetTitle: { type: Type.STRING }
              },
              required: ["sourceId", "targetId", "reason", "sourceTitle", "targetTitle"]
            }
          },
          knowledgeGaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ["Alta", "Media", "Baja"] },
                suggestion: { type: Type.STRING }
              },
              required: ["topic", "priority", "suggestion"]
            }
          }
        },
        required: ["healthScore", "missingSynapses", "knowledgeGaps"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const analyzeFeedPostForRiskNetwork = async (content: string, imageBase64: string | null, userName: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  // Round 16 (R1) doctrine — SafetyFeed posts are pure triage signals. The
  // LLM does NOT classify criticidad here; the prevencionista will run the
  // deterministic IPER P×S matrix (`calculateIper()`) once the node lands
  // in the network. Ley 16.744 / DS 44/2024 / DS 54 attach legal liability to
  // the deterministic classification, so we strip `criticidad` from both
  // the prompt and the JSON schema to prevent Gemini's structured-output
  // mode from injecting an AI guess that auditors could mistake for it.
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const feedPostPrompt = `Analiza esta publicación del muro de seguridad hecha por ${userName}.
  Contenido: "${content}"

  Determina si esta publicación representa un RIESGO (Risk) o un INCIDENTE (Incident) que deba ser registrado en la Red Neuronal.
  Si es solo un comentario general, tip o felicitación, isRelevant debe ser false.
  Si es un riesgo o incidente, isRelevant debe ser true, y debes extraer un título, descripción y etiquetas (tags).

  IMPORTANTE: NO devuelvas criticidad — la clasificación legal viene de IPER P×S deterministic en \`calculateIper()\`, operada por el prevencionista. Tu rol aquí es sólo triage: detectar si el post pertenece a la Red Neuronal.`;
  const parts: any[] = [{ text: redactPromptForVertex(feedPostPrompt, 'analyzeFeedPostForRiskNetwork') }];

  if (imageBase64) {
    parts.push({
      inlineData: {
        data: imageBase64.replace(/^data:image\/\w+;base64,/, ""),
        mimeType: imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isRelevant: { type: Type.BOOLEAN, description: "True si es un riesgo o incidente que debe ir a la Red Neuronal" },
          type: { type: Type.STRING, description: "RISK o INCIDENT" },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["isRelevant"]
      }
    }
  });

  if (!response.text) {
    throw new Error('gemini_empty_response');
  }
  return JSON.parse(response.text.trim());
};

// Removed analyzePsychosocialRisks to move it to specialized psychosocialBackend.ts

export const calculateStructuralLoad = async (element: string, specs: string) => {
  try {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = `
      Actúa como un Ingeniero Estructural Senior y Experto en Prevención de Riesgos.
      Necesito calcular la capacidad de carga y entender el funcionamiento seguro del siguiente elemento:
      Elemento: ${element}
      Especificaciones: ${specs}

      Por favor, proporciona un análisis detallado que incluya:
      1. **Carga Segura de Trabajo (SWL - Safe Working Load) o Capacidad Portante**: Estimación basada en estándares de la industria.
      2. **Carga de Ruptura (Breaking Strength)**: Estimación teórica.
      3. **Factor de Seguridad**: El factor recomendado para este tipo de elemento y por qué.
      4. **Normativa Aplicable**: Menciona normativas chilenas (NCh) o internacionales (ASTM, ASME, OSHA) relevantes.
      5. **Recomendaciones Críticas de Uso**: Qué inspeccionar antes de usar y qué evitar para prevenir fallas catastróficas.

      Responde en formato Markdown, estructurado, claro y profesional. Usa fórmulas si es necesario (en formato LaTeX, ej. $F = m \times a$).
      ADVERTENCIA: Incluye un descargo de responsabilidad indicando que estos cálculos son teóricos y referenciales, y que siempre deben ser validados por un ingeniero calculista certificado en terreno.
    `;

    const result = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt
    });
    return result.text || 'No se pudo generar el cálculo.';
  } catch (error) {
    logger.error('Error calculating structural load:', error);
    return 'Error al calcular la capacidad estructural. Por favor, intente nuevamente.';
  }
};

export const designHazmatStorage = async (storageType: string, volume: number, materialClass: string) => {
  try {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = `
      Actúa como un Experto en Normativa Chilena (OGUC - Ordenanza General de Urbanismo y Construcciones) y DS 43 (Reglamento de Almacenamiento de Sustancias Peligrosas).
      Necesito diseñar una bodega o instalación con las siguientes características:
      Tipo de Almacenamiento: ${storageType}
      Volumen/Cantidad Estimada: ${volume} (toneladas/litros)
      Clase de Sustancia (NCh382): ${materialClass}

      Proporciona un informe técnico detallado para la construcción y habilitación que incluya:
      1. **Clasificación de la Instalación**: Según OGUC y DS 43.
      2. **Requisitos Constructivos (OGUC)**: Resistencia al fuego (RF) exigida para muros, techos y puertas.
      3. **Distancias de Seguridad**: Distancias a muros medianeros, otras bodegas y zonas de público.
      4. **Sistemas de Contención**: Requisitos para derrames (volumen de contención, pendientes).
      5. **Ventilación y Sistemas Eléctricos**: Requisitos de renovación de aire y equipos a prueba de explosión (si aplica).
      6. **Sistemas contra Incendios**: Extintores, red húmeda, detectores automáticos.
      7. **Trámites y Permisos**: Qué permisos sectoriales se requieren (Seremi de Salud, Dirección de Obras Municipales).

      Responde en formato Markdown, estructurado y profesional.
    `;

    const result = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt
    });
    return result.text || 'No se pudo generar el diseño.';
  } catch (error) {
    logger.error('Error designing hazmat storage:', error);
    return 'Error al generar el diseño de la instalación. Por favor, intente nuevamente.';
  }
};

export const evaluateMinsalCompliance = async (protocolTitle: string, context: string, industry?: string) => {
  try {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    // Get relevant legal context using RAG
    const legalContext = await searchRelevantContext(`Exigencias y sanciones del protocolo MINSAL: ${protocolTitle} en la industria ${industry || 'general'}`);

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = `
      Actúa como un Auditor Senior del Ministerio de Salud de Chile (MINSAL) y experto en la Ley 16.744, utilizando siempre como base la Biblioteca del Congreso Nacional de Chile (BCN).
      Necesito evaluar el nivel de cumplimiento del siguiente protocolo en mi proyecto:
      Protocolo: ${protocolTitle}
      Industria: ${industry || 'General'}
      Contexto Actual del Proyecto (Hallazgos, Riesgos, Incidentes):
      ${context || 'Sin datos específicos registrados aún.'}

      CONTEXTO LEGAL Y REQUISITOS (RAG):
      ${legalContext}

      Por favor, genera un informe de auditoría estructurado que incluya:
      1. **Estado de Cumplimiento Estimado**: (Cumple, En Riesgo, No Cumple) basado en el contexto.
      2. **Brechas Identificadas**: Qué falta según las exigencias del protocolo (ej. evaluaciones ambientales, vigilancia médica, capacitación).
      3. **Plan de Acción Inmediato**: Pasos operativos claros para cerrar las brechas.
      4. **Multas o Sanciones Potenciales**: Qué riesgos legales enfrenta la empresa si no regulariza la situación (referencia a la ley y multas del Código Sanitario).

      Responde en formato Markdown, estructurado, claro y profesional.
    `;

    const result = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt
    });
    return result.text || 'No se pudo generar la evaluación.';
  } catch (error) {
    logger.error('Error evaluating MINSAL compliance:', error);
    return 'Error al evaluar el cumplimiento del protocolo. Por favor, intente nuevamente.';
  }
};

export const generateModuleRecommendations = async (moduleName: string, industry: string, networkContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard, experto en prevención de riesgos y normativas chilenas de la Biblioteca del Congreso Nacional (BCN) (DS 594, Ley 16.744, etc.).
Actúa como un asistente profesional dedicado.
El usuario está viendo el módulo: "${moduleName}".
La industria del proyecto actual es: "${industry}".
Contexto de la red neuronal (Red Neuronal):
${networkContext}

Basado en este contexto real y en estándares ISO aplicables (ej. ISO 45001), proporciona:
1. Una explicación de cómo este módulo se relaciona específicamente con la industria "${industry}".
2. 3 recomendaciones accionables y preventivas basadas en el contexto de la Red Neuronal proporcionado.
3. Una alerta predictiva o insight crítico si detectas algún patrón de riesgo.

Devuelve la respuesta en formato JSON con la siguiente estructura:
{
  "industryRelation": "Explicación detallada de la relación del módulo con la industria...",
  "isoReference": "Norma ISO aplicable (ej. ISO 45001:2018) y breve justificación",
  "recommendations": [
    { "title": "Título de la recomendación", "description": "Descripción detallada y accionable" }
  ],
  "predictiveAlert": "Insight crítico o alerta predictiva basada en los datos"
}`;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });
    return JSON.parse(result.text || '{}');
  } catch (error) {
    logger.error("Error generating module recommendations:", error);
    return null;
  }
};

export const generateExecutiveSummary = async (stats: any, nodes: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const prompt = `Eres el Director de Inteligencia Artificial de Prevención de Riesgos.
  Genera un Resumen Ejecutivo Gerencial basado en los siguientes KPIs y datos de la Red Neuronal.
  
  KPIs Actuales:
  ${JSON.stringify(stats, null, 2)}
  
  Resumen de Nodos Recientes (Muestra):
  ${JSON.stringify(nodes.slice(0, 20).map(n => ({ tipo: n.type, titulo: n.title, estado: n.metadata?.status || n.metadata?.level })), null, 2)}
  
  Tu tarea es redactar un informe ejecutivo de 3 a 4 párrafos que:
  1. Analice la situación actual de seguridad (Índices de frecuencia, gravedad, cumplimiento).
  2. Destaque los riesgos críticos o hallazgos más relevantes.
  3. Proporcione recomendaciones estratégicas para la gerencia.
  
  El tono debe ser formal, analítico y orientado a la toma de decisiones ejecutivas.
  
  Responde ÚNICAMENTE con un JSON que contenga:
  - titulo: Título del informe
  - resumen: El texto del resumen ejecutivo (puede contener saltos de línea)
  - nivelAlertaGlobal: "Normal", "Precaución", "Crítico"
  - recomendacionesClave: Array de 3 a 5 strings con acciones concretas.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          titulo: { type: Type.STRING },
          resumen: { type: Type.STRING },
          nivelAlertaGlobal: { type: Type.STRING, enum: ["Normal", "Precaución", "Crítico"] },
          recomendacionesClave: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["titulo", "resumen", "nivelAlertaGlobal", "recomendacionesClave"]
      }
    }
  });

  if (!response.text) {
    throw new Error('gemini_empty_response');
  }
  return JSON.parse(response.text.trim());
};

export async function analyzeFaenaRiskWithAI(industry: string, context: string, envContext: string) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  
  // Get relevant legal context using RAG
  const legalContext = await searchRelevantContext(`Riesgos críticos en la industria ${industry} y su normativa aplicable en Chile`);
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  try {
    const prompt = `
      Actúa como un experto senior en Prevención de Riesgos (SSOMA) en Chile.
      Analiza los siguientes datos de una faena y genera una lista de los 5 riesgos más críticos y comunes que deberían incluirse en la matriz IPER base.
      
      DATOS DE LA FAENA:
      - Industria: ${industry}
      - Contexto Operacional: ${context}
      - Condiciones Ambientales/Entorno: ${envContext}
      
      CONTEXTO LEGAL RELEVANTE (RAG):
      ${legalContext}
      
      Para cada riesgo, proporciona:
      1. Nombre del Riesgo (ej. Caída a distinto nivel)
      2. Probabilidad (Baja, Media, Alta)
      3. Consecuencia (Ligeramente Dañino, Dañino, Extremadamente Dañino)
      4. Medidas de Control Sugeridas (Ingeniería, Administrativas, EPP)
      5. Fundamento Legal (Cita artículos específicos del DS 594, Ley 16.744, etc., basados en el contexto legal proporcionado)
      
      Formatea la respuesta en Markdown claro, estructurado y profesional.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-preview',
      contents: prompt,
    });

    return response.text || 'No se pudo generar el análisis de riesgos de faena.';
  } catch (error) {
    logger.error('Error in analyzeFaenaRiskWithAI:', error);
    throw error;
  }
}

export async function extractAcademicSummary(text: string) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  try {
    const prompt = `
      Actúa como un experto en Prevención de Riesgos (SSOMA) e investigador científico.
      Analiza el siguiente texto extraído de un paper académico o artículo científico y extrae el conocimiento clave aplicable a la industria.
      
      Texto Fuente:
      "${text}"
      
      Por favor, estructura tu respuesta en Markdown con las siguientes secciones:
      
      ### 📝 Resumen Ejecutivo
      (Un párrafo conciso con el hallazgo principal)
      
      ### 🎯 Puntos Clave Aplicables
      (Lista de viñetas con los datos más relevantes para la prevención)
      
      ### 🛡️ Sugerencias de Control
      (Cómo aplicar este conocimiento en controles de ingeniería, administrativos o EPP)
      
      ### 🔗 Relación IPER
      (A qué tipos de riesgos típicos afecta este descubrimiento)
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-preview',
      contents: redactPromptForVertex(prompt, 'extractAcademicSummary'),
    });

    return response.text || 'No se pudo generar el resumen académico.';
  } catch (error) {
    logger.error('Error in extractAcademicSummary:', error);
    throw error;
  }
}

export const calculateComplianceSummary = async (projectId: string, nodes: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // Filter nodes for the project
  const projectNodes = nodes.filter(n => n.projectId === projectId);
  
  const summaryContext = projectNodes.map(n => ({
    type: n.type,
    title: n.title,
    status: n.metadata?.status || n.metadata?.estado || "pending"
  }));

  const prompt = `
    Analiza el estado de cumplimiento de seguridad para el proyecto ${projectId}.
    Desglose:
    ${JSON.stringify(summaryContext)}

    Proporciona un puntaje global (0-100), desglose por categorías y 3 acciones críticas.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          globalScore: { type: Type.NUMBER },
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                score: { type: Type.NUMBER }
              },
              required: ["name", "score"]
            }
          },
          criticalActions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["globalScore", "categories", "criticalActions"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const processGlobalSafetyAudit = async (_projectId: string, projectData: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Auditoría Master de Seguridad - Proyecto: ${projectData.name}.
    Reportes: ${JSON.stringify(projectData.reports || [])}
    Controles: ${JSON.stringify(projectData.controls || [])}
    Nodos: ${JSON.stringify(projectData.nodesSummary || [])}

    Identifica brechas críticas y correlaciones de riesgo.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          auditTitle: { type: Type.STRING },
          keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
          riskCorrelations: { type: Type.ARRAY, items: { type: Type.STRING } },
          criticalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          healthIndex: { type: Type.NUMBER }
        },
        required: ["auditTitle", "keyFindings", "riskCorrelations", "criticalGaps", "recommendations", "healthIndex"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const scanLegalUpdates = async (normativeTitle: string, normativeText: string, modulesSummary: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const prompt = `
    Eres un experto en normativa de seguridad laboral chilena (DS 594, DS 44/2024, Ley 16.744, SUSESO).
    Se ha publicado o actualizado la siguiente norma: "${normativeTitle}".
    Extracto: ${normativeText.slice(0, 1500)}

    Módulos operativos actuales del sistema: ${modulesSummary.slice(0, 800)}

    Analiza si esta actualización normativa afecta alguno de los módulos. Responde en JSON.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          affected: { type: Type.BOOLEAN },
          impactLevel: { type: Type.STRING, enum: ["Crítico", "Alto", "Moderado", "Bajo", "Sin impacto"] },
          affectedModules: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          recommendedAction: { type: Type.STRING }
        },
        required: ["affected", "impactLevel", "affectedModules", "summary", "recommendedAction"]
      }
    }
  });

  return parseGeminiJson(response);
};

export const getNutritionSuggestion = async (mood: number, role: string = 'Trabajador', taskContext: string = '') => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const moodLabels: Record<number, string> = { 1: 'Agotado', 2: 'Cansado', 3: 'Normal', 4: 'Bien', 5: 'Óptimo' };
  const prompt = `
    Eres un nutricionista especializado en trabajadores de construcción/industria.
    Estado de ánimo del trabajador: ${moodLabels[mood] || 'Normal'} (${mood}/5).
    Rol: ${role}.
    ${taskContext ? `Tarea del día: ${taskContext}.` : ''}

    Sugiere un desayuno/hidratación breve (máx 2 líneas) adaptado a su estado físico y la exigencia del turno.
    Responde en JSON con los campos: suggestion (texto corto), hydration (consejo de hidratación), energy (nivel de energía esperado: "Alta" | "Media" | "Moderada").
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestion: { type: Type.STRING },
          hydration: { type: Type.STRING },
          energy: { type: Type.STRING, enum: ["Alta", "Media", "Moderada"] }
        },
        required: ["suggestion", "hydration", "energy"]
      }
    }
  });

  return parseGeminiJson(response);
};

export * from './susesoBackend.js';
export * from './eppBackend.js';
export * from './comiteBackend.js';
export * from './medicineBackend.js';
export * from './predictionBackend.js';
export * from './legalBackend.js';
// TODO.md §12.5.1 — 4 medical functions movidas a
// `./medicalAnalysisBackend.ts` (split god-file). Backwards-compat:
export * from './medicalAnalysisBackend.js';
export * from './chemicalBackend.js';
export * from './psychosocialBackend.js';
export * from './shiftBackend.js';
export * from './trainingBackend.js';
export * from './inventoryBackend.js';
export * from './networkBackend.js';
export * from './routingBackend.js';
export * from './ragService.js';
