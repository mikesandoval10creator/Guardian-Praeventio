// Praeventio Guard — §12.5.1 split step 16: Gemini engineering-advisory bundle.
//
// Extraído VERBATIM de `services/geminiBackend.ts` (movement-only, zero
// behavior change — precedente del split de billing). Decimosexta
// extracción del split. Bundles 2 funciones de asesoría de ingeniería:
//
//   1. calculateStructuralLoad(element, specs) — SWL / carga de ruptura /
//      factor de seguridad con normativa NCh/ASTM/ASME/OSHA. Markdown con
//      descargo de responsabilidad (validación por calculista certificado).
//   2. designHazmatStorage(storageType, volume, materialClass) — diseño de
//      bodega de sustancias peligrosas según OGUC + DS 43 + NCh382.
//
// Ambas devuelven TEXTO Markdown y degradan a un string de error en
// castellano (nunca propagan). Thin wrappers — sin lógica de negocio.

import { GoogleGenAI } from '@google/genai';
import { logger } from '../../utils/logger';
import { AI_MODEL_REASONING } from '../../config/aiModels';

const API_KEY = process.env.GEMINI_API_KEY;

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
      model: AI_MODEL_REASONING,
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
      model: AI_MODEL_REASONING,
      contents: prompt
    });
    return result.text || 'No se pudo generar el diseño.';
  } catch (error) {
    logger.error('Error designing hazmat storage:', error);
    return 'Error al generar el diseño de la instalación. Por favor, intente nuevamente.';
  }
};
