// Praeventio Guard — AI Compliance Check: contrato único + extracción de texto.
//
// Tarea Notion `[P1] El 'AI Compliance Check' no analiza el documento`:
//   - DocsModal enviaba `documentText=docName` (el NOMBRE, no el contenido).
//   - La UI consumía `compliance.reason` / `compliance.urgency`, campos que el
//     modelo nunca devuelve (el contrato real es isCompliant/complianceScore/
//     findings/recommendations) → descripciones con "undefined".
//
// Este módulo:
//   1. Define el contrato ÚNICO (Zod) del resultado, compartido entre
//      operations.ts (server) y la UI (cliente).
//   2. Extrae texto REAL del archivo (txt / imagen / PDF vía tesseract.js).
//   3. Garantiza que nunca se declare cumplimiento sin analizar contenido:
//      texto insuficiente → resultado explícito `UNANALYZED_DOCUMENT_RESULT`.

import { z } from 'zod';

// ───────────────────────── Contrato único (Zod) ─────────────────────────

export const documentComplianceResultSchema = z.object({
  isCompliant: z.boolean(),
  complianceScore: z.number().min(0).max(100),
  findings: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type DocumentComplianceResult = z.infer<
  typeof documentComplianceResultSchema
>;

/**
 * Resultado explícito cuando NO hay texto analizable. Nunca declara
 * cumplimiento sin análisis (requisito de la tarea).
 */
export const UNANALYZED_DOCUMENT_RESULT: DocumentComplianceResult = {
  isCompliant: false,
  complianceScore: 0,
  findings: [
    'No se pudo extraer texto del documento para analizarlo.',
  ],
  recommendations: [
    'Sube el documento en un formato legible (PDF con texto, imagen nítida o TXT) y vuelve a intentarlo.',
  ],
};

/** Límite de caracteres enviados al modelo (presupuesto del prompt). */
export const MAX_DOCUMENT_TEXT_CHARS = 8000;

/** Umbral mínimo de texto útil para considerar el documento analizable. */
export const MIN_ANALYZABLE_CHARS = 20;

// ───────────────────────── Helpers puros ─────────────────────────

export function truncateDocumentText(text: string): string {
  return text.slice(0, MAX_DOCUMENT_TEXT_CHARS);
}

/** True si el texto extraído alcanza para un análisis honesto. */
export function hasAnalyzableText(text: string): boolean {
  const compact = text.trim().replace(/\s+/g, ' ');
  return compact.length >= MIN_ANALYZABLE_CHARS;
}

/** Contexto normativo aplicable por defecto (Ley 16.744 + DS vigentes). */
export function buildNormativeContext(role: string): string {
  const roleLine = role ? `Cargo/rol del trabajador: ${role}.` : '';
  return [
    roleLine,
    'Normativa chilena de prevención de riesgos laborales aplicable:',
    '- Ley 16.744 (seguro social contra riesgos del trabajo y enfermedades profesionales).',
    '- DS 44/2024 (reglamento de comités paritarios y departamentos de prevención; vigente desde 01-02-2025).',
    '- DS 594 (condiciones sanitarias y ambientales básicas en los lugares de trabajo).',
  ]
    .filter(Boolean)
    .join('\n');
}

// ───────────────────────── Extracción de texto ─────────────────────────

/**
 * Extrae texto real del archivo, client-side:
 *   - TXT / text/* → lectura directa.
 *   - Imágenes y PDF → OCR con tesseract.js (dependencia del repo), idioma es.
 * Devuelve texto truncado; vacío si la extracción falla.
 */
export async function extractDocumentText(
  file: File | Blob,
  fileName: string,
): Promise<string> {
  const name = (fileName || '').toLowerCase();
  const type = file.type || '';

  if (name.endsWith('.txt') || type.startsWith('text/')) {
    try {
      const text = await file.text();
      return truncateDocumentText(text);
    } catch {
      return '';
    }
  }

  // Imágenes (jpeg/png/webp) y PDF → OCR.
  try {
    const Tesseract = (await import('tesseract.js')).default;
    const { data } = await Tesseract.recognize(file, 'spa');
    return truncateDocumentText(data.text || '');
  } catch {
    return '';
  }
}
