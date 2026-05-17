// Praeventio Guard — Sprint K §158: Citation enforcement.
//
// Validación de citations sobre la respuesta del LLM contra una lista de
// sources provista por el caller (típicamente: nodos del Zettelkasten que
// fueron parte del grounding context).
//
// Reglas:
//   • Las citations son marcadores `[n]` donde `n` es un entero ≥ 1 que
//     indexa la lista de sources (1-based, no 0-based — es el formato que
//     los LLMs producen naturalmente).
//   • Si `policy === 'required'`, las afirmaciones factuales deben tener
//     citation. La detección de "afirmación factual" delega al
//     hallucinationGuard (split heurístico por oración). Aquí solo
//     validamos las citations PRESENTES contra las sources disponibles.
//   • Una citation `[n]` con `n > sources.length` o `n < 1` se reporta
//     como invalid (citation inventada).
//
// 100% determinístico. Sin LLM. Sin I/O.

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

import type { CitationPolicy } from './versionedPrompts.ts';

/**
 * Una source provista al LLM como parte del grounding context. Cualquier
 * `[n]` en la respuesta debe referir a un índice válido de esta lista
 * (1-based).
 */
export interface CitationSource {
  /** Identificador estable de la source (nodo Zettelkasten, URL, doc id). */
  readonly id: string;
  /** Título/etiqueta legible (opcional, solo para mensajes de error). */
  readonly label?: string;
}

/**
 * Resultado de `validateResponse`.
 *
 * `ok === true` solo cuando:
 *   • todas las citations presentes son válidas (1 ≤ n ≤ sources.length),
 *   • si `policy === 'required'`, hubo al menos 1 citation en la respuesta.
 *
 * `missingCitations`: posiciones (offset en el texto) donde se ESPERABA
 *   citation pero no hubo (en este módulo se considera "espera" cuando
 *   policy=required y no hay ninguna citation en absoluto — el detector
 *   por-oración vive en hallucinationGuard).
 *
 * `invalidCitations`: marcadores `[n]` que apuntan fuera de la lista de
 *   sources (n > sources.length o n < 1).
 */
export interface CitationValidationResult {
  ok: boolean;
  missingCitations: ReadonlyArray<MissingCitation>;
  invalidCitations: ReadonlyArray<InvalidCitation>;
}

export interface MissingCitation {
  /** Razón legible de por qué se considera missing. */
  reason: string;
}

export interface InvalidCitation {
  /** El número que el LLM escribió en `[n]`. */
  index: number;
  /** Offset en el texto donde apareció el marcador. */
  position: number;
  /** Razón legible. */
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────
// Implementación
// ────────────────────────────────────────────────────────────────────────

/**
 * Regex para detectar marcadores `[n]` donde n es un entero positivo.
 *
 * Diseñado conservadoramente:
 *   • `[1]`, `[12]`, `[ 3 ]` con espacios → match
 *   • `[abc]`, `[1,2]`, `[]` → NO match (no son citations)
 *   • `[1][2]` → match a dos citations distintas (cada marcador en su grupo)
 */
const CITATION_REGEX = /\[\s*(\d+)\s*\]/g;

/**
 * Extrae todas las citations `[n]` de un texto.
 *
 * Exportado para testabilidad y para que `hallucinationGuard` pueda
 * reusar la misma lógica sin duplicar regex.
 */
export function extractCitations(
  text: string,
): ReadonlyArray<{ index: number; position: number }> {
  const out: Array<{ index: number; position: number }> = [];
  // Reset lastIndex porque el regex es global (estado entre invocaciones).
  CITATION_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_REGEX.exec(text)) !== null) {
    const raw = m[1];
    if (!raw) continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) {
      out.push({ index: n, position: m.index });
    }
  }
  return out;
}

/**
 * Valida las citations de una respuesta contra una lista de sources.
 *
 * @param text   respuesta cruda del LLM
 * @param sources lista de sources que se le presentaron al LLM
 * @param policy política heredada del `VersionedPrompt`
 *
 * Ejemplo:
 * ```ts
 * const r = validateResponse(
 *   'Según el DS 594 [1] se requiere ventilación.',
 *   [{ id: 'node-ds594' }],
 *   'required'
 * );
 * // r.ok === true, r.invalidCitations === []
 * ```
 *
 * Ejemplo con citation inventada:
 * ```ts
 * const r = validateResponse(
 *   'Texto [5] inventado.',
 *   [{ id: 'a' }],
 *   'required'
 * );
 * // r.ok === false, r.invalidCitations[0].index === 5
 * ```
 */
export function validateResponse(
  text: string,
  sources: ReadonlyArray<CitationSource>,
  policy: CitationPolicy,
): CitationValidationResult {
  const found = extractCitations(text);

  const invalidCitations: InvalidCitation[] = [];
  for (const c of found) {
    if (c.index < 1) {
      invalidCitations.push({
        index: c.index,
        position: c.position,
        reason: `citation [${c.index}] inválida: índice debe ser ≥ 1`,
      });
      continue;
    }
    if (c.index > sources.length) {
      invalidCitations.push({
        index: c.index,
        position: c.position,
        reason:
          `citation [${c.index}] no existe en la lista de sources ` +
          `(solo ${sources.length} disponibles).`,
      });
    }
  }

  const missingCitations: MissingCitation[] = [];
  if (policy === 'required' && found.length === 0) {
    missingCitations.push({
      reason:
        'política requiere citations pero la respuesta no incluyó ninguna ' +
        '(buscado patrón [n] con n entero positivo).',
    });
  }

  return {
    ok: invalidCitations.length === 0 && missingCitations.length === 0,
    missingCitations,
    invalidCitations,
  };
}

/**
 * Helper para construir un mensaje legible de error a partir del
 * resultado de validación. Útil para logs estructurados y mensajes
 * de fallback que se devuelven al caller.
 */
export function describeValidationFailure(
  result: CitationValidationResult,
): string {
  if (result.ok) return 'ok';
  const parts: string[] = [];
  for (const m of result.missingCitations) parts.push(m.reason);
  for (const i of result.invalidCitations) parts.push(i.reason);
  return parts.join('; ');
}
