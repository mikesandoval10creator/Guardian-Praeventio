import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;

export const analyzeRiskWithAI = async (description: string, nodesContext?: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza el siguiente riesgo laboral y proporciona recomendaciones preventivas, controles sugeridos y nivel de criticidad.
    Utiliza el contexto de la red de conocimiento (Zettelkasten) para identificar patrones de riesgos similares y controles exitosos en otros proyectos.
    
    CONTEXTO DE CONOCIMIENTO PREVIO (Zettelkasten):
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

export const predictGlobalIncidents = async (nodesContext: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analiza la siguiente red neuronal de seguridad (Zettelkasten) y detecta los 3 nodos de riesgo con mayor probabilidad de fallo o incidente en las próximas 48 horas.
    Considera conexiones entre trabajadores, falta de EPP, normativas no cumplidas y condiciones de entorno.
    
    RED DE CONOCIMIENTO:
    ${nodesContext}`,
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
                mitigacionSugerida: { type: Type.STRING }
              },
              required: ["nodoId", "titulo", "probabilidad", "razon", "mitigacionSugerida"]
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


export const generateEmergencyPlan = async (projectName: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera un "Plan de Emergencia (PE)" detallado para el proyecto ${projectName}.
    Utiliza el siguiente contexto del Zettelkasten (riesgos, activos, rutas, puntos de encuentro):
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

export const getChatResponse = async (message: string, context: string) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Mensaje del usuario: ${message}`,
    config: {
      systemInstruction: `Eres "El Guardián", la conciencia arquitectónica de Praeventio Guard. 
      Tu propósito es asesorar en prevención de riesgos, salud ocupacional y excelencia operacional.
      Tienes acceso a la red de conocimiento (Zettelkasten) del proyecto actual.
      Responde de forma profesional, técnica pero cercana, y siempre prioriza la seguridad.
      
      CONTEXTO DEL PROYECTO (Nodos del Zettelkasten):
      ${context}
      
      Si el usuario pregunta por un trabajador, riesgo o documento específico, consulta el contexto proporcionado.
      Si no tienes la información en el contexto, indícalo pero ofrece consejos generales basados en la normativa chilena (Ley 16.744, DS 594, etc.).`
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

export const generateActionPlan = async (findingTitle: string, findingDescription: string = '', severity: string = 'Media') => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Genera un plan de acción correctivo para el siguiente hallazgo de seguridad.
    Título: ${findingTitle}
    Descripción: ${findingDescription}
    Severidad: ${severity}
    
    Proporciona una lista de tareas concretas, plazos sugeridos y responsables típicos.`,
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
    contents: `Genera un borrador profesional de un documento de seguridad tipo ${reportType} (Permiso de Trabajo Seguro, Plan de Emergencia o Análisis Seguro de Trabajo) basado en el siguiente contexto: ${context}. 
    El formato debe ser Markdown estructurado con secciones claras: Objetivos, Riesgos Identificados, Medidas de Control, EPP Requerido y Procedimiento Paso a Paso. 
    Usa un tono técnico y preventivo chileno.`,
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
    
    CONTEXTO DEL PROYECTO (Zettelkasten):
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
