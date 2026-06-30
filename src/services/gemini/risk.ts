// Praeventio Guard — §12.5.1 split step 6: Gemini risk analysis bundle.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Sexta
// extracción del split. Bundles 4 funciones de análisis de riesgos:
//
//   1. analyzeFastCheck(observation) — clasifica observación en terreno
//      (RISK / FINDING / MITIGATION + criticidad + acción inmediata).
//   2. predictGlobalIncidents(context, envContext) — predicción incidentes
//      desde red de riesgos + contexto ambiental.
//   3. analyzeRiskWithAI(description, nodesContext, industry) — análisis
//      IPERC con community knowledge fallback. NO devuelve clasificación
//      P×S (lock R1 — eso lo hace la matriz determinística iper.ts).
//   4. analyzeRootCauses(riskTitle, riskDescription, context) — Ruta de
//      Prevención (causas raíz + acciones de revisión en terreno).
//
// Todas pasan los prompts por `redactPromptForVertex` (PII) y wrappean
// con `withSentryScope` cuando aplica (telemetría sin leak de PII).

import * as Sentry from '@sentry/core';
import { GoogleGenAI, Type } from '@google/genai';
import { logger } from '../../utils/logger';
import { withSentryScope } from '../observability/sentryInstrumentation';
import { redactPii } from '../observability/piiRedactor';
import { queryCommunityKnowledge } from '../ragService';
import { parseGeminiJson } from './parsing';
import { AI_MODEL_FAST, AI_MODEL_REASONING } from '../../config/aiModels';

// TODO(§12.5.1 step 6 → step 2 merge): cuando PR #555 (gemini/pii.ts)
// mergee a main, reemplazar este helper inline por `import {
// redactPromptForVertex } from './pii'`. Inline aquí para mantener
// este PR independiente de la chain pii→risk.
const redactPromptForVertex = (prompt: string, action: string): string => {
  const { redacted, count, categories } = redactPii(prompt);
  if (count > 0) {
    logger.info(
      `[pii.redaction] action=${action} count=${count} categories=${categories.join(',')}`,
    );
    try {
      Sentry.addBreadcrumb({
        category: 'pii.redaction',
        level: 'info',
        message: `Redacted ${count} PII token(s) before Vertex AI call`,
        data: { action, count, categories },
      });
    } catch {
      /* observability faults must not change control flow */
    }
  }
  return redacted;
};

const API_KEY = process.env.GEMINI_API_KEY;

export const analyzeFastCheck = async (observation: string): Promise<unknown> => {
  // Sprint 20 Bucket Mu — wrap with Sentry scope. We DO NOT pass the
  // raw `observation` text into the Sentry context: it can contain
  // worker names, site coordinates, or PII the operator typed into the
  // field. We pass only its length so we can correlate failures by
  // input size without leaking the content.
  return withSentryScope(
    'gemini',
    { action: 'analyzeFastCheck', observationLength: observation?.length ?? 0 },
    async () => {
      if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const fastCheckPrompt = `Analiza la siguiente observación de seguridad en terreno (Fast Check):
    "${observation}"

    Clasifica la observación y proporciona:
    1. Tipo de nodo (RISK, FINDING, o MITIGATION).
    2. Un título corto y descriptivo.
    3. Nivel de criticidad (Alta, Media, Baja).
    4. Acción inmediata recomendada.
    5. Lista de etiquetas (tags) relevantes.`;
      const response = await ai.models.generateContent({
        model: AI_MODEL_FAST,
        contents: redactPromptForVertex(fastCheckPrompt, 'analyzeFastCheck'),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tipo: { type: Type.STRING, enum: ['RISK', 'FINDING', 'MITIGATION'] },
              titulo: { type: Type.STRING },
              criticidad: { type: Type.STRING, enum: ['Alta', 'Media', 'Baja'] },
              accionInmediata: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['tipo', 'titulo', 'criticidad', 'accionInmediata', 'tags'],
          },
        },
      });

      return parseGeminiJson(response);
    },
  );
};

async function predictGlobalIncidentsImpl(
  context: string,
  envContext: string,
): Promise<unknown> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: AI_MODEL_FAST,
    contents: `Actúa como un sistema de predicción de riesgos industriales.
    Analiza el siguiente contexto de la red de riesgos y las condiciones ambientales actuales para predecir posibles incidentes.

    CONTEXTO DE LA RED DE RIESGOS:
    ${context}

    CONDICIONES AMBIENTALES:
    ${envContext}

    Proporciona una lista de predicciones de incidentes, ordenadas por probabilidad y criticidad.
    Para cada predicción, incluye:
    1. Título del incidente.
    2. Descripción detallada.
    3. Nivel de criticidad (Alta, Media, Baja).
    4. Probabilidad (Alta, Media, Baja).
    5. Acción preventiva recomendada.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          predicciones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                titulo: { type: Type.STRING },
                descripcion: { type: Type.STRING },
                criticidad: { type: Type.STRING, enum: ['Alta', 'Media', 'Baja'] },
                probabilidad: { type: Type.STRING, enum: ['Alta', 'Media', 'Baja'] },
                accionPreventiva: { type: Type.STRING },
              },
              required: [
                'titulo',
                'descripcion',
                'criticidad',
                'probabilidad',
                'accionPreventiva',
              ],
            },
          },
        },
        required: ['predicciones'],
      },
    },
  });

  return parseGeminiJson(response);
}

export const predictGlobalIncidents = async (
  context: string,
  envContext: string,
): Promise<unknown> => {
  return withSentryScope(
    'gemini',
    {
      action: 'predictGlobalIncidents',
      contextLength: context?.length ?? 0,
      envContextLength: envContext?.length ?? 0,
    },
    async () => predictGlobalIncidentsImpl(context, envContext),
  );
};

async function analyzeRiskWithAIImpl(
  description: string,
  nodesContext: string,
  industry?: string,
): Promise<unknown> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  // Round 16 (R1) — `criticidad` is intentionally OMITTED from the prompt
  // and the response schema. Risk level / criticidad classification is a
  // legal output of the deterministic IPER P×S matrix (`src/services/
  // protocols/iper.ts`) and Ley 16.744 attaches liability to that
  // classification. The LLM is restricted to suggesting controls and
  // citing normativa — it cannot produce a class that downstream auditors
  // could mistake for a deterministic figure.
  const prompt = `Analiza el siguiente riesgo reportado en el contexto de la industria ${industry || 'general'}.

    Riesgo Reportado:
    "${description}"

    Contexto de la Red de Riesgos:
    ${nodesContext}

    Proporciona un análisis IPERC (Identificación de Peligros, Evaluación de Riesgos y Controles).

    IMPORTANTE: NO devuelvas un nivel de criticidad ni una clasificación P×S.
    La clasificación legal del riesgo viene de la matriz IPER deterministic (P×S)
    operada por el prevencionista. Tu rol se limita a:
    1. Lista de recomendaciones inmediatas.
    2. Lista de controles a implementar siguiendo la Jerarquía de Controles
       (eliminación → sustitución → ingeniería → administrativo → EPP).
    3. Normativa aplicable (ej. DS 594, DS 44/2024 [ex DS 54 y ex DS 40, derogados 01-02-2025], Ley 16.744, NCh ISO 45001).`;

  const safePrompt = redactPromptForVertex(prompt, 'analyzeRiskWithAI');

  const fallback = async () => {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: AI_MODEL_FAST,
      contents: safePrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recomendaciones: { type: Type.ARRAY, items: { type: Type.STRING } },
            controles: { type: Type.ARRAY, items: { type: Type.STRING } },
            normativa: { type: Type.STRING },
          },
          required: ['recomendaciones', 'controles', 'normativa'],
        },
      },
    });
    if (!response.text) {
      throw new Error('gemini_empty_response');
    }
    return response.text;
  };

  const resultString = await queryCommunityKnowledge(safePrompt, industry || 'general', fallback);
  return JSON.parse(resultString);
}

export const analyzeRiskWithAI = async (
  description: string,
  nodesContext: string,
  industry?: string,
): Promise<unknown> => {
  // Sprint 20 Bucket Mu — Sentry scope captures `industry` (low-cardinality,
  // useful for triage) but never the raw `description` (free-text from
  // the user, may contain worker names / site identifiers).
  return withSentryScope(
    'gemini',
    {
      action: 'analyzeRiskWithAI',
      industry: industry || 'general',
      descriptionLength: description?.length ?? 0,
      nodesContextLength: nodesContext?.length ?? 0,
    },
    async () => analyzeRiskWithAIImpl(description, nodesContext, industry),
  );
};

export const analyzeRootCauses = async (
  riskTitle: string,
  riskDescription: string,
  context: string,
): Promise<unknown> => {
  if (!API_KEY) throw new Error('API Key no configurada');

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard, experto en prevención de riesgos laborales en Chile y la metodología Zettelkasten.

  Se ha solicitado un análisis de causas raíz para el siguiente riesgo:
  Riesgo: ${riskTitle}
  Descripción: ${riskDescription}

  Contexto adicional del sistema (nodos relacionados):
  ${context}

  Tu tarea es generar una "Ruta de Prevención" que identifique las causas principales de este riesgo y recomiende acciones específicas de revisión en terreno para evitar que se materialice.

  Devuelve un JSON con la siguiente estructura:
  - explanation: Un breve párrafo (max 3 líneas) explicando por qué este riesgo es crítico en el contexto actual.
  - rootCauses: Un array de strings con las 3 causas raíz más probables (ej. "Falta de mantención en equipos de izaje").
  - recommendedActions: Un array de strings con 3 a 5 acciones concretas y verificables en terreno (ej. "Verificar certificación vigente de arneses de seguridad").`;

  try {
    const response = await ai.models.generateContent({
      model: AI_MODEL_REASONING,
      contents: redactPromptForVertex(prompt, 'analyzeRootCauses'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explanation: { type: Type.STRING },
            rootCauses: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['explanation', 'rootCauses', 'recommendedActions'],
        },
      },
    });

    return parseGeminiJson(response);
  } catch (error) {
    logger.error('Error analyzing root causes:', error);
    throw error;
  }
};
