// Praeventio Guard — §12.5.1 split step 14: Gemini Red Neuronal graph bundle.
//
// Extraído VERBATIM de `services/geminiBackend.ts` (movement-only, zero
// behavior change — precedente del split de billing). Decimocuarta
// extracción del split. Bundles 5 funciones sobre el grafo de conocimiento:
//
//   1. simulateRiskPropagation(nodeTitle, context) — efecto dominó de un
//      riesgo en la red (nodos afectados + severidad).
//   2. enrichNodeData(nodeData) — completa título/descripción de un nodo
//      incompleto. Degrada al nodo original si Gemini falla.
//   3. analyzeRiskNetwork(nodesContext) — patrones ocultos y riesgos
//      sistémicos de la red.
//   4. analyzeRiskNetworkHealth(nodes) — sinapsis faltantes, brechas de
//      conocimiento, nodos aislados.
//   5. analyzeFeedPostForRiskNetwork(content, imageBase64, userName) —
//      triage de posts del SafetyFeed hacia la Red Neuronal (con seam de
//      redacción PII Ley 21.719 antes de enviar el prompt).
//
// DOCTRINA Round 16 (R1): `criticidad` se OMITE deliberadamente de prompts
// y schemas en este módulo. La clasificación de nivel de riesgo es output
// legal de la matriz IPER P×S determinística (`calculateIper()`); Ley
// 16.744 / DS 44/2024 / DS 54 atan responsabilidad a esa cifra. El LLM solo
// enriquece campos descriptivos / hace triage — el prevencionista clasifica.

import { GoogleGenAI, Type } from '@google/genai';
import { RiskNode } from '../../types';
import { logger } from '../../utils/logger';
import { redactPromptForVertex } from './pii';
import { parseGeminiJson } from './parsing';
import { AI_MODEL_FAST } from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

export const simulateRiskPropagation = async (nodeTitle: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
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
      model: AI_MODEL_FAST,
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

    // Empty/garbled body = the model produced no enrichment. DATA IS MISSING →
    // parseGeminiJson throws (gemini_empty_response / SyntaxError) instead of
    // silently coercing to `{}` and emitting a half-populated node. The local
    // catch below degrades to the original nodeData (enrichment is optional).
    const result = parseGeminiJson<{ title?: string; description?: string }>(response);

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

export const analyzeRiskNetwork = async (nodesContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
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

export const analyzeRiskNetworkHealth = async (nodes: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const nodesContext = nodes.map(n => `- [${n.type}] ID: ${n.id}, Título: ${n.title}, Descripción: ${n.description}`).join('\n');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
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

  return parseGeminiJson(response);
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
    model: AI_MODEL_FAST,
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

  // Empty/garbled body = the model produced no usable result (this node may not
  // belong in the Red Neuronal). DATA IS MISSING → surface via parseGeminiJson:
  // throws gemini_empty_response / SyntaxError, which the /api/gemini dispatcher
  // maps to a typed 502 (see _geminiErrors.ts). No local fallback by design.
  return parseGeminiJson(response);
};
