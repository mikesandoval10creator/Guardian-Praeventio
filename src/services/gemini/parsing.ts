// Praeventio Guard — §12.5.1 split step 3: Gemini response parsing + retry.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Tercera
// extracción del split. Contiene 2 helpers genéricos:
//
//   1. `parseGeminiJson<T>` — parse seguro del body JSON de un Gemini
//      `generateContent` response. Replaces 27+ callsites previas.
//   2. `withExponentialBackoff<T>` — retry exponencial para 429/503.
//      Solo reintenta esos status codes (rate-limit / unavailable);
//      cualquier otro error propaga inmediato.
//
// Funciones genéricas reutilizables — no contienen lógica de prompts.

import { logger } from '../../utils/logger';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Parse the JSON body of a Gemini `generateContent` response.
 *
 * The SDK types `response.text` as `string | undefined` — `undefined`
 * happens when the model produced no text (safety-blocked, finish reason
 * non-STOP, or empty completion). Surfaceamos eso como error explícito
 * en vez de dejar que `JSON.parse(undefined)` tire `SyntaxError`
 * (mucho más difícil de atribuir a "el modelo no devolvió nada").
 *
 * Default generic es `any` (no `unknown`) para preservar el return-type
 * original — los downstream callers que hacen spread del resultado
 * (`{ ...auditResult, compliance, timestamp }`) keep compilando sin
 * pasar un generic. Callers que quieren tipo estricto pasan explícito.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGeminiJson<T = any>(response: { text?: string }): T {
  if (!response.text) {
    throw new Error('gemini_empty_response');
  }
  return JSON.parse(response.text) as T;
}

/**
 * Reintenta `operation()` con exponential backoff cuando falla con
 * status 429 (rate-limit) o 503 (unavailable). Cualquier otro error
 * propaga inmediato. Delays: 1s, 2s, 4s, 8s, 16s (con baseDelay=1000).
 */
export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000,
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (retries >= maxRetries || (status !== 429 && status !== 503)) {
        throw error;
      }
      const delay = baseDelay * Math.pow(2, retries);
      logger.warn(
        `Rate limited. Retrying in ${delay}ms... (Attempt ${retries + 1}/${maxRetries})`,
      );
      await sleep(delay);
      retries++;
    }
  }
}
