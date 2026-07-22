// Praeventio Guard — Round 16 R5 Phase 1 split + Sprint 19 F-B05.
//
// Firebase Auth middleware. Verifies the Bearer ID token attached to the
// request, attaches the decoded token to `req.user`, and short-circuits with
// HTTP 401 on missing / malformed / invalid tokens. firebase-admin is
// imported normally — its initialization happens at server boot time in
// server.ts, so by the time this middleware runs it is already configured.
//
// Behavior contract (covered by I3 supertest harness in src/__tests__/server):
//   • 401 + { error: "Unauthorized: No token provided" } when Authorization
//     header is missing OR uses a scheme other than "Bearer " (or "E2E " in
//     non-production E2E mode).
//   • 401 + { error: "Unauthorized: Invalid token" } when verifyIdToken
//     throws (malformed / expired / revoked token).
//   • Calls next() with `req.user = decodedToken` on success.
//
// Sprint 19 — F-B05: E2E_MODE guard.
//   When `process.env.E2E_MODE === '1'` AND `process.env.NODE_ENV !== 'production'`,
//   the middleware additionally accepts `Authorization: E2E <secret>:<uid>` headers
//   where `<secret>` matches `process.env.E2E_TEST_SECRET`. On match it populates
//   req.user with a deterministic fixture so Playwright specs never need a real
//   Firebase token. Production NODE_ENV makes the guard inert.
//
//   A startup-time guard throws if both `NODE_ENV=production` and `E2E_MODE=1`
//   are set — that combination is a configuration error and we refuse to boot.

import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';
import { safeSecretEqual } from './safeSecretEqual.js';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

export function endpointForSecurityTelemetry(url: string): string {
  const pathname = String(url ?? '').split('?')[0];
  return pathname
    .replace(
      /\/api\/health-vault\/view\/[^/]+\/file\/[^/]+/g,
      '/api/health-vault/view/:grantId/file/:recordId',
    )
    .replace(
      /\/api\/health-vault\/(view|share)\/[^/]+/g,
      '/api/health-vault/$1/:grantId',
    );
}

// Startup guard: prod + E2E_MODE simultaneously is a CONFIG ERROR.
// Module-level throw means the server refuses to boot in this state, even
// if a misconfigured deploy accidentally injects E2E_MODE=1 into Cloud Run.
if (process.env.NODE_ENV === 'production' && process.env.E2E_MODE === '1') {
  throw new Error(
    'FATAL: NODE_ENV=production with E2E_MODE=1 is a configuration error. ' +
      'E2E_MODE bypasses Firebase auth and must NEVER be enabled in production.',
  );
}

const isE2EModeEnabled = (): boolean =>
  process.env.E2E_MODE === '1' && process.env.NODE_ENV !== 'production';

// TODO.md §12.2.9 — Session expiration absoluta (8h).
// Override por env para tests (1h en CI, 8h por defecto en prod).
export const MAX_SESSION_HOURS = (() => {
  const raw = process.env.MAX_SESSION_HOURS;
  if (!raw) return 8;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : 8;
})();
export const MAX_SESSION_MS = MAX_SESSION_HOURS * 3_600_000;

export const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  // No header at all → 401 regardless of mode.
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  // E2E_MODE branch: only active when NODE_ENV !== 'production'. Accepts
  // "E2E <secret>:<uid>" tokens signed with E2E_TEST_SECRET.
  if (isE2EModeEnabled() && authHeader.startsWith('E2E ')) {
    const token = authHeader.slice('E2E '.length);
    const secret = process.env.E2E_TEST_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ error: 'E2E_MODE enabled but E2E_TEST_SECRET missing' });
    }
    const sepIdx = token.indexOf(':');
    const providedSecret = sepIdx === -1 ? token : token.slice(0, sepIdx);
    const providedUid = sepIdx === -1 ? '' : token.slice(sepIdx + 1);
    if (!safeSecretEqual(providedSecret, secret)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid E2E secret' });
    }
    req.user = {
      uid: providedUid || 'e2e-user-001',
      email: 'e2e@praeventio.test',
      displayName: 'E2E Test User',
      tenantId: 'e2e-tenant',
      // The E2E fixture user IS a supervisor (mirrors DEFAULT_TEST_USER.roles[0]
      // in tests/e2e/fixtures/auth.ts). Without a server-side role, every
      // role-gated endpoint (emergency-brigade writes, zone define, …) 403s and
      // becomes untestable in the full-stack E2E harness. E2E-only branch —
      // already gated by isE2EModeEnabled() + non-production.
      role: 'supervisor',
    };
    return next();
  }

  // Production / default path: Bearer scheme only.
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    // Sprint 39 Fase B.2: checkRevoked=true valida `tokensValidAfterTime`
    // en cada request. Cuando un usuario se desactiva via deactivateUser()
    // → admin.auth().revokeRefreshTokens(uid), todos los tokens emitidos
    // antes del revoke quedan inmediatamente inválidos sin esperar la
    // expiración natural de 1h. Cierra IMPLEMENTATION_ROADMAP 0.6 (riesgo
    // activo: ex-empleados con acceso por hasta 1h post-desactivación).
    const decodedToken = await admin.auth().verifyIdToken(token, true);

    // TODO.md §12.2.9 — Session expiration absoluta (8h). El check
    // built-in de Firebase solo valida que el TOKEN no esté expirado
    // (1h por defecto) ni revocado. Pero un usuario puede sostener una
    // sesión indefinidamente refrescando tokens cada hora — perdiendo
    // re-auth cuando alguien deja el dispositivo desbloqueado en una
    // faena. Forzamos MAX_SESSION_HOURS desde `auth_time` (cuándo el
    // usuario ingresó password/biometría originalmente).
    const authTimeSec =
      typeof (decodedToken as { auth_time?: number }).auth_time === 'number'
        ? (decodedToken as { auth_time: number }).auth_time
        : null;
    if (authTimeSec !== null) {
      const sessionAgeMs = Date.now() - authTimeSec * 1000;
      if (sessionAgeMs > MAX_SESSION_MS) {
        logger.warn('auth_session_expired', {
          endpoint: endpointForSecurityTelemetry(req.originalUrl || req.url),
          method: req.method,
          ageHours: Math.round(sessionAgeMs / 3_600_000),
        });
        return res.status(401).json({
          error: 'Unauthorized: Session expired — please re-authenticate',
          reason: 'session_age_exceeded',
          maxSessionHours: MAX_SESSION_HOURS,
        });
      }
    }

    // DecodedIdToken has many fields (iat, auth_time, firebase, …). We
    // narrow into our PraeventioAuthUser shape (declared in
    // src/server/types/express.d.ts) so downstream handlers see the
    // documented surface.
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email ?? null,
      name: (decodedToken.name as string | undefined) ?? null,
      admin: Boolean((decodedToken as { admin?: boolean }).admin),
      role: (decodedToken as { role?: string }).role,
      tier: (decodedToken as { tier?: string }).tier,
      tenantId: (decodedToken as { tenantId?: string }).tenantId,
      subscriptionTier: (decodedToken as { subscriptionTier?: string })
        .subscriptionTier,
    };
    next();
  } catch (error: any) {
    // Distinguish revoked tokens from other auth failures for ops/audit.
    // Firebase Admin sets code='auth/id-token-revoked' cuando checkRevoked=true
    // detecta que el token fue emitido antes de revokeRefreshTokens().
    if (error?.code === 'auth/id-token-revoked') {
      logger.warn('auth_token_revoked', {
        endpoint: endpointForSecurityTelemetry(req.originalUrl || req.url),
        method: req.method,
      });
      return res.status(401).json({
        error: 'Unauthorized: Token revoked — please re-authenticate',
        reason: 'token_revoked',
      });
    }
    const endpoint = endpointForSecurityTelemetry(req.originalUrl || req.url);
    logger.error('auth_token_verification_failed', error, { endpoint, method: req.method });
    sentryCapture(error, { endpoint, tags: { method: req.method, middleware: 'verifyAuth' } });
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
