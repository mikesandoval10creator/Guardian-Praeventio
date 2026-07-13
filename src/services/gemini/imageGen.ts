// Praeventio Guard — safety-visual image generation (B4 foundation).
//
// Generates a SAFETY POSTER / procedure-step illustration from a STRUCTURED spec
// via Gemini image-generation (the "Nano Banana"-class model already configured
// as AI_MODEL_IMAGE_GENERATION). The accuracy control lives in
// buildSafetyVisualPrompt (safetyVisualPrompt.ts) — the image model only fills
// in appearance; the spec fixes the facts (correct PPE, one action, hazard).
//
// This is a MANAGEMENT/authoring tool (a prevencionista generating training
// visuals), so it goes through /api/gemini like every other action. It is FREE
// on every tier — the founder's directive is "no feature barriers"; cost is
// bounded by the existing per-tenant Gemini quota + rate limiter, never a
// tier gate. VIEWING generated safety content is life-safety-adjacent and must
// always stay free (ADR 0021).

import { GoogleGenAI, Modality } from '@google/genai';
import { API_KEY, withExponentialBackoff } from './_shared.js';
import { AI_MODEL_IMAGE_GENERATION } from '../../config/aiModels.js';
import { buildSafetyVisualPrompt, type SafetyVisualSpec } from './safetyVisualPrompt.js';

export type { SafetyVisualSpec } from './safetyVisualPrompt.js';

export interface SafetyVisualSuccess {
  imageBase64: string;
  mimeType: string;
}

export type SafetyVisualResult = SafetyVisualSuccess | { error: string };

/**
 * Generate one safety visual (poster or procedure step) from a structured spec.
 * Returns `{ imageBase64, mimeType }` on success or `{ error }` — never throws
 * for a "thin spec" / "no image" outcome (the dispatcher serializes the object).
 * Throws only when the API key is missing (a server misconfiguration).
 */
export async function generateSafetyVisual(spec: SafetyVisualSpec): Promise<SafetyVisualResult> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const prompt = buildSafetyVisualPrompt(spec ?? ({} as SafetyVisualSpec));
  if (!prompt) return { error: 'Especificación insuficiente para generar el afiche (falta la acción)' };

  const genAI = new GoogleGenAI({ apiKey: API_KEY });
  return await withExponentialBackoff(async () => {
    const response = await genAI.models.generateContent({
      model: AI_MODEL_IMAGE_GENERATION,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? 'image/png',
        };
      }
    }
    return { error: 'No se generó imagen' };
  });
}
