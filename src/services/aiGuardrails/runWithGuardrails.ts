// Praeventio Guard — Sprint K §155: Wrapper de guardrails sobre el adapter
// de Gemini (y cualquier AiAdapter).
//
// Diseño:
//   • NO modifica la API pública de `geminiAdapter` ni de `AiAdapter`.
//   • Es un wrapper opt-in: los callers que quieran guardrails llaman
//     `runWithGuardrails(...)`. Los callers existentes que llaman a
//     `geminiAdapter.generate(...)` directamente siguen funcionando sin
//     cambio (compatibilidad).
//   • Si la validación falla, retorna un fallback determinístico + emite
//     un evento estructurado `ai_guardrail_blocked` para observabilidad.
//
// Migración recomendada:
//   1. Identificar call sites a `geminiAdapter.generate()` o `getAiAdapter()`
//      en `src/services/ai/`, `src/services/geminiBackend.ts`, etc.
//   2. Cambiar a `runWithGuardrails({ promptId, version, inputs, sources })`.
//   3. El wrapper resuelve el prompt canónico, renderiza placeholders,
//      llama al adapter, valida la respuesta, y devuelve `{ ok, text, ... }`.
//
// Callers que NO migran siguen funcionando — este módulo NO se inyecta
// como middleware obligatorio.

// ────────────────────────────────────────────────────────────────────────
// Imports
// ────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger.ts';
import type {
  AiAdapter,
  AiGenerateRequest,
  AiGenerateResponse,
} from '../ai/aiAdapter.ts';
import { getAiAdapter } from '../ai/index.ts';
import {
  type CitationSource,
  validateResponse,
  describeValidationFailure,
} from './citationValidator.ts';
import { guardAgainstHallucination } from './hallucinationGuard.ts';
import {
  type VersionedPrompt,
  getPrompt,
} from './versionedPrompts.ts';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Inputs para `runWithGuardrails`.
 *
 * `inputs` son las variables `{{var}}` del prompt body. El wrapper hace
 * un replace literal — si el prompt esperaba `{{question}}` y el caller
 * no lo provee, queda como literal `{{question}}` en el texto enviado al
 * LLM. Eso se detecta como bug en los tests (los call sites deben pasar
 * inputs completos).
 *
 * `sources` se pasa al validator. Vacío = no hay grounding (válido para
 * prompts con `citations: 'optional'`).
 *
 * `adapter` es opcional — si no se provee, se usa el facade
 * `getAiAdapter()`. Tests inyectan adapters mock.
 *
 * `modelOverride` permite forzar un modelo distinto al default del adapter
 * (útil cuando un prompt funciona mejor con una variante específica).
 */
export interface RunWithGuardrailsInput {
  promptId: string;
  version: string;
  inputs: Readonly<Record<string, string | number | boolean>>;
  sources: ReadonlyArray<CitationSource>;
  adapter?: AiAdapter;
  modelOverride?: string;
  /**
   * Override del modelo por defecto. Si no se especifica, se usa
   * `gemini-3-flash-preview` (alineado con el call shape histórico de
   * geminiBackend.ts).
   */
  temperature?: number;
}

/**
 * Resultado del wrapper.
 *
 *   - `ok === true`: la respuesta pasa todos los guardrails. `text` es la
 *     respuesta del LLM tal cual.
 *   - `ok === false`: algún guardrail bloqueó. `text` es el fallback
 *     determinístico (string seguro, no-comprometedor). `blockedReason`
 *     explica qué disparó el bloqueo.
 *
 * El response RAW del adapter está siempre disponible en `raw` para
 * callers que quieren inspeccionar (typing, finishReason, usage).
 */
export interface RunWithGuardrailsResult {
  ok: boolean;
  text: string;
  blockedReason?: string;
  prompt: VersionedPrompt;
  raw?: AiGenerateResponse;
}

/**
 * String de fallback que se devuelve cuando los guardrails bloquean.
 *
 * Diseñado para ser:
 *   • Honesto: dice explícitamente que no hay respuesta validada.
 *   • Seguro: no inventa información ni redirige a fuentes externas
 *     no verificadas.
 *   • Accionable: invita al usuario a consultar al especialista humano.
 *
 * Exportado para que los tests aserten igualdad exacta.
 */
export const GUARDRAIL_FALLBACK_TEXT =
  'No puedo confirmar una respuesta validada para esta consulta. ' +
  'Por favor consulta con tu Encargado de Prevención o revisa la ' +
  'documentación normativa aplicable.';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Resuelve placeholders `{{var}}` del prompt body con los inputs provistos.
 *
 * Estrategia simple: replace literal de cada `{{key}}` por `String(value)`.
 * Llaves no provistas quedan como literal `{{key}}` en el resultado —
 * útil para que el test detecte el bug rápido en lugar de mandar un
 * prompt malformado al LLM (que produciría una alucinación silenciosa).
 *
 * Exportado para testabilidad.
 */
export function renderPromptBody(
  body: string,
  inputs: Readonly<Record<string, string | number | boolean>>,
): string {
  let out = body;
  for (const [k, v] of Object.entries(inputs)) {
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
}

/**
 * Detecta placeholders no resueltos `{{xxx}}` en el texto. Útil para
 * fallar fuerte antes de mandar un prompt incompleto al LLM.
 */
export function findUnresolvedPlaceholders(
  rendered: string,
): ReadonlyArray<string> {
  const re = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g;
  return rendered.match(re) ?? [];
}

// ────────────────────────────────────────────────────────────────────────
// API pública
// ────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta una llamada al LLM con guardrails:
 *
 *   1. Resuelve el `VersionedPrompt` canónico desde el catálogo.
 *   2. Renderiza placeholders con `inputs`.
 *   3. Llama al adapter (mock en tests, real en prod).
 *   4. Valida la respuesta:
 *        a. citationValidator — citations existen + son válidas
 *        b. hallucinationGuard — afirmaciones específicas tienen citation
 *   5. Si pasa, retorna el texto del LLM.
 *   6. Si falla, retorna fallback + emite log estructurado.
 *
 * Esta función NUNCA lanza por validación fallida — devuelve `ok: false`.
 * SÍ lanza por:
 *   • prompt id/version no existe (UnknownPromptError),
 *   • placeholders sin resolver (configuración mala — bug del call site),
 *   • adapter.generate() arroja (error del provider — propagado).
 *
 * Ejemplo:
 * ```ts
 * const r = await runWithGuardrails({
 *   promptId: 'rag.zk.query',
 *   version: '2.0.0',
 *   inputs: { question: '¿qué EPP?', context: 'arnés, casco' },
 *   sources: [{ id: 'node-ds44' }],
 * });
 * if (r.ok) console.log(r.text);
 * else console.warn('blocked:', r.blockedReason);
 * ```
 */
export async function runWithGuardrails(
  input: RunWithGuardrailsInput,
): Promise<RunWithGuardrailsResult> {
  const prompt = getPrompt(input.promptId, input.version);
  const rendered = renderPromptBody(prompt.body, input.inputs);

  const unresolved = findUnresolvedPlaceholders(rendered);
  if (unresolved.length > 0) {
    throw new Error(
      `runWithGuardrails: prompt '${prompt.id}@${prompt.version}' tiene ` +
        `placeholders sin resolver: ${unresolved.join(', ')}. ` +
        `Provee los inputs faltantes.`,
    );
  }

  const adapter = input.adapter ?? getAiAdapter();
  const request: AiGenerateRequest = {
    model: input.modelOverride ?? 'gemini-3-flash-preview',
    prompt: rendered,
    maxOutputTokens: prompt.maxTokens,
    temperature: input.temperature,
    responseMimeType: 'text/plain',
  };

  const raw = await adapter.generate(request);
  const text = raw.text ?? '';

  // ── Validación 1: citations ───────────────────────────────────────────
  const citationResult = validateResponse(text, input.sources, prompt.citations);
  if (!citationResult.ok) {
    const reason = describeValidationFailure(citationResult);
    logBlocked({
      promptId: prompt.id,
      promptVersion: prompt.version,
      reason,
      stage: 'citation',
      provider: raw.provider,
    });
    return {
      ok: false,
      text: GUARDRAIL_FALLBACK_TEXT,
      blockedReason: `citation: ${reason}`,
      prompt,
      raw,
    };
  }

  // ── Validación 2: hallucination guard ─────────────────────────────────
  if (prompt.citations === 'required') {
    const hallucinationResult = guardAgainstHallucination(text);
    if (!hallucinationResult.allow) {
      logBlocked({
        promptId: prompt.id,
        promptVersion: prompt.version,
        reason: hallucinationResult.reason,
        stage: 'hallucination',
        provider: raw.provider,
      });
      return {
        ok: false,
        text: GUARDRAIL_FALLBACK_TEXT,
        blockedReason: `hallucination: ${hallucinationResult.reason}`,
        prompt,
        raw,
      };
    }
  }

  return {
    ok: true,
    text,
    prompt,
    raw,
  };
}

interface BlockEvent {
  promptId: string;
  promptVersion: string;
  reason: string;
  stage: 'citation' | 'hallucination';
  provider: string;
}

function logBlocked(event: BlockEvent): void {
  logger.warn('ai_guardrail_blocked', {
    event: 'ai_guardrail_blocked',
    prompt_id: event.promptId,
    prompt_version: event.promptVersion,
    stage: event.stage,
    provider: event.provider,
    reason: event.reason,
  });
}
