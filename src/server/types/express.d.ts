/**
 * Express Request augmentation (Sprint 49 - E.5 P2 H19).
 *
 * Centralizes the shape of the custom fields injected by Praeventio middlewares:
 * - `req.user` - populated by `verifyAuth` / Firebase auth middleware.
 * - `req.b2dKey` - populated by `b2dAuth` for B2D API tier auth.
 * - `req.validated` - populated by the generic `validate(schema)` middleware.
 *
 * Keeping the augmentation here lets route handlers and middlewares drop
 * `(req as any).user.uid`-style casts in favor of regular `req.user?.uid`.
 *
 * All properties are optional because they only exist after the corresponding
 * middleware has run; callers must still null-check.
 */
import 'express';

declare global {
  namespace Express {
    interface PraeventioAuthUser {
      uid: string;
      email?: string | null;
      name?: string | null;
      displayName?: string | null;
      admin?: boolean;
      role?: string;
      tier?: string;
      tenantId?: string;
      roles?: string[];
      subscriptionTier?: string;
    }

    interface PraeventioB2dKey {
      customerId: string;
      tier?: string;
      keyId?: string;
    }

    interface Request {
      user?: PraeventioAuthUser;
      b2dKey?: PraeventioB2dKey;
      // `validated` is set by `validate(schema)` to the parsed payload.
      // Typed as `unknown` so callers narrow with the schema's `z.infer<>`.
      validated?: unknown;
    }
  }
}

export {};
