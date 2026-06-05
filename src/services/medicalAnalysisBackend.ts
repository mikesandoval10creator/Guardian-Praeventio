// Praeventio Guard — medical illustration backend (ADR 0012).
//
// HISTORY: this module once held four Gemini medical endpoints
// (analyzeMedicalInjury, differentialDiagnosis, checkDrugInteractions,
// generateMedicalIllustration). The first three INFERRED diagnosis / clinical
// advice — which ADR 0012 forbids — and they were already de-whitelisted in
// ALLOWED_GEMINI_ACTIONS (dead, rejected surface). Their UIs were reconverted to
// non-diagnostic tools (visor → SymptomDocumenter #674, diagnóstico → CIE-10
// reference #676, fármacos → Vademécum reference #677), so the diagnostic
// backends were REMOVED here (2026-06) — they cannot be made conforming because
// they ARE the inference.
//
// Only the EDUCATIONAL anatomical illustration remains (anatomy-textbook image
// for DIAT documentation, no diagnosis). The facade `geminiBackend.ts`
// re-exports this via `export * from './medicalAnalysisBackend.js'`.

import { GoogleGenAI, Modality } from '@google/genai';
import { API_KEY, withExponentialBackoff } from './gemini/_shared.js';

export interface MedicalIllustrationSuccess {
  imageBase64: string;
  mimeType: string;
}

export type MedicalIllustrationResult =
  | MedicalIllustrationSuccess
  | { error: string };

/**
 * Genera ilustración anatómica vía Gemini 2.0 image-generation con
 * paleta teal/petroleum + gold (Praeventio brand). Estilo libro
 * médico, NO photorealistic, NO gráfico/sangriento. Para DIAT
 * documentation.
 */
export async function generateMedicalIllustration(
  regions: { id: string; label: string; severity: string | null }[],
  specialistContext?: string,
): Promise<MedicalIllustrationResult> {
  if (!API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const injured = regions.filter((r) => r.severity !== null);
  if (injured.length === 0) return { error: 'Sin zonas para ilustrar' };

  const regionList = injured.map((r) => `${r.label} (${r.severity})`).join(', ');

  const prompt = `Professional medical anatomical illustration in editorial style, clean white background.
Show the human body with focus on these injured regions: ${regionList}.
Use soft teal/petroleum blue palette with gold accents (matching Guardian Praeventio brand).
Style: clean medical textbook illustration, NOT photorealistic, NOT graphic/bloody.
Show anatomical labels with subtle arrows pointing to affected areas.
Educational and professional — suitable for occupational health DIAT documentation in Chile.
${specialistContext ? `Context: ${specialistContext}` : ''}
No text overlays. Purely visual anatomical reference.`;

  const genAI = new GoogleGenAI({ apiKey: API_KEY });
  return await withExponentialBackoff(async () => {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
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
