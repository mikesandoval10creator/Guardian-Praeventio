// Praeventio Guard — §12.5.1 split step 2: Gemini PII redaction seam.
//
// Extraído de `services/geminiBackend.ts` (2924 LOC → módulos). Segunda
// extracción del split. Contiene el seam único de redacción PII antes
// de que cualquier prompt salga del proceso hacia Vertex AI.
//
// Sprint 20 ninth wave (Bucket A) — cierra STRIDE TM-I03.
//
// Vertex AI es trusted processor (signed BAA, region selection), pero
// Ley 21.719 art. 50 sigue pidiéndonos minimizar la superficie de PII.
// Strippeamos RUT chileno, email, phone CL, runs credit-card-shaped, y
// prefijos obvios de API-key. Nombres de trabajadores + descripciones
// de industria/diagnóstico se mantienen — el modelo los necesita para
// razonar. Ver `services/observability/piiRedactor.ts` para el header
// completo de la lógica de redacción.
//
// Logeamos + breadcrumb solo el COUNT y CATEGORIES, nunca el prompt
// crudo ni el valor redactado, así Sentry tampoco ve la PII.
// El breadcrumb es best-effort; si Sentry no está inicializado
// swallow el error para no afectar el request path.

import * as Sentry from '@sentry/core';
import { logger } from '../../utils/logger';
import { redactPii } from '../observability/piiRedactor';

/**
 * Aplica redacción PII al prompt antes de mandarlo a Vertex AI.
 *
 * Devuelve el prompt redactado. Si hubo redacción, emite log + Sentry
 * breadcrumb con count + categorías (NUNCA con el valor crudo).
 *
 * El breadcrumb falla silently si Sentry no está inicializado.
 */
export function redactPromptForVertex(prompt: string, action: string): string {
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
