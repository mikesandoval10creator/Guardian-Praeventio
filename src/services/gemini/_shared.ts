// Praeventio Guard — TODO.md §12.5.1: helpers compartidos para el
// split de geminiBackend.ts (god-file 3070 líneas).
//
// Los sub-backends (medicalAnalysisBackend, eppBackend, etc.) importan
// estos helpers en lugar de re-implementarlos. La meta es que
// geminiBackend.ts quede como FACADE que solo re-exporta, sin código
// de negocio propio.
//
// Mantener este módulo MINIMAL — solo helpers genuinamente compartidos.

import * as Sentry from '@sentry/core';
import { logger } from '../../utils/logger.js';
import { redactPii } from '../observability/piiRedactor.js';

export const API_KEY = process.env.GEMINI_API_KEY;

/** Sleep helper for backoff. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff retry para llamadas Gemini que pueden retornar
 * 429 (rate limit) o 503 (transitorio). Otros errores propagan sin
 * retry — no enmascaramos fallos lógicos.
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
    } catch (error) {
      const status = (error as { status?: number }).status;
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

/**
 * Parse JSON body de una respuesta Gemini con error claro cuando
 * el modelo retorna undefined (safety-blocked, finish-reason non-STOP).
 * Default generic `any` para preservar el shape original.
 */
export function parseGeminiJson<T = unknown>(response: {
  text?: string;
}): T {
  if (!response.text) {
    throw new Error('gemini_empty_response');
  }
  // Strip ```json``` fences que Gemini a veces incluye con
  // responseMimeType: 'application/json'.
  const cleaned = response.text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned) as T;
}

/**
 * Sprint 20 Bucket A — single seam de PII redaction antes de cualquier
 * prompt que cruce hacia Vertex AI. Cumple Ley 21.719 art. 50.
 * RUT, email, CL phone, credit-card patterns, API keys → redactados.
 * Worker names + industry descriptions NO se redactan (el modelo los
 * necesita para razonar).
 *
 * Logging: solo count + categorías; nunca el raw prompt ni el redacted.
 */
export function redactPromptForVertex(
  prompt: string,
  action: string,
): string {
  const { redacted, count, categories } = redactPii(prompt);
  if (count > 0) {
    logger.info(
      `[pii.redaction] action=${action} count=${count} categories=${categories.join(',')}`,
    );
    try {
      Sentry.addBreadcrumb({
        category: 'pii.redaction',
        level: 'info',
        message: `Redacted ${count} PII token(s) before Vertex AI call`,
        data: { action, count, categories },
      });
    } catch {
      /* observability faults must not change control flow */
    }
  }
  return redacted;
}
