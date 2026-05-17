// Praeventio Guard — Sprint K §159: Control de alucinaciones.
//
// Heurística determinística sobre la respuesta del LLM: split en oraciones,
// detección de afirmaciones que contienen "patrones de alta especificidad"
// (números, fechas, leyes específicas) → exigir citation `[n]` adyacente.
//
// Por qué heurística y no LLM-juez:
//   • costo: ejecutar otro LLM como juez duplica latencia y tokens,
//   • determinismo: los tests de regresión necesitan output reproducible,
//   • auditoría: el patrón que dispara el bloqueo es inspeccionable.
//
// Trade-off conocido: la heurística produce falsos positivos en
// afirmaciones cuantitativas legítimas que el LLM "olvidó citar". Eso es
// preferible al falso negativo (alucinación cuantitativa sin citation),
// especialmente en dominio de prevención de riesgos donde un número
// inventado puede causar daño físico.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

import { extractCitations } from './citationValidator.ts';

/**
 * Resultado del check del hallucinationGuard.
 *
 *   - `allow === true`: la respuesta pasa el filtro; el wrapper puede
 *     devolverla al caller.
 *   - `allow === false`: hay al menos una oración con afirmación específica
 *     SIN citation adyacente. `reason` explica qué disparó el bloqueo —
 *     ese string va al log estructurado y (opcional) al fallback que se
 *     entrega al usuario.
 */
export interface HallucinationGuardResult {
  allow: boolean;
  reason: string;
  /**
   * Oraciones sospechosas detectadas (vacío si `allow === true`).
   * Útil para logs estructurados y para que el desarrollador entienda
   * qué patrones disparan falsos positivos en su prompt.
   */
  suspiciousSentences: ReadonlyArray<SuspiciousSentence>;
}

export interface SuspiciousSentence {
  text: string;
  /** Patrón que disparó la sospecha (ej. "number", "date", "law_ref"). */
  trigger: SuspicionTrigger;
}

export type SuspicionTrigger =
  | 'number_without_citation'
  | 'date_without_citation'
  | 'law_ref_without_citation'
  | 'percentage_without_citation';

// ────────────────────────────────────────────────────────────────────────
// Patrones de detección
// ────────────────────────────────────────────────────────────────────────

/**
 * Números "específicos" — enteros ≥ 2 dígitos o decimales. Excluye
 * dígitos sueltos para no marcar enumeraciones triviales ("1. paso ...").
 *
 * Match: 12, 1500, 3.5, 1,200 (formato es-CL)
 * No-match: 1, paso 2 (un dígito suelto)
 */
const NUMBER_REGEX = /\b\d{2,}(?:[.,]\d+)?\b/;

/** Porcentaje explícito: `5%`, `12,5%`, `100 %`. */
const PERCENTAGE_REGEX = /\b\d+(?:[.,]\d+)?\s*%/;

/**
 * Fechas en formatos comunes:
 *   • 2024, 2026 (años, 4 dígitos contiguos con 19 o 20 al inicio)
 *   • 15/03/2024, 15-03-2024
 *   • marzo 2024, enero de 2024
 */
const DATE_REGEX =
  /\b(?:19|20)\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de)?\s+\d{4}\b/i;

/**
 * Referencias a normativa específica chilena (y genérica):
 *   • DS 594, D.S. 40, decreto supremo 594
 *   • Ley 16.744, Ley N° 21.012
 *   • NCh 1258, ISO 45001, NFPA 70E
 *   • Art. 184, artículo 5
 */
const LAW_REF_REGEX =
  /\b(?:d\.?s\.?\s*\d+|decreto\s+supremo\s*\d+|ley\s+(?:n[°º]\s*)?\d+(?:[.,]\d+)?|nch\s*\d+|iso\s*\d+|nfpa\s*\d+|art(?:[íi]culo|\.?)?\s+\d+)\b/i;

// ────────────────────────────────────────────────────────────────────────
// Split en oraciones
// ────────────────────────────────────────────────────────────────────────

/**
 * Splitter por oraciones. Heurística simple: split en `. ! ?` seguido de
 * espacio o fin de cadena. Maneja casos comunes en español:
 *   • abreviaciones "Art." "DS." "D.S." → NO se splittea por ellas
 *   • números con punto decimal "3.5" → NO se splittea
 *
 * No es perfecto (NLP-grade splitting es un problema entero), pero
 * cubre el 95% de los casos productivos. Casos edge se manejan ampliando
 * la regex de "abreviaciones a preservar".
 */
const ABBREVIATIONS = [
  'art',
  'arts',
  'artículo',
  'inciso',
  'cap',
  'sec',
  'fig',
  'sr',
  'sra',
  'dr',
  'dra',
  'ds',
  'd.s',
  'p.ej',
  'ej',
];

export function splitSentences(text: string): ReadonlyArray<string> {
  if (!text.trim()) return [];

  // Estrategia: encontrar candidatos a fin-de-oración `[.!?]\s+[A-ZÁÉÍÓÚÑ]`
  // (punto seguido de mayúscula). Verificar que el contexto previo no
  // sea una abreviación.
  const result: string[] = [];
  let cursor = 0;

  // Iterar buscando puntos/exclamaciones/interrogaciones.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // ¿Sigue espacio + mayúscula? Si no, no es fin-de-oración.
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j]!)) j++;
    if (j >= text.length) {
      // Fin de cadena → corte definitivo.
      const sentence = text.slice(cursor, i + 1).trim();
      if (sentence) result.push(sentence);
      cursor = j;
      i = j - 1;
      continue;
    }
    const next = text[j]!;
    const isUpper = next >= 'A' && next <= 'Z';
    const isUpperLatin = 'ÁÉÍÓÚÑ'.includes(next);
    // Aceptar inicios de oración españoles `¡` `¿` como señal de nueva
    // oración (en español el signo de apertura sí indica nueva frase).
    const isSpanishOpener = next === '¿' || next === '¡';
    if (!isUpper && !isUpperLatin && !isSpanishOpener) continue;

    // ¿Es abreviación? Mirar la palabra previa.
    const slice = text.slice(cursor, i);
    const lastSpace = slice.lastIndexOf(' ');
    const lastWord = slice
      .slice(lastSpace + 1)
      .toLowerCase()
      .replace(/[.,;:]$/, '');
    if (ABBREVIATIONS.includes(lastWord)) continue;

    // ¿Es decimal? Mirar si el caracter previo y siguiente son dígitos
    // ("3.5" no debe cortarse).
    if (
      ch === '.' &&
      i > 0 &&
      /\d/.test(text[i - 1]!) &&
      /\d/.test(text[i + 1] ?? '')
    ) {
      continue;
    }

    const sentence = text.slice(cursor, i + 1).trim();
    if (sentence) result.push(sentence);
    cursor = j;
    i = j - 1;
  }

  // Cola — texto que sobró sin fin-de-oración terminal.
  if (cursor < text.length) {
    const tail = text.slice(cursor).trim();
    if (tail) result.push(tail);
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────
// API pública
// ────────────────────────────────────────────────────────────────────────

/**
 * Detecta si una oración contiene "patrones de alta especificidad" sin
 * citation adyacente. La adyacencia es laxa: basta con que la oración
 * contenga al menos un `[n]` en algún punto.
 *
 * Retorna `null` si la oración es benigna, o el trigger si es sospechosa.
 */
function detectSuspicion(sentence: string): SuspicionTrigger | null {
  const hasCitation = extractCitations(sentence).length > 0;
  if (hasCitation) return null;

  // Orden importa: chequear law_ref ANTES que number porque "DS 594"
  // contiene un número. Si match law_ref, atribuir a law_ref.
  if (LAW_REF_REGEX.test(sentence)) return 'law_ref_without_citation';
  if (DATE_REGEX.test(sentence)) return 'date_without_citation';
  if (PERCENTAGE_REGEX.test(sentence)) return 'percentage_without_citation';
  if (NUMBER_REGEX.test(sentence)) return 'number_without_citation';
  return null;
}

/**
 * Guard principal. Toma el texto crudo del LLM, lo splittea en oraciones
 * y bloquea si alguna contiene afirmación específica sin citation.
 *
 * Ejemplo:
 * ```ts
 * const r = guardAgainstHallucination(
 *   'La concentración máxima es 50 ppm según [1].'
 * );
 * // r.allow === true (tiene citation)
 *
 * const r2 = guardAgainstHallucination(
 *   'La concentración máxima es 50 ppm.'
 * );
 * // r2.allow === false, trigger === 'number_without_citation'
 * ```
 *
 * Caso especial: respuesta vacía o solo whitespace → `allow: true`
 * (no hay nada que validar; el caller decidirá qué hacer con un string
 * vacío en su lógica de fallback).
 */
export function guardAgainstHallucination(
  text: string,
): HallucinationGuardResult {
  if (!text.trim()) {
    return {
      allow: true,
      reason: 'empty response — nothing to validate',
      suspiciousSentences: [],
    };
  }

  const sentences = splitSentences(text);
  const suspicious: SuspiciousSentence[] = [];
  for (const s of sentences) {
    const trigger = detectSuspicion(s);
    if (trigger) {
      suspicious.push({ text: s, trigger });
    }
  }

  if (suspicious.length === 0) {
    return {
      allow: true,
      reason: 'ok',
      suspiciousSentences: [],
    };
  }

  const reasons = suspicious
    .map((s) => `[${s.trigger}] "${truncate(s.text, 80)}"`)
    .join('; ');
  return {
    allow: false,
    reason: `respuesta contiene ${suspicious.length} afirmación(es) específica(s) sin citation: ${reasons}`,
    suspiciousSentences: suspicious,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
