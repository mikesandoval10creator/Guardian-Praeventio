// Praeventio Guard — Sprint 28 Bucket B3.
//
// Transversal Zod request validation middleware. Closes audit hallazgo H17:
// previously only `POST /api/erp/sync` (in `routes/misc.ts`) used Zod; the
// rest of the surface area validated request bodies with hand-rolled
// `typeof` checks. The result was 376 `as any/unknown` casts in `src/` and
// inconsistent error envelopes per route. This factory unifies both:
//
//   • One canonical 400 envelope (`{ error: 'invalid_payload', issues }`)
//     so clients can reliably switch on `error === 'invalid_payload'`.
//   • Validated, typed payloads attached to `req.validated` (typed via the
//     module augmentation at the bottom of this file).
//   • `logger.warn('validation_failed', â€¦)` on every reject so abuse
//     patterns (uid spamming malformed bodies, scanners, etc.) show up
//     in observability.
//
// Usage:
//
//   const schema = z.object({ projectId: z.string().min(1) });
//   router.post('/foo', verifyAuth, validate(schema), (req, res) => {
//     const { projectId } = req.validated as z.infer<typeof schema>;
//     â€¦
//   });
//
// IMPORTANT — coexistence with legacy `typeof` checks. Sprint 28 only
// adds this middleware as a FIRST barrier. Existing handlers still keep
// their hand-rolled checks (TODO: remove in Sprint 29) so a defect in the
// schema can't regress runtime behavior. The middleware logs at warn but
// returns 400 immediately; if it passes, the legacy guard runs anyway.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

export type ValidateSource = 'body' | 'query' | 'params';

/**
 * Build an Express middleware that parses `req[source]` with the given Zod
 * schema. On success, the parsed (post-transform) payload is exposed as
 * `req.validated` for downstream handlers; on failure the response is
 * `400 { error: 'invalid_payload', issues }`.
 *
 * The `logger.warn` emission tags the request path and (when authenticated
 * via `verifyAuth` upstream) the calling uid so security can correlate
 * malformed-body bursts to a specific token.
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  source: ValidateSource = 'body',
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = (req as unknown as Record<ValidateSource, unknown>)[source];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const uid: string | undefined = req.user?.uid;
      logger.warn('validation_failed', {
        path: req.path,
        source,
        method: req.method,
        uid: uid ?? null,
        // `issues` is intentionally short — we log the array (Zod tops
        // out at ~kB for normal payloads) and rely on log aggregation
        // truncation rather than guessing a cutoff here.
        issues: parsed.error.issues,
      });
      res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
      return;
    }
    // Stash the post-transform/post-default value so the handler doesn't
    // have to re-parse. We keep `req.body|query|params` untouched so any
    // legacy code that reads them still sees the original wire payload.
    req.validated = parsed.data;
    next();
  };
}

// Type augmentation for `req.validated` lives in
// src/server/types/express.d.ts (PraeventioAuthUser, PraeventioB2dKey,
// validated?: unknown). Consumers should narrow with
// `req.validated as z.infer<typeof mySchema>`.
