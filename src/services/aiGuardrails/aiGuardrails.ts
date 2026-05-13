// Praeventio Guard — Sprint 45 §155-160: Guardrails IA + prompts versionados
// + regresión + dataset eval + control alucinaciones + citas.
//
// Cierra §155 (guardrails), §156 (prompts versionados), §157 (regresión),
// §158 (dataset eval), §159 (control alucinaciones), §160 (citas) de la
// 2da tanda usuario.
//
// 100% determinístico. NO invoca LLMs en este motor; es la capa de
// seguridad que envuelve cualquier llamada a Gemini/Claude antes de
// enviar prompt y al recibir respuesta.

// ────────────────────────────────────────────────────────────────────────
// Prompt versioning
// ────────────────────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: string;
  /** Semver del prompt — bump cuando cambias contenido. */
  version: string;
  /** Nombre human-readable. */
  name: string;
  /** Texto del prompt con placeholders {{var}}. */
  template: string;
  /** Lista de variables esperadas. */
  expectedVars: string[];
  /** Use case. */
  category: 'rag' | 'classification' | 'summarization' | 'assistant' | 'classification_safety';
  /** Si requiere citation policy. */
  requiresCitations: boolean;
}

export class PromptValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PromptValidationError';
  }
}

/**
 * Renderiza un prompt versionado validando que TODAS las variables
 * esperadas estén provistas. Sin var → error (no llenar con string vacío
 * silenciosamente — eso causa prompts deformes y alucinaciones).
 */
export function renderPrompt(
  template: PromptTemplate,
  vars: Record<string, string | number | boolean>,
): string {
  for (const expected of template.expectedVars) {
    if (!(expected in vars)) {
      throw new PromptValidationError(
        `prompt ${template.id}@${template.version}: missing variable '${expected}'`,
      );
    }
  }
  let out = template.template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, String(v));
  }
  // Detectar placeholders no resueltos
  const unresolved = out.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g);
  if (unresolved) {
    throw new PromptValidationError(
      `prompt ${template.id}@${template.version}: unresolved placeholders ${unresolved.join(', ')}`,
    );
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Response validation (anti-alucinación)
// ────────────────────────────────────────────────────────────────────────

export interface CitationRef {
  /** ID del nodo del Zettelkasten que el LLM citó. */
  nodeId: string;
  /** Snippet copiado del nodo (para verificación). */
  snippet?: string;
}

export interface AiResponse {
  text: string;
  /** Citas que el LLM emitió. */
  citations?: CitationRef[];
}

export type GuardrailViolation =
  | 'missing_citations_when_required'
  | 'citation_not_in_grounding'
  | 'response_too_long'
  | 'contains_pii'
  | 'contains_medical_diagnosis_phrase'
  | 'contains_legal_advice_phrase'
  | 'contains_forbidden_term';

export interface GuardrailCheckResult {
  ok: boolean;
  violations: GuardrailViolation[];
  detail: Record<GuardrailViolation, string>;
  /** Score 0..100 (100 = pasa todos los checks). */
  qualityScore: number;
}

export interface GuardrailOptions {
  requireCitations: boolean;
  /** Nodos disponibles en el contexto pasado al LLM — para verificar que las
   * citaciones existan en el grounding (anti-hallucination). */
  groundingNodeIds?: ReadonlySet<string>;
  maxLengthChars?: number;
  /** PII patterns a detectar. */
  forbiddenTerms?: ReadonlyArray<string>;
}

// Patrones que NO debe emitir Guardian Praeventio (ADR 0012 — no
// diagnóstico; sí asistencia educativa).
const MEDICAL_DIAGNOSIS_PHRASES = [
  /\b(usted|tú|el paciente|el trabajador) (tiene|padece|sufre de)\b/i,
  /\bdiagnóstico (definitivo|confirmado)\b/i,
  /\bprescribo\b/i,
];

const LEGAL_ADVICE_PHRASES = [
  /\bdebe demandar\b/i,
  /\bel tribunal fallará a (su|tu) favor\b/i,
  /\bgarantía legal de\b/i,
];

const PII_PATTERNS = [
  // RUT chileno
  /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/,
  // Email
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
  // Phone E.164-ish
  /\+\d{1,3}\s?\d{6,12}/,
];

export function checkAiResponse(
  response: AiResponse,
  options: GuardrailOptions,
): GuardrailCheckResult {
  const violations: GuardrailViolation[] = [];
  const detail: Partial<Record<GuardrailViolation, string>> = {};

  if (options.requireCitations) {
    if (!response.citations || response.citations.length === 0) {
      violations.push('missing_citations_when_required');
      detail.missing_citations_when_required = 'Política requiere ≥1 cita pero la respuesta no incluyó ninguna.';
    } else if (options.groundingNodeIds) {
      const invalid = response.citations.filter((c) => !options.groundingNodeIds!.has(c.nodeId));
      if (invalid.length > 0) {
        violations.push('citation_not_in_grounding');
        detail.citation_not_in_grounding = `Citas inventadas (no en grounding): ${invalid.map((c) => c.nodeId).join(', ')}`;
      }
    }
  }

  const maxLen = options.maxLengthChars ?? 4000;
  if (response.text.length > maxLen) {
    violations.push('response_too_long');
    detail.response_too_long = `Largo ${response.text.length} > max ${maxLen}.`;
  }

  for (const re of PII_PATTERNS) {
    if (re.test(response.text)) {
      violations.push('contains_pii');
      detail.contains_pii = 'Detectado patrón PII (RUT/email/teléfono).';
      break;
    }
  }

  for (const re of MEDICAL_DIAGNOSIS_PHRASES) {
    if (re.test(response.text)) {
      violations.push('contains_medical_diagnosis_phrase');
      detail.contains_medical_diagnosis_phrase = 'Frase de diagnóstico médico (viola ADR 0012).';
      break;
    }
  }

  for (const re of LEGAL_ADVICE_PHRASES) {
    if (re.test(response.text)) {
      violations.push('contains_legal_advice_phrase');
      detail.contains_legal_advice_phrase = 'Frase de asesoría legal vinculante.';
      break;
    }
  }

  if (options.forbiddenTerms) {
    for (const term of options.forbiddenTerms) {
      if (response.text.toLowerCase().includes(term.toLowerCase())) {
        violations.push('contains_forbidden_term');
        detail.contains_forbidden_term = `Término prohibido: '${term}'`;
        break;
      }
    }
  }

  const qualityScore = Math.max(0, 100 - violations.length * 25);

  return {
    ok: violations.length === 0,
    violations,
    detail: detail as Record<GuardrailViolation, string>,
    qualityScore,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Regression / dataset eval (§157-158)
// ────────────────────────────────────────────────────────────────────────

export interface EvalCase {
  id: string;
  input: Record<string, string | number | boolean>;
  /** Texto esperado (substring match) o regex. */
  expectMatches: string | RegExp;
  /** Si la respuesta NO debe matchear estos. */
  forbiddenMatches?: ReadonlyArray<string | RegExp>;
}

export interface EvalRunResult {
  caseId: string;
  passed: boolean;
  reason: string;
}

export interface EvalReport {
  promptId: string;
  promptVersion: string;
  totalCases: number;
  passed: number;
  failed: number;
  passRate: number; // 0..1
  results: EvalRunResult[];
}

/**
 * Evalúa un conjunto de casos contra un "responder" inyectado (típicamente
 * un mock o la respuesta real del LLM). Genera reporte con pass rate.
 */
export async function runEvalSuite(
  prompt: PromptTemplate,
  cases: ReadonlyArray<EvalCase>,
  responder: (renderedPrompt: string, caseId: string) => Promise<string>,
): Promise<EvalReport> {
  const results: EvalRunResult[] = [];
  for (const c of cases) {
    let passed = false;
    let reason = '';
    try {
      const rendered = renderPrompt(prompt, c.input);
      const response = await responder(rendered, c.id);
      const matchesExpected =
        typeof c.expectMatches === 'string'
          ? response.includes(c.expectMatches)
          : c.expectMatches.test(response);
      if (!matchesExpected) {
        reason = `respuesta no contiene patrón esperado`;
      } else {
        const matchedForbidden = c.forbiddenMatches?.find((f) =>
          typeof f === 'string' ? response.includes(f) : f.test(response),
        );
        if (matchedForbidden) {
          reason = `respuesta contiene patrón prohibido: ${matchedForbidden}`;
        } else {
          passed = true;
          reason = 'ok';
        }
      }
    } catch (e) {
      reason = `error: ${(e as Error).message}`;
    }
    results.push({ caseId: c.id, passed, reason });
  }
  const passedCount = results.filter((r) => r.passed).length;
  return {
    promptId: prompt.id,
    promptVersion: prompt.version,
    totalCases: cases.length,
    passed: passedCount,
    failed: cases.length - passedCount,
    passRate: cases.length === 0 ? 1 : passedCount / cases.length,
    results,
  };
}
