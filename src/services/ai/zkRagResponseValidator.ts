// Praeventio Guard — Sprint 47 Fase C.10: Validator post-respuesta del LLM
// para el pipeline RAG sobre Zettelkasten.
//
// Cierra: Plan Fase C.10 "Contextual Assistant — validator que detecta
//         citas inventadas (cross-check con groundingNodeIds)".
//
// Reusa `checkAiResponse` de `aiGuardrails.ts` (Sprint 45 §155-160) pero
// configurado específicamente para RAG:
//
//   - requireCitations: SIEMPRE true (política RAG dura).
//   - groundingNodeIds: SIEMPRE obligatorio.
//   - Extra: parsea el texto crudo del LLM buscando [nodeId] y los
//     cross-checkea contra el set de grounding. Esto cubre el caso
//     donde el LLM emitió texto con citas pero no estructuró el campo
//     `citations` del response.
//
// 100% determinístico — NO invoca LLM.

import {
  checkAiResponse,
  type AiResponse,
  type CitationRef,
  type GuardrailCheckResult,
  type GuardrailViolation,
} from '../aiGuardrails/aiGuardrails.js';

// ────────────────────────────────────────────────────────────────────────
// Citation extraction
// ────────────────────────────────────────────────────────────────────────

// Coincide con [a-z0-9_-]{4,64} dentro de corchetes. Ej: [a1b2c3d4],
// [node-42], [proj_001]. Evita matches con texto genérico como
// [importante] limitando a hex/alfanum/underscore/hyphen y mínimo 4 chars.
const NODE_CITATION_RE = /\[([a-z0-9_-]{4,64})\]/gi;

/**
 * Extrae los ids citados en el texto crudo. Dedupe + preserve order.
 */
export function extractCitedNodeIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(NODE_CITATION_RE)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Validation result
// ────────────────────────────────────────────────────────────────────────

export type RagValidationViolation =
  | GuardrailViolation
  | 'no_inline_citations_in_text'
  | 'inline_citation_not_in_grounding'
  | 'fallback_response_with_citations';

export interface RagValidationResult {
  ok: boolean;
  violations: RagValidationViolation[];
  detail: Partial<Record<RagValidationViolation, string>>;
  /** Score 0..100 derivado del guardrail base + penalizaciones RAG. */
  qualityScore: number;
  /** Ids extraídos del texto (formato [id]). */
  citedNodeIdsInText: string[];
  /** Ids extraídos del texto que NO existen en grounding (alucinaciones). */
  invalidCitedNodeIds: string[];
}

export interface RagValidatorOptions {
  /** Set de ids permitidos (grounding). Obligatorio para validator RAG. */
  groundingNodeIds: ReadonlySet<string>;
  /** Largo máximo del texto. Default 4000. */
  maxLengthChars?: number;
  /** Frase canónica de "no info" — si aparece, validator afloja requireCitations. */
  fallbackPhrase?: string;
  /** Términos prohibidos extra. */
  forbiddenTerms?: ReadonlyArray<string>;
}

const DEFAULT_FALLBACK_PHRASE = 'no tengo info en el grafo del tenant';

// ────────────────────────────────────────────────────────────────────────
// validateRagResponse
// ────────────────────────────────────────────────────────────────────────

/**
 * Valida la respuesta del LLM dentro del pipeline RAG Zettelkasten.
 *
 *   - Si el texto contiene la `fallbackPhrase`, NO se exigen citas
 *     (es la respuesta canónica de "sin info"). Pero entonces la
 *     respuesta tampoco DEBE incluir citas — si tiene citas con frase
 *     fallback se reporta `fallback_response_with_citations`.
 *
 *   - Si NO es fallback, se exige ≥1 cita en formato [nodeId] dentro
 *     del texto. Cada cita se cross-checkea con groundingNodeIds.
 *
 *   - El campo estructurado `response.citations` (si está presente) se
 *     valida vía `checkAiResponse` de aiGuardrails.
 */
export function validateRagResponse(
  response: AiResponse,
  options: RagValidatorOptions,
): RagValidationResult {
  const fallbackPhrase = (options.fallbackPhrase ?? DEFAULT_FALLBACK_PHRASE).toLowerCase();
  const lowerText = response.text.toLowerCase();
  const isFallback = lowerText.includes(fallbackPhrase);

  // Inline citation extraction (independent of structured citations).
  const citedInText = extractCitedNodeIds(response.text);
  const invalidInText = citedInText.filter((id) => !options.groundingNodeIds.has(id));

  // Build structured-citation set from inline if not provided. This
  // makes `checkAiResponse` able to validate inline-only responses.
  const inlineAsStructured: CitationRef[] = citedInText.map((id) => ({ nodeId: id }));
  const structuredCitations =
    response.citations && response.citations.length > 0
      ? response.citations
      : inlineAsStructured;

  const baseResp: AiResponse = {
    text: response.text,
    citations: structuredCitations,
  };

  const baseResult: GuardrailCheckResult = checkAiResponse(baseResp, {
    // For fallback responses we relax the structured-citation requirement;
    // we still validate every other guardrail (length, PII, etc.).
    requireCitations: !isFallback,
    groundingNodeIds: options.groundingNodeIds,
    maxLengthChars: options.maxLengthChars,
    forbiddenTerms: options.forbiddenTerms,
  });

  const violations: RagValidationViolation[] = [...baseResult.violations];
  const detail: Partial<Record<RagValidationViolation, string>> = {
    ...baseResult.detail,
  };

  // RAG-specific checks.
  if (!isFallback) {
    if (citedInText.length === 0) {
      violations.push('no_inline_citations_in_text');
      detail.no_inline_citations_in_text =
        'La respuesta no contiene citas inline en formato [nodeId]. Política RAG exige citas embebidas en el texto.';
    }
    if (invalidInText.length > 0) {
      violations.push('inline_citation_not_in_grounding');
      detail.inline_citation_not_in_grounding =
        `Citas inline inventadas (no en grounding): ${invalidInText.join(', ')}`;
    }
  } else {
    // Fallback should not include citations — protect against the LLM
    // saying "no tengo info" but ALSO citing nodes (confusing/hallucinated).
    if (citedInText.length > 0) {
      violations.push('fallback_response_with_citations');
      detail.fallback_response_with_citations =
        `Respuesta fallback incluye citas inline (${citedInText.length}). Debe ser sólo texto canónico sin citas.`;
    }
  }

  const qualityScore = Math.max(0, 100 - violations.length * 20);

  return {
    ok: violations.length === 0,
    violations,
    detail,
    qualityScore,
    citedNodeIdsInText: citedInText,
    invalidCitedNodeIds: invalidInText,
  };
}
