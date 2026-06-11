import { GoogleGenAI, Type, Modality, FunctionDeclaration } from "@google/genai";
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
import { AI_MODEL_FAST, AI_MODEL_FAST_LONGFORM, AI_MODEL_FAST_STABLE, AI_MODEL_REASONING, AI_MODEL_TTS } from '../config/aiModels.js';

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

// §12.5.1 split step 13 (2026-06-11): predictive bundle moved VERBATIM to
// `services/gemini/predictions.ts`. Re-exported para backwards compat.
export {
  generateRealisticIoTEvent,
  generatePredictiveForecast,
  forecastSafetyEvents,
  predictAccidents,
  analyzeSiteMapDensity,
} from './gemini/predictions';

// §12.5.1 split step 14 (2026-06-11): Red Neuronal graph bundle moved
// VERBATIM to `services/gemini/riskNetwork.ts` (R1 criticidad doctrine
// documented there). Re-exported para backwards compat — networkBackend
// and the /api/gemini dispatcher keep importing from this barrel.
export {
  simulateRiskPropagation,
  enrichNodeData,
  analyzeRiskNetwork,
  analyzeRiskNetworkHealth,
  analyzeFeedPostForRiskNetwork,
} from './gemini/riskNetwork';

// §12.5.1 split step 15 (2026-06-11): normative-compliance bundle moved
// VERBATIM to `services/gemini/compliance.ts`. Re-exported para backwards
// compat — `safetyEngineBackend.ts` (calculateComplianceSummary,
// processGlobalSafetyAudit) y `src/server/routes/misc.ts` (scanLegalUpdates)
// siguen importando desde este barrel.
export {
  generateOperationalTasks,
  evaluateMinsalCompliance,
  calculateComplianceSummary,
  processGlobalSafetyAudit,
  scanLegalUpdates,
} from './gemini/compliance';

// §12.5.1 split step 16 (2026-06-11): engineering-advisory bundle moved
// VERBATIM to `services/gemini/engineering.ts`. Re-exported para
// backwards compat.
export { calculateStructuralLoad, designHazmatStorage } from './gemini/engineering';

// §12.5.1 step 5: analyzeBioImage moved to gemini/vision.ts (re-export at top).

export const generateTrainingQuiz = async (topic: string, description: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
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
    model: AI_MODEL_FAST,
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
    model: AI_MODEL_FAST,
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
    // Empty/garbled body = no AI narration was produced. DATA IS MISSING →
    // parseGeminiJson throws instead of spreading a `{}` that lacks every
    // required route field. The catch below degrades to the deterministic safe
    // route (calm fallback per the no-panic emergency directive), never blocks.
    const result = parseGeminiJson(response);
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
    model: AI_MODEL_FAST,
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
    model: AI_MODEL_TTS,
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
    model: AI_MODEL_FAST,
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

  return parseGeminiJson(response);
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
    model: AI_MODEL_FAST,
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

  return parseGeminiJson(response);
};

// Removed analyzePsychosocialRisks to move it to specialized psychosocialBackend.ts

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
      model: AI_MODEL_REASONING,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    });
    // Empty/garbled body = no recommendations were produced. DATA IS MISSING →
    // parseGeminiJson throws instead of returning a silent `{}`; the catch below
    // degrades to null (recommendations are optional, non-life-safety enrichment).
    return parseGeminiJson(result);
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
    model: AI_MODEL_FAST,
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

  // Empty/garbled body = no executive summary was produced. DATA IS MISSING →
  // surface via parseGeminiJson (throws gemini_empty_response / SyntaxError),
  // which the /api/gemini dispatcher maps to a typed 502. No local fallback.
  return parseGeminiJson(response);
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
      model: AI_MODEL_FAST_LONGFORM,
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
      model: AI_MODEL_FAST_LONGFORM,
      contents: redactPromptForVertex(prompt, 'extractAcademicSummary'),
    });

    return response.text || 'No se pudo generar el resumen académico.';
  } catch (error) {
    logger.error('Error in extractAcademicSummary:', error);
    throw error;
  }
}

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
    model: AI_MODEL_FAST_STABLE,
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
