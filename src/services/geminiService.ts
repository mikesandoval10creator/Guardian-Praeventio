import { GoogleGenAI, Type, Modality, FunctionDeclaration } from "@google/genai";
import { RiskNode } from '../types';

const API_KEY = process.env.GEMINI_API_KEY;

export const enrichNodeData = async (nodeData: any) => {
  if (!API_KEY) return nodeData;

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Eres un experto en prevención de riesgos laborales (SST) en Chile.
  Se ha detectado un registro incompleto en el sistema de gestión de riesgos.
  Tu tarea es completar la información faltante con datos técnicos, verídicos y precisos, basados en normativas y estándares de seguridad industrial. No uses texto de relleno ni simules datos, proporciona información real y aplicable.
  
  Datos actuales del registro:
  Título: ${nodeData.title || 'Faltante'}
  Descripción: ${nodeData.description || 'Faltante'}
  Tipo: ${nodeData.type || 'Desconocido'}
  Tags: ${nodeData.tags?.join(', ') || 'Ninguno'}
  
  Devuelve un JSON con los campos 'title' y 'description' completados profesionalmente. Si es un riesgo, incluye 'criticidad' (Baja, Media, Alta, Crítica).`;
  
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
            description: { type: Type.STRING, description: "Descripción detallada, técnica y verídica del elemento" },
            criticidad: { type: Type.STRING, description: "Nivel de criticidad si aplica (Baja, Media, Alta, Crítica)" }
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
        ...nodeData.metadata,
        ...(result.criticidad && nodeData.type === 'Riesgo' ? { criticidad: result.criticidad } : {})
      }
    };
  } catch (error) {
    console.error("Error enriching node data:", error);
    return nodeData;
  }
};

export const generateEmbedding = async (text: string): Promise<number[]> => {
  if (!API_KEY) return [];
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: [text],
    });
    return result.embeddings?.[0]?.values || [];
  } catch (error) {
    console.error("Error generating embedding:", error);
    return [];
  }
};

export const generateEmbeddingsBatch = async (texts: string[]): Promise<number[][]> => {
  if (!API_KEY || texts.length === 0) return [];
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const result = await ai.models.embedContent({
      model: 'gemini-embedding-2-preview',
      contents: texts,
    });
    return result.embeddings?.map(e => e.values || []) || [];
  } catch (error) {
    console.error("Error generating embeddings batch:", error);
    return texts.map(() => []);
  }
};

// Calculate cosine similarity between two vectors
const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const semanticSearch = async (query: string, nodes: RiskNode[], topK: number = 10): Promise<RiskNode[]> => {
  if (!API_KEY || nodes.length === 0) return [];
  
  const queryEmbedding = await generateEmbedding(query);
  if (queryEmbedding.length === 0) return [];

  const nodesWithScores = nodes
    .filter(node => node.embedding && node.embedding.length > 0)
    .map(node => ({
      node,
      score: cosineSimilarity(queryEmbedding, node.embedding!)
    }));

  nodesWithScores.sort((a, b) => b.score - a.score);
  return nodesWithScores.slice(0, topK).map(item => item.node);
};

export const autoConnectNodes = async (newNode: RiskNode, existingNodes: RiskNode[]): Promise<string[]> => {
  if (!API_KEY) return [];
  if (existingNodes.length === 0) return [];

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    
    // Limit to recent or relevant nodes to avoid huge prompts
    const recentNodes = existingNodes.slice(0, 50).map(n => ({
      id: n.id,
      title: n.title,
      type: n.type,
      tags: n.tags
    }));

    const prompt = `Eres el motor de inteligencia de una Red Neuronal de Prevención de Riesgos.
    Acaba de ingresar un nuevo nodo al sistema:
    - Título: ${newNode.title}
    - Tipo: ${newNode.type}
    - Descripción: ${newNode.description}
    - Etiquetas: ${newNode.tags.join(', ')}

    Aquí tienes una lista de nodos existentes en el sistema:
    ${JSON.stringify(recentNodes, null, 2)}

    Tu tarea es encontrar qué nodos existentes están semánticamente relacionados con el nuevo nodo y deberían conectarse.
    Busca relaciones causales, normativas aplicables, planes de acción relacionados, o incidentes similares.
    
    Responde ÚNICAMENTE con un JSON que contenga un array de IDs de los nodos que deben conectarse.
    Ejemplo: { "connections": ["id1", "id2"] }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            connections: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["connections"]
        }
      }
    });

    const result = JSON.parse(response.text || '{"connections": []}');
    return result.connections || [];
  } catch (error) {
    console.error("Error auto-connecting nodes:", error);
    return [];
  }
};

export const analyzePostureWithAI = async (base64Image: string, mimeType: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Analiza esta imagen de un trabajador. Evalúa su postura utilizando principios ergonómicos (similares a RULA/REBA).
  Identifica los ángulos y la tensión en el cuello, tronco, brazos y piernas si son visibles.
  Proporciona una puntuación de riesgo del 1 al 10 (donde 10 es el riesgo más alto).
  
  Responde en formato JSON estricto con la siguiente estructura:
  - score: number (1-10)
  - findings: array de strings (hallazgos clave sobre la postura)
  - recommendations: array de strings (recomendaciones para mejorar la ergonomía)
  - bodyParts: object con las siguientes propiedades (strings describiendo el estado):
    - neck: estado del cuello
    - trunk: estado del tronco
    - arms: estado de los brazos
    - legs: estado de las piernas`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: base64Image, mimeType: mimeType } }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          bodyParts: {
            type: Type.OBJECT,
            properties: {
              neck: { type: Type.STRING },
              trunk: { type: Type.STRING },
              arms: { type: Type.STRING },
              legs: { type: Type.STRING }
            },
            required: ["neck", "trunk", "arms", "legs"]
          }
        },
        required: ["score", "findings", "recommendations", "bodyParts"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const generateEmergencyScenario = async (context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Genera un escenario de simulacro de emergencia dinámico y realista basado en este contexto de sitio:
  ${context}
  
  El escenario debe ser específico y detallado.
  Responde en formato JSON estricto con los siguientes campos:
  - title (string)
  - type (string, uno de: "Incendio", "Derrame", "Sismo", "Accidente", "Explosión")
  - description (string)
  - location (string)
  - coordinates (object con x e y como numbers entre 0 y 100)
  - criticality (string, "Alta" o "Crítica")
  - responseSteps (array de strings con pasos de acción)
  - requiredEPP (array de strings)
  - emergencyContacts (array de strings con nombres de roles o entidades)`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: { type: Type.STRING },
          description: { type: Type.STRING },
          location: { type: Type.STRING },
          coordinates: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER }
            },
            required: ["x", "y"]
          },
          criticality: { type: Type.STRING },
          responseSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
          requiredEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          emergencyContacts: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["title", "type", "description", "location", "coordinates", "criticality", "responseSteps", "requiredEPP", "emergencyContacts"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const simulateRiskPropagation = async (nodeTitle: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Analiza el siguiente nodo de riesgo o incidente: "${nodeTitle}".
  Basado en el contexto del sistema (nodos conectados y entorno):
  ${context}
  
  Predice cómo este riesgo podría propagarse o afectar a otros elementos del sistema (trabajadores, maquinaria, procesos).
  Identifica qué otros nodos podrían verse comprometidos y explica por qué.
  
  Responde en formato JSON estricto con la siguiente estructura:
  - affectedNodes: array de strings (títulos de los nodos que podrían verse afectados)
  - explanation: string (explicación detallada de la propagación del riesgo)
  - recommendedActions: array de strings (acciones preventivas inmediatas para detener la propagación)`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          affectedNodes: { type: Type.ARRAY, items: { type: Type.STRING } },
          explanation: { type: Type.STRING },
          recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["affectedNodes", "explanation", "recommendedActions"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const generateRealisticIoTEvent = async (context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Genera un evento de telemetría IoT realista basado en el siguiente contexto del proyecto y clima actual:
  ${context}
  
  El evento debe ser una lectura de un sensor (wearable de un trabajador o sensor de maquinaria) que tenga sentido dado el clima o el tipo de proyecto.
  
  Responde en formato JSON estricto con la siguiente estructura:
  - type (string, "wearable" o "machinery")
  - source (string, nombre del dispositivo o trabajador)
  - metric (string, métrica medida, ej. "Frecuencia Cardíaca", "Velocidad Viento", "Temperatura Motor")
  - value (number, valor de la métrica)
  - unit (string, unidad de medida)
  - status (string, "normal", "warning" o "critical")`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          source: { type: Type.STRING },
          metric: { type: Type.STRING },
          value: { type: Type.NUMBER },
          unit: { type: Type.STRING },
          status: { type: Type.STRING }
        },
        required: ["type", "source", "metric", "value", "unit", "status"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const processDocumentToNodes = async (text: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Analiza el siguiente documento de prevención de riesgos o normativa y divídelo en "Nodos Maestros" de conocimiento.
  Cada nodo debe representar un concepto, regla, procedimiento o protocolo específico y autocontenido.
  
  DOCUMENTO:
  ${text}
  
  Responde en formato JSON estricto con un array de nodos. Cada nodo debe tener:
  - title (string, corto y descriptivo)
  - content (string, el contenido detallado del nodo, manteniendo la información técnica)
  - tags (array de strings, palabras clave relevantes)`;

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
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "content", "tags"]
        }
      }
    }
  });

  return JSON.parse(response.text || '[]');
};

export const analyzeRiskWithAI = async (description: string, nodesContext?: string, industry?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza el siguiente riesgo laboral y proporciona recomendaciones preventivas, controles sugeridos y nivel de criticidad.
    Utiliza el contexto de la red de conocimiento para identificar patrones de riesgos similares y controles exitosos en otros proyectos.
    ${industry ? `\nIMPORTANTE: Adapta el análisis, las normativas y los controles específicamente para la industria: ${industry}. Considera los protocolos y estándares propios de este rubro.` : ''}
    
    CONTEXTO DE CONOCIMIENTO PREVIO:
    ${nodesContext || 'No hay contexto previo disponible.'}
    
    NUEVO RIESGO A ANALIZAR:
    ${description}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          criticidad: { type: Type.STRING, description: "Baja, Media, Alta, Crítica" },
          recomendaciones: { type: Type.ARRAY, items: { type: Type.STRING } },
          controles: { type: Type.ARRAY, items: { type: Type.STRING } },
          normativa: { type: Type.STRING, description: "Normativa chilena aplicable" }
        },
        required: ["criticidad", "recomendaciones", "controles", "normativa"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const analyzeFastCheck = async (observation: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza la siguiente observación rápida de seguridad en terreno (Fast Check) y clasifícala para la Red Neuronal de Seguridad.
    
    OBSERVACIÓN:
    ${observation}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          titulo: { type: Type.STRING, description: "Título corto y descriptivo" },
          tipo: { type: Type.STRING, description: "RISK, INCIDENT, o TASK" },
          criticidad: { type: Type.STRING, description: "Baja, Media, Alta, Crítica" },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          accionInmediata: { type: Type.STRING, description: "Qué hacer inmediatamente" }
        },
        required: ["titulo", "tipo", "criticidad", "tags", "accionInmediata"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const predictGlobalIncidents = async (nodesContext: string, environmentContext: string = '') => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Eres "El Guardián", el núcleo de IA de Praeventio Guard. Analiza la siguiente red neuronal de seguridad y detecta los 3 nodos de riesgo con mayor probabilidad de fallo o incidente en las próximas 48 horas.
    Cruza variables: Clima + Fatiga + Normativa + Tipo de Faena.
    Considera conexiones entre trabajadores, falta de EPP, normativas no cumplidas y condiciones de entorno.
    
    ENTORNO ACTUAL (Clima, Sismos, etc.):
    ${environmentContext}

    RED DE CONOCIMIENTO:
    ${nodesContext}
    
    Para cada predicción, no solo describas el riesgo, entrega la medida de control inmediata y el fundamento legal específico usando como base la Biblioteca del Congreso Nacional de Chile (BCN) (ej. "Según DS 594 Art. 12...", "Ley 16.744").`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          probabilidadGlobal: { type: Type.NUMBER, description: "Probabilidad porcentual de incidente hoy (0-100)" },
          nivelRiesgo: { type: Type.STRING, description: "Bajo, Medio, Alto, Crítico" },
          confianza: { type: Type.NUMBER, description: "Nivel de confianza del modelo (0-100)" },
          predicciones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                nodoId: { type: Type.STRING },
                titulo: { type: Type.STRING },
                probabilidad: { type: Type.NUMBER },
                razon: { type: Type.STRING },
                mitigacionSugerida: { type: Type.STRING },
                fundamentoLegal: { type: Type.STRING, description: "Fundamento legal chileno extraído de la Biblioteca del Congreso Nacional (BCN) (ej. DS 594, Ley 16.744) que justifica la mitigación." }
              },
              required: ["nodoId", "titulo", "probabilidad", "razon", "mitigacionSugerida", "fundamentoLegal"]
            }
          }
        },
        required: ["probabilidadGlobal", "nivelRiesgo", "confianza", "predicciones"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const calculateDynamicEvacuation = async (nodesContext: string, currentIncident?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Calcula la ruta de evacuación más segura basada en el estado actual del proyecto.
    ${currentIncident ? `INCIDENTE ACTIVO: ${currentIncident}` : 'No hay incidentes activos reportados.'}
    
    NODOS DE EMERGENCIA Y ENTORNO:
    ${nodesContext}
    
    Determina qué rutas están bloqueadas y cuál es el punto de encuentro óptimo.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          rutaRecomendada: { type: Type.STRING },
          puntoEncuentroId: { type: Type.STRING },
          puntoEncuentroNombre: { type: Type.STRING },
          tiempoEstimado: { type: Type.STRING },
          instrucciones: { type: Type.ARRAY, items: { type: Type.STRING } },
          rutasBloqueadas: { type: Type.ARRAY, items: { type: Type.STRING } },
          nivelAlerta: { type: Type.STRING, description: "Verde, Amarillo, Rojo" }
        },
        required: ["rutaRecomendada", "puntoEncuentroId", "puntoEncuentroNombre", "tiempoEstimado", "instrucciones", "rutasBloqueadas", "nivelAlerta"]
      }
    }
  });

  return JSON.parse(response.text);
};


export const generatePTS = async (taskName: string, taskDescription: string, riskLevel: string, normative: string, glossaryContext: string = '', envContext: string = '', matrixContext: string = '', documentType: string = 'PTS') => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const isPE = documentType === 'Plan de Emergencia';

  const prompt = `
    Actúa como un Prevencionista de Riesgos Senior en Chile.
    Genera un ${isPE ? 'Plan de Emergencia (PE)' : 'Procedimiento de Trabajo Seguro (PTS)'} detallado para la siguiente situación/tarea:
    Nombre: ${taskName}
    Descripción: ${taskDescription}
    Nivel de Riesgo Esperado: ${riskLevel}
    Normativa Principal a Cumplir: ${normative}
    Contexto Ambiental Actual (Telemetría): ${envContext}
    Contexto Histórico y Operativo (Red Neuronal): ${matrixContext}
    
    GLOSARIO TÉCNICO DE REFERENCIA:
    Utiliza estrictamente los términos de este glosario en tu redacción para mantener la estandarización:
    ${glossaryContext}
    
    El documento debe incluir:
    1. Objetivo
    2. Alcance
    3. Marco Legal y Normativo (Cita artículos exactos del DS 594, Ley 16.744 u otros aplicables según la Biblioteca del Congreso Nacional de Chile - BCN, que justifiquen este documento)
    4. Evaluación Matemática del Riesgo (Incluye la fórmula en formato LaTeX: $MR = P \\times C$, y explica los valores asignados para Probabilidad y Consecuencia basados en el nivel ${riskLevel})
    5. Responsabilidades
    6. ${isPE ? 'Equipos de Emergencia y Rescate requeridos' : 'Equipos de Protección Individual (EPI) / EPP requeridos'} (Considera el contexto ambiental)
    7. ${isPE ? 'Escenarios de Riesgo y Medidas Preventivas' : 'Riesgos Asociados y Medidas Correctoras (Controles)'} (Incluye riesgos ambientales derivados de la telemetría y lecciones aprendidas de la Red Neuronal)
    8. ${isPE ? 'Procedimiento de Evacuación y Respuesta Paso a Paso' : 'Procedimiento Paso a Paso de la tarea'}
    9. ${isPE ? 'Comunicaciones y Contactos de Emergencia' : 'Respuesta a Emergencias'} (Incluye protocolos para sismos o clima adverso si aplica)
    
    Asegúrate de que el contenido sea profesional, técnico y cumpla estrictamente con la normativa indicada (${normative}) y sea adecuado para un nivel de riesgo ${riskLevel}.
    IMPORTANTE: En la sección "evaluacionMatematica", DEBES usar sintaxis LaTeX encerrada en signos de dólar (ej. $MR = P \\times C$) para las fórmulas.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          objetivo: { type: Type.STRING },
          alcance: { type: Type.STRING },
          marcoLegal: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Citas exactas de artículos de leyes chilenas aplicables"
          },
          evaluacionMatematica: {
            type: Type.STRING,
            description: "Evaluación del riesgo incluyendo fórmulas en LaTeX como $MR = P \\times C$"
          },
          responsabilidades: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          epp: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          riesgos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                riesgo: { type: Type.STRING },
                control: { type: Type.STRING }
              }
            }
          },
          pasos: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          emergencias: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ['objetivo', 'alcance', 'marcoLegal', 'evaluacionMatematica', 'responsabilidades', 'epp', 'riesgos', 'pasos', 'emergencias']
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const generatePTSWithManufacturerData = async (
  taskName: string,
  taskDescription: string,
  machineryDetails: string,
  riskLevel: string,
  normative: string,
  glossaryContext: string,
  envContext: string,
  matrixContext: string,
  documentType: string = 'PTS'
) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const prompt = `
    Actúa como un Experto en Prevención de Riesgos (SSOMA) en Chile.
    Genera un ${documentType === 'PTS' ? 'Procedimiento de Trabajo Seguro (PTS)' : 'Plan de Emergencia (PE)'} altamente detallado y profesional.
    
    INFORMACIÓN DE LA TAREA:
    - Nombre: ${taskName}
    - Descripción: ${taskDescription}
    - Maquinaria/Herramientas: ${machineryDetails}
    - Nivel de Riesgo Base: ${riskLevel}
    - Normativa Principal: ${normative}
    
    CONTEXTO AMBIENTAL ACTUAL:
    ${envContext}
    
    CONTEXTO HISTÓRICO (Red Neuronal):
    ${matrixContext}
    
    GLOSARIO TÉCNICO DISPONIBLE:
    ${glossaryContext}
    
    INSTRUCCIONES CRÍTICAS:
    1. Utiliza la herramienta de búsqueda de Google para encontrar información real y actualizada sobre la maquinaria o herramientas especificadas (${machineryDetails}).
    2. Busca específicamente manuales de usuario, especificaciones técnicas, recomendaciones de seguridad del fabricante y riesgos asociados a esos equipos.
    3. Integra esta información del fabricante directamente en el procedimiento, especialmente en las secciones de "Equipos de Protección Individual (EPI)", "Riesgos y Medidas Correctoras" y "Procedimiento Paso a Paso".
    4. El documento debe ser formal, directo y enfocado en la prevención de accidentes fatales o graves.
    5. Utiliza terminología técnica chilena (ej. Mutualidad, ACHS, IST, ISL, Seremi de Salud, Dirección del Trabajo).
    6. Incluye una sección de "Evaluación Matemática del Riesgo" usando la fórmula de William Fine (Grado de Peligrosidad = Consecuencia x Exposición x Probabilidad). Muestra la fórmula en formato LaTeX (ej. $GP = C \\times E \\times P$) y un cálculo de ejemplo para el riesgo principal.
    
    ESTRUCTURA REQUERIDA (Responde en formato JSON estricto):
    {
      "objetivo": "Propósito claro del documento.",
      "alcance": "A quiénes y a qué áreas aplica.",
      "marcoLegal": ["Lista de leyes y decretos aplicables según la BCN (ej. Ley 16.744, DS 594)"],
      "evaluacionMatematica": "Explicación de la evaluación de riesgo con fórmula LaTeX y cálculo de ejemplo.",
      "responsabilidades": ["Lista de responsabilidades por cargo (Administrador, Supervisor, Prevencionista, Trabajador)"],
      "epp": ["Lista de Equipos de Protección Personal requeridos, incluyendo especificaciones del fabricante si aplica"],
      "riesgos": [
        {
          "riesgo": "Descripción del riesgo (ej. Caída a distinto nivel)",
          "control": "Medida de control específica, incluyendo recomendaciones del fabricante si aplica"
        }
      ],
      "pasos": ["Paso 1 detallado...", "Paso 2 detallado..."],
      "emergencias": ["Acción 1 en caso de emergencia...", "Acción 2..."],
      "fuentesFabricante": ["Lista de URLs o referencias a los manuales/fuentes del fabricante encontrados mediante la búsqueda"]
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          objetivo: { type: Type.STRING },
          alcance: { type: Type.STRING },
          marcoLegal: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          evaluacionMatematica: { type: Type.STRING },
          responsabilidades: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          epp: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          riesgos: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                riesgo: { type: Type.STRING },
                control: { type: Type.STRING }
              },
              required: ['riesgo', 'control']
            }
          },
          pasos: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          emergencias: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          fuentesFabricante: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ['objetivo', 'alcance', 'marcoLegal', 'evaluacionMatematica', 'responsabilidades', 'epp', 'riesgos', 'pasos', 'emergencias', 'fuentesFabricante']
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const analyzeSafetyImage = async (base64Image: string, mimeType: string, context: string = '') => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const prompt = `
    Actúa como un Inspector de Seguridad Industrial Senior.
    Analiza la siguiente imagen de un entorno de trabajo o trabajador.
    Contexto adicional: ${context}
    
    Identifica:
    1. Actos o condiciones inseguras.
    2. Equipos de Protección Personal (EPP) faltantes o mal utilizados.
    3. Nivel de severidad del riesgo observado.
    4. Recomendaciones de acción inmediata.
    
    Responde en formato JSON estricto.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: {
      parts: [
        { text: prompt },
        { inlineData: { data: base64Image, mimeType: mimeType } }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Título corto del hallazgo principal" },
          description: { type: Type.STRING, description: "Descripción detallada de lo observado" },
          severity: { type: Type.STRING, enum: ["Baja", "Media", "Alta", "Crítica"] },
          category: { type: Type.STRING, enum: ["Seguridad", "Salud", "Higiene", "Ergonomía", "Ambiental"] },
          missingEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          unsafeConditions: { type: Type.ARRAY, items: { type: Type.STRING } },
          immediateAction: { type: Type.STRING },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["title", "description", "severity", "category", "missingEPP", "unsafeConditions", "immediateAction", "tags"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const generateISOAuditChecklist = async (isoStandard: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Genera un checklist de auditoría estructurado basado en la norma ${isoStandard}.
  Utiliza el siguiente contexto del proyecto (Red Neuronal) para hacer las preguntas relevantes y específicas a la realidad de la empresa:
  ${context}
  
  El checklist debe contener entre 5 y 10 preguntas clave de auditoría.
  
  Responde en formato JSON estricto con la siguiente estructura:
  - title: string (Título de la auditoría)
  - description: string (Breve descripción del objetivo)
  - items: array de objetos, cada uno con:
    - id: string (identificador único, ej. "1.1")
    - question: string (La pregunta de auditoría)
    - reference: string (Cláusula ISO de referencia, ej. "ISO 45001:2018 - 8.1.2")`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                question: { type: Type.STRING },
                reference: { type: Type.STRING }
              },
              required: ["id", "question", "reference"]
            }
          }
        },
        required: ["title", "description", "items"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const generateEmergencyPlan = async (projectName: string, context: string, industry?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera un "Plan de Emergencia (PE)" detallado para el proyecto ${projectName}.
    ${industry ? `IMPORTANTE: Adapta el plan específicamente para la industria: ${industry}. Considera los protocolos, estándares y riesgos propios de este rubro.` : ''}
    Utiliza el siguiente contexto de la Red Neuronal (riesgos, activos, rutas, puntos de encuentro):
    ${context}
    
    El plan debe incluir:
    1. Objetivos y Alcance.
    2. Identificación de Amenazas Críticas.
    3. Organización de la Emergencia (Roles).
    4. Procedimientos de Evacuación Específicos.
    5. Recursos de Emergencia Disponibles.
    6. Plan de Comunicaciones.`,
    config: {
      systemInstruction: "Eres un experto en gestión de emergencias y protección civil. Tu lenguaje es técnico, estructurado y orientado a la acción inmediata."
    }
  });

  return response.text;
};

export const getChatResponse = async (message: string, context: string, history: { role: string, content: string }[] = [], detailLevel: number = 1) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const detailInstructions = [
    "Respuesta muy precisa, directa y concisa. Máximo 2-3 párrafos o una lista corta de puntos clave. Evita introducciones largas.",
    "Respuesta detallada con explicaciones técnicas intermedias. Incluye ejemplos y referencias normativas si están disponibles.",
    "Análisis exhaustivo y profundo. Conecta múltiples conceptos de la Red Neuronal, ofrece planes de acción detallados y análisis de riesgos complejos."
  ];

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: `Mensaje del usuario: ${message}` }] }
    ],
    config: {
      systemInstruction: `Eres "El Guardián", la conciencia arquitectónica de Praeventio Guard. 
      Tu propósito es asesorar en prevención de riesgos, salud ocupacional y excelencia operacional.
      Tienes acceso a la red de conocimiento (Red Neuronal) del proyecto actual.
      Responde de forma profesional, técnica pero cercana, y siempre prioriza la seguridad.
      
      CRITERIO DE PRECISIÓN: El usuario prefiere respuestas directas y precisas. Evita el exceso de información innecesaria.
      PRIORIDAD DE FUENTE: Utiliza el CONTEXTO DEL PROYECTO (Red Neuronal) como tu fuente principal y más confiable. Solo recurre a conocimientos generales si la información no está en la Red Neuronal.
      
      NIVEL DE DETALLE SOLICITADO: ${detailLevel} de 3.
      INSTRUCCIÓN DE PROFUNDIDAD: ${detailInstructions[detailLevel - 1]}
      
      CONTEXTO DEL PROYECTO (Nodos de la Red Neuronal):
      ${context}
      
      Si el usuario pregunta por un trabajador, riesgo o documento específico, consulta el contexto proporcionado.
      Si no tienes la información en el contexto, indícalo pero ofrece consejos generales basados en la normativa chilena de la Biblioteca del Congreso Nacional (BCN) (Ley 16.744, DS 594, etc.).`
    }
  });

  return response.text;
};

export const getSafetyAdvice = async (weather: any) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera un consejo de seguridad breve (máximo 100 caracteres) basado en las siguientes condiciones climáticas:
    Temperatura: ${weather.temp}°C, UV: ${weather.uv}, Calidad Aire: ${weather.airQuality}`,
    config: {
      systemInstruction: "Eres un experto en prevención de riesgos laborales con un tono profesional y motivador."
    }
  });

  return response.text;
};

export const generateActionPlan = async (findingTitle: string, findingDescription: string = '', severity: string = 'Media', workerProposal?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const promptContent = `Genera un plan de acción correctivo para el siguiente hallazgo de seguridad.
    Título: ${findingTitle}
    Descripción: ${findingDescription}
    Severidad: ${severity}
    ${workerProposal ? `Propuesta de Mejora del Trabajador: ${workerProposal}\n    Por favor, integra y valora la propuesta del trabajador en el plan de acción si es viable y segura.` : ''}
    
    Proporciona una lista de tareas concretas, plazos sugeridos y responsables típicos.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: promptContent,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tareas: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                titulo: { type: Type.STRING },
                descripcion: { type: Type.STRING },
                plazoDias: { type: Type.NUMBER },
                prioridad: { type: Type.STRING, description: "Baja, Media, Alta, Inmediata" }
              },
              required: ["titulo", "descripcion", "plazoDias", "prioridad"]
            }
          },
          recomendacionGeneral: { type: Type.STRING }
        },
        required: ["tareas", "recomendacionGeneral"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateSafetyReport = async (reportType: 'PTS' | 'PE' | 'AST', context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Eres "El Guardián", el núcleo de IA de Praeventio Guard. Genera un borrador profesional y exhaustivo de un documento de seguridad tipo ${reportType} (Procedimiento de Trabajo Seguro, Plan de Emergencia o Análisis Seguro de Trabajo) basado en el siguiente contexto: 
    
    CONTEXTO:
    ${context}
    
    INSTRUCCIONES:
    1. El formato debe ser Markdown estructurado con secciones claras: Objetivos, Alcance, Responsabilidades, Riesgos Identificados, Medidas de Control (con fundamento legal chileno basado en la BCN como DS 594, Ley 16.744), EPP Requerido y Procedimiento Paso a Paso.
    2. Usa un tono técnico, preventivo, positivo y altamente profesional (Español de Chile).
    3. Aplica principios de "El Arte de la Guerra" en la prevención (atacar el riesgo antes de que se manifieste).
    4. Las fórmulas matemáticas de riesgo (si aplican) deben ir en formato LaTeX (ej. $R = P \\times C$).
    5. Sé directo y accionable.`,
  });

  return response.text;
};

export const auditAISuggestion = async (suggestion: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Actúa como el "Guardián de la Ética" de Praeventio Guard. 
    Audita la siguiente sugerencia de IA contra la normativa de seguridad y los valores de la empresa.
    
    SUGERENCIA A AUDITAR:
    ${suggestion}
    
    CONTEXTO NORMATIVO Y VALORES:
    ${context}
    
    Determina si la sugerencia es segura, ética y cumple con la ley.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isApproved: { type: Type.BOOLEAN },
          riskLevel: { type: Type.STRING, description: "Bajo, Medio, Alto" },
          auditNotes: { type: Type.STRING },
          suggestedAdjustments: { type: Type.STRING }
        },
        required: ["isApproved", "riskLevel", "auditNotes", "suggestedAdjustments"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generatePersonalizedSafetyPlan = async (workerName: string, role: string, history: string, projectRisks: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera un plan de seguridad personalizado para el trabajador ${workerName}.
    Rol: ${role}
    Historial de incidentes/capacitaciones: ${history}
    Riesgos actuales del proyecto: ${projectRisks}
    
    El plan debe incluir:
    1. Recomendaciones específicas para su rol.
    2. Refuerzo de capacitación basado en su historial.
    3. Medidas preventivas críticas para los riesgos del proyecto actual.
    4. Un mensaje motivador personalizado.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recomendacionesRol: { type: Type.ARRAY, items: { type: Type.STRING } },
          refuerzoCapacitacion: { type: Type.ARRAY, items: { type: Type.STRING } },
          medidasCriticas: { type: Type.ARRAY, items: { type: Type.STRING } },
          mensajeMotivador: { type: Type.STRING }
        },
        required: ["recomendacionesRol", "refuerzoCapacitacion", "medidasCriticas", "mensajeMotivador"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const analyzeDocumentCompliance = async (documentText: string, normativeContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza el cumplimiento normativo del siguiente documento.
    TEXTO DEL DOCUMENTO:
    ${documentText}
    
    CONTEXTO NORMATIVO:
    ${normativeContext}
    
    Determina si el documento cumple con la normativa y qué falta.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isCompliant: { type: Type.BOOLEAN },
          complianceScore: { type: Type.NUMBER },
          findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["isCompliant", "complianceScore", "findings", "recommendations"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateTrainingRecommendations = async (workerName: string, workerRole: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Actúa como un experto en capacitación de seguridad industrial.
    Genera recomendaciones de capacitación personalizadas para el trabajador ${workerName} (${workerRole}).
    Contexto del trabajador y riesgos asociados:
    ${context}
    
    Proporciona una lista de al menos 3 recomendaciones de capacitación, cada una con un título, una descripción breve y el nivel de prioridad (Alta, Media, Baja).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            priority: { type: Type.STRING, enum: ["Alta", "Media", "Baja"] }
          },
          required: ["title", "description", "priority"]
        }
      }
    }
  });

  return JSON.parse(response.text);
};

export const investigateIncidentWithAI = async (incidentTitle: string, incidentDescription: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Actúa como un experto en investigación de incidentes (Metodología ICAM, 5 Porqués).
    Analiza el siguiente incidente y sugiere causas raíz y acciones correctivas.
    Título: ${incidentTitle}
    Descripción: ${incidentDescription}
    
    Contexto adicional del proyecto:
    ${context}
    
    Proporciona un análisis detallado que incluya:
    1. Resumen del incidente.
    2. Causas Inmediatas.
    3. Causas Raíz (Basado en los 5 Porqués).
    4. Acciones Correctivas Sugeridas.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          immediateCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
          rootCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctiveActions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                action: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ["Alta", "Media", "Baja"] }
              },
              required: ["action", "priority"]
            }
          }
        },
        required: ["summary", "immediateCauses", "rootCauses", "correctiveActions"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const auditProjectComplianceWithAI = async (projectName: string, projectContext: string, normativeContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Actúa como un auditor senior de cumplimiento de seguridad y salud ocupacional.
    Realiza una auditoría de cumplimiento para el proyecto ${projectName}.
    
    CONTEXTO DEL PROYECTO (Red Neuronal):
    ${projectContext}
    
    CONTEXTO NORMATIVO (Leyes, Reglamentos):
    ${normativeContext}
    
    Identifica brechas de cumplimiento, riesgos no mitigados y proporciona recomendaciones de mejora.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          complianceScore: { type: Type.NUMBER, description: "Puntaje de 0 a 100" },
          criticalGaps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                gap: { type: Type.STRING },
                regulation: { type: Type.STRING },
                severity: { type: Type.STRING, enum: ["Crítica", "Alta", "Media"] }
              },
              required: ["gap", "regulation", "severity"]
            }
          },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING }
        },
        required: ["complianceScore", "criticalGaps", "recommendations", "summary"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const analyzeAttendancePatterns = async (projectName: string, attendanceData: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza los siguientes patrones de asistencia de trabajadores en busca de riesgos de fatiga o seguridad para el proyecto ${projectName}.
    DATOS DE ASISTENCIA:
    ${attendanceData}
    
    Identifica trabajadores con exceso de horas, turnos irregulares o patrones que podrían indicar un riesgo.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          riskLevel: { type: Type.STRING, enum: ["Bajo", "Medio", "Alto", "Crítico"] },
          findings: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["riskLevel", "findings", "recommendations"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const generateSafetyCapsule = async (workerName: string, role: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera una cápsula de seguridad de 1 minuto para el trabajador ${workerName} (${role}).
    Contexto de riesgos: ${context}
    
    La cápsula debe ser directa, motivadora y contener un consejo clave (Key Tip).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          keyTip: { type: Type.STRING },
          duration: { type: Type.STRING }
        },
        required: ["title", "content", "keyTip", "duration"]
      }
    }
  });

  return JSON.parse(response.text);
};

export const suggestRisksWithAI = async (industry: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Basado en el rubro "${industry}" y el contexto del proyecto "${context}", sugiere 5 riesgos críticos que deberían estar en la matriz IPERC.
    Para cada riesgo, asigna un valor de Probabilidad (1-5) y Severidad (1-5) según la metodología de evaluación de riesgos.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Título corto del peligro" },
            actividad: { type: Type.STRING, description: "La actividad o tarea específica donde ocurre el peligro" },
            description: { type: Type.STRING, description: "Descripción detallada del peligro" },
            riesgo: { type: Type.STRING, description: "El riesgo asociado (ej: Caída, Atrapamiento)" },
            consecuencia: { type: Type.STRING, description: "Consecuencia potencial (ej: Fractura, Muerte)" },
            probabilidad: { type: Type.NUMBER, description: "Valor de 1 a 5" },
            severidad: { type: Type.NUMBER, description: "Valor de 1 a 5" },
            criticidad: { type: Type.STRING, enum: ["Baja", "Media", "Alta", "Crítica"] },
            recomendaciones: { type: Type.ARRAY, items: { type: Type.STRING } },
            controles: { type: Type.ARRAY, items: { type: Type.STRING } },
            normativa: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "actividad", "description", "riesgo", "consecuencia", "probabilidad", "severidad", "criticidad", "recomendaciones", "controles", "normativa"]
        }
      }
    }
  });
  return JSON.parse(response.text);
};

export const suggestNormativesWithAI = async (industry: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera una lista de 3 normativas, leyes o decretos chilenos específicos y críticos para la industria: ${industry}. No incluyas la Ley 16.744 ni el DS 594 que son generales. Enfócate en riesgos específicos del rubro.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            code: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING }
          },
          required: ["title", "code", "description", "category"]
        }
      }
    }
  });

  return JSON.parse(response.text || '[]');
};

export const generateCompensatoryExercises = async (fatigue: number, posture: number, attention: number) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Genera una rutina rápida de ejercicios compensatorios (pausa activa) basada en las siguientes métricas biométricas de un trabajador:
  - Fatiga: ${fatigue}% (Alta fatiga requiere ejercicios de activación y descanso visual)
  - Calidad Postural: ${posture}% (Baja postura requiere estiramientos de espalda, cuello y hombros)
  - Atención: ${attention}% (Baja atención requiere ejercicios de respiración y enfoque)
  
  La rutina debe durar máximo 3-5 minutos.
  Responde en formato JSON estricto con la siguiente estructura:
  - title (string)
  - description (string)
  - exercises (array de objetos con: name (string), duration (string), instructions (string))`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                duration: { type: Type.STRING },
                instructions: { type: Type.STRING }
              },
              required: ["name", "duration", "instructions"]
            }
          }
        },
        required: ["title", "description", "exercises"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};

export const analyzeBioImage = async (base64Image: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Image
          }
        },
        {
          text: `Analiza esta imagen de un trabajador en un entorno industrial/laboral. 
          Evalúa los siguientes aspectos y devuelve un JSON estricto:
          1. fatigue: Nivel de fatiga (0 a 100, donde 100 es muy fatigado). Busca ojos cerrados, bostezos, cabeza caída.
          2. posture: Calidad postural (0 a 100, donde 100 es postura perfecta). Evalúa ergonomía (REBA/RULA aproximado).
          3. attention: Nivel de atención (0 a 100, donde 100 es muy atento). Busca mirada al frente, concentración.
          4. epp: Cumplimiento general de EPP (0 a 100).
          5. detectedEPP: Array de strings con los EPP que SÍ tiene puestos (ej. "Casco", "Lentes", "Chaleco Reflectante", "Guantes").
          6. missingEPP: Array de strings con los EPP básicos que le FALTAN (ej. "Lentes de seguridad", "Protección auditiva").
          7. alerts: Array de strings con alertas críticas detectadas (ej. "Postura de alto riesgo", "Signos de somnolencia"). Si todo está bien, array vacío.`
        }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fatigue: { type: Type.NUMBER },
          posture: { type: Type.NUMBER },
          attention: { type: Type.NUMBER },
          epp: { type: Type.NUMBER },
          detectedEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          missingEPP: { type: Type.ARRAY, items: { type: Type.STRING } },
          alerts: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["fatigue", "posture", "attention", "epp", "detectedEPP", "missingEPP", "alerts"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
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

export const generateEmergencyPlanJSON = async (scenario: string, description: string, normative: string, industry?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `
    Genera un Plan de Emergencia detallado para el siguiente escenario:
    Escenario: ${scenario}
    Descripción: ${description}
    Normativa Principal a Cumplir: ${normative}
    ${industry ? `Industria: ${industry} (Adapta el plan a los estándares de este rubro)` : ''}
    
    El Plan de Emergencia debe incluir:
    1. Objetivo del Plan
    2. Alcance
    3. Marco Legal y Normativo (Cita artículos exactos del DS 594, Ley 16.744 u otros aplicables según la Biblioteca del Congreso Nacional de Chile - BCN, que justifiquen este documento)
    4. Evaluación Matemática del Riesgo (Incluye la fórmula en formato LaTeX: $MR = P \\times C$, y explica los valores asignados para Probabilidad y Consecuencia basados en el escenario)
    5. Cadena de Mando y Comunicaciones
    6. Acciones Inmediatas (Primeros 5 minutos)
    7. Procedimiento de Evacuación
    8. Equipos de Emergencia Requeridos
    
    Asegúrate de que el contenido sea profesional, técnico y cumpla estrictamente con la normativa indicada (${normative}).
    IMPORTANTE: En la sección "evaluacionMatematica", DEBES usar sintaxis LaTeX encerrada en signos de dólar (ej. $MR = P \\times C$) para las fórmulas.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          objetivo: { type: Type.STRING },
          alcance: { type: Type.STRING },
          marcoLegal: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Citas exactas de artículos de leyes chilenas aplicables"
          },
          evaluacionMatematica: {
            type: Type.STRING,
            description: "Evaluación del riesgo incluyendo fórmulas en LaTeX como $MR = P \\times C$"
          },
          cadenaMando: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          accionesInmediatas: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING } 
          },
          evacuacion: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          equipos: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ['objetivo', 'alcance', 'marcoLegal', 'evaluacionMatematica', 'cadenaMando', 'accionesInmediatas', 'evacuacion', 'equipos']
      }
    }
  });

  return JSON.parse(response.text || '{}');
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

  return JSON.parse(response.text);
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

  return JSON.parse(response.text);
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

  return JSON.parse(response.text);
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

  return JSON.parse(response.text);
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

  return JSON.parse(response.text);
};

export const calculateDynamicEvacuationRoute = async (activeEmergencies: any[], workers: any[], machinery: any[]) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Actúa como un experto en logística de emergencias y evacuación industrial. 
    Calcula la ruta de evacuación más segura y dinámica dadas las siguientes condiciones en tiempo real:
    
    EMERGENCIAS ACTIVAS E INCIDENTES:
    ${activeEmergencies.map(e => `- ${e.title}: ${e.description}`).join('\n')}
    
    ESTADO DEL PERSONAL (Digital Twin):
    ${workers.map(w => `- Trabajador ${w.id}: Estado ${w.status}, Caído: ${w.isFallen ? 'Sí' : 'No'}, Posición [${w.position.join(', ')}]`).join('\n')}
    
    ESTADO DE MAQUINARIA (Digital Twin):
    ${machinery.map(m => `- Máquina ${m.id} (${m.type}): Estado ${m.status}, Posición [${m.position.join(', ')}]`).join('\n')}
    
    Considera que las rutas tradicionales podrían estar bloqueadas por las emergencias o por maquinaria en estado crítico.
    Prioriza la asistencia a trabajadores caídos (isFallen: true).
    
    Proporciona:
    1. El nombre de la ruta más segura.
    2. Un array de áreas o rutas bloqueadas (ej. 'R1', 'R2').
    3. Tiempo estimado de evacuación.
    4. Nivel de prioridad/alerta (Rojo, Amarillo, Verde).
    5. Instrucciones paso a paso claras y precisas.
    6. Nombre del punto de encuentro óptimo.
    7. Coordenadas (lat, lng) del punto de inicio sugerido (cerca de los trabajadores en peligro).
    8. Coordenadas (lat, lng) del punto de encuentro óptimo.
    Usa coordenadas realistas cerca de Santiago de Chile (lat: -33.4..., lng: -70.6...) si no tienes contexto exacto.`,
    config: {
      responseMimeType: "application/json",
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

  return JSON.parse(response.text || '{}');
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
  let functionCall = null;

  if (result.functionCalls && result.functionCalls.length > 0) {
    const call = result.functionCalls[0];
    if (call.name === "reportIncident") {
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

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const parts: any[] = [{ text: `Analiza esta publicación del muro de seguridad hecha por ${userName}.
  Contenido: "${content}"
  
  Determina si esta publicación representa un RIESGO (Risk) o un INCIDENTE (Incident) que deba ser registrado en la Red Neuronal.
  Si es solo un comentario general, tip o felicitación, isRelevant debe ser false.
  Si es un riesgo o incidente, isRelevant debe ser true, y debes extraer un título, descripción, nivel de criticidad y etiquetas (tags).` }];

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
          criticidad: { type: Type.STRING, description: "Baja, Media, Alta, Critica" },
          tags: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }
          }
        },
        required: ["isRelevant"]
      }
    }
  });

  return JSON.parse(response.text.trim());
};

export const analyzePsychosocialRisks = async (nodesContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  try {
    const prompt = `
      Actúa como un psicólogo ocupacional experto en la normativa chilena (SUSESO/ISTAS21).
      Analiza los siguientes datos de la Red Neuronal de la empresa para identificar patrones de riesgo psicosocial.
      Busca correlaciones entre:
      - Incidentes reportados.
      - Evaluaciones ISTAS21 previas.
      - Horarios de trabajo o asistencia (si hay datos).
      - Hallazgos de seguridad.
      
      Datos de la Red Neuronal:
      ${nodesContext}
      
      Proporciona un informe estructurado en Markdown con:
      1. **Resumen Ejecutivo**: Estado general del clima laboral y salud mental.
      2. **Dimensiones Críticas**: Identifica qué dimensiones del ISTAS21 (Exigencias psicológicas, Trabajo activo, Apoyo social, Compensaciones, Doble presencia) podrían estar en riesgo según los datos.
      3. **Correlaciones Encontradas**: Relaciones entre incidentes y posibles factores psicosociales (ej. fatiga, estrés).
      4. **Plan de Acción Recomendado**: Medidas preventivas y correctivas basadas en la normativa chilena.
    `;
    
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
    });
    
    return response.text || "No se pudo generar el análisis.";
  } catch (error) {
    console.error("Error in analyzePsychosocialRisks:", error);
    throw error;
  }
};

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
    console.error('Error calculating structural load:', error);
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
    console.error('Error designing hazmat storage:', error);
    return 'Error al generar el diseño de la instalación. Por favor, intente nuevamente.';
  }
};

export const evaluateMinsalCompliance = async (protocolTitle: string, context: string, industry?: string) => {
  try {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = `
      Actúa como un Auditor Senior del Ministerio de Salud de Chile (MINSAL) y experto en la Ley 16.744, utilizando siempre como base la Biblioteca del Congreso Nacional de Chile (BCN).
      Necesito evaluar el nivel de cumplimiento del siguiente protocolo en mi proyecto:
      Protocolo: ${protocolTitle}
      Industria: ${industry || 'General'}
      Contexto Actual del Proyecto (Hallazgos, Riesgos, Incidentes):
      ${context || 'Sin datos específicos registrados aún.'}

      Por favor, genera un informe de auditoría estructurado que incluya:
      1. **Estado de Cumplimiento Estimado**: (Cumple, En Riesgo, No Cumple) basado en el contexto.
      2. **Brechas Identificadas**: Qué falta según las exigencias del protocolo (ej. evaluaciones ambientales, vigilancia médica, capacitación).
      3. **Plan de Acción Inmediato**: Pasos operativos claros para cerrar las brechas.
      4. **Multas o Sanciones Potenciales**: Qué riesgos legales enfrenta la empresa si no regulariza la situación (referencia a la ley).

      Responde en formato Markdown, estructurado, claro y profesional.
    `;

    const result = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: prompt
    });
    return result.text || 'No se pudo generar la evaluación.';
  } catch (error) {
    console.error('Error evaluating MINSAL compliance:', error);
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
    console.error("Error generating module recommendations:", error);
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

  return JSON.parse(response.text.trim());
};
