const fs = require('fs');

let content = fs.readFileSync('src/services/geminiService.ts', 'utf-8');

// Add import for searchRelevantContext
if (!content.includes('searchRelevantContext')) {
    content = content.replace(
        'import { GoogleGenAI, Type } from "@google/genai";',
        'import { GoogleGenAI, Type } from "@google/genai";\nimport { searchRelevantContext } from "./ragService";'
    );
}

// Refactor queryBCN
const queryBCNRegex = /export const queryBCN = async \(query: string\) => \{[\s\S]*?return response\.text;\n\};/;
const newQueryBCN = `export const queryBCN = async (query: string) => {
  if (!API_KEY) throw new Error("API Key no configurada");

  const legalContext = await searchRelevantContext(query);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = \`
  Eres un asistente legal y normativo estricto, conectado a la base de datos vectorial de la Biblioteca del Congreso Nacional de Chile (BCN) y normativas ISO.
  
  REGLA DE ORO: NO ALUCINES. Debes responder ÚNICAMENTE basándote en el contexto legal proporcionado a continuación. Si la respuesta no está en el contexto, debes decir "No tengo información normativa sobre esto en mi base de datos actual."
  
  CONTEXTO RECUPERADO (RAG):
  \${legalContext}
  
  PREGUNTA DEL USUARIO:
  \${query}
  
  Responde de manera formal, citando la ley o decreto exacto. Usa formato Markdown.
  \`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        systemInstruction: "Eres un experto legal estricto. No inventas leyes. Citas fuentes exactas.",
        temperature: 0.1, // Low temperature to prevent hallucinations
      }
    });
    return response.text;
  } catch (error) {
    console.error("Error querying BCN:", error);
    throw error;
  }
};`;

content = content.replace(queryBCNRegex, newQueryBCN);

// Refactor getChatResponse
const getChatResponseRegex = /export const getChatResponse = async \(message: string, context: string, history: \{ role: string, content: string \}\[\] = \[\], detailLevel: number = 1\) => \{[\s\S]*?return response\.text;\n\};/;
const newGetChatResponse = `export const getChatResponse = async (message: string, context: string, history: { role: string, content: string }[] = [], detailLevel: number = 1) => {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const legalContext = await searchRelevantContext(message);
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const detailInstructions = [
    "Respuesta muy precisa, directa y concisa. Máximo 2-3 párrafos o una lista corta de puntos clave. Evita introducciones largas.",
    "Respuesta detallada con explicaciones técnicas intermedias. Incluye ejemplos y referencias normativas si están disponibles.",
    "Análisis exhaustivo y profundo. Conecta múltiples conceptos de la Red Neuronal, ofrece planes de acción detallados y análisis de riesgos complejos."
  ];

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview", // Zettelkasten Core: Siempre usa el mejor modelo disponible
    contents: [
      ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
      { role: 'user', parts: [{ text: \`Mensaje del usuario: \${message}\` }] }
    ],
    config: {
      systemInstruction: \`Eres "El Guardián", la conciencia arquitectónica de Praeventio Guard. 
      Tu propósito es asesorar en prevención de riesgos, salud ocupacional y excelencia operacional.
      Tienes acceso a la red de conocimiento (Red Neuronal) del proyecto actual y a la Base de Datos Vectorial de la BCN e ISO.
      Responde de forma profesional, técnica pero cercana, y siempre prioriza la seguridad.
      
      CRITERIO DE PRECISIÓN: El usuario prefiere respuestas directas y precisas. Evita el exceso de información innecesaria.
      PRIORIDAD DE FUENTE: Utiliza el CONTEXTO DEL PROYECTO (Red Neuronal) y el CONTEXTO LEGAL (BCN) como tus fuentes principales y más confiables. 
      REGLA DE ORO: NO ALUCINES LEYES. Si citas una ley, debe estar en el CONTEXTO LEGAL o ser de conocimiento público exacto.
      
      NIVEL DE DETALLE SOLICITADO: \${detailLevel} de 3.
      INSTRUCCIÓN DE PROFUNDIDAD: \${detailInstructions[detailLevel - 1]}
      
      CONTEXTO DEL PROYECTO (Nodos de la Red Neuronal):
      \${context}

      CONTEXTO LEGAL (Base de Datos Vectorial BCN e ISO):
      \${legalContext}
      
      Si el usuario pregunta por un trabajador, riesgo o documento específico, consulta el contexto del proyecto proporcionado.
      Si pregunta por normativas, básate estrictamente en el CONTEXTO LEGAL.\`
    }
  });

  return response.text;
};`;

content = content.replace(getChatResponseRegex, newGetChatResponse);

// Remove the BCN_VECTOR_DB_SIMULATION constant
const bcnSimRegex = /\/\/ Simulated RAG Database for BCN[\s\S]*?ISO 45001:2018: Norma internacional para sistemas de gestión de seguridad y salud en el trabajo\. Enfoque en el ciclo PHVA \(Planificar, Hacer, Verificar, Actuar\) y liderazgo de la alta dirección\.\n`;/g;
content = content.replace(bcnSimRegex, '');

fs.writeFileSync('src/services/geminiService.ts', content);
console.log('geminiService.ts refactored for RAG successfully.');
