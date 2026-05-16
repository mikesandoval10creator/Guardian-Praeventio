// Sprint 26 — Bucket YY.3 — server-side enforcement del ADR 0011 triple-gate.
//
// El cliente (TwinAccessGuard + useTwinAccess) ya enforce los 3 gates en
// el browser. Pero los endpoints que sirven datos del twin
// (siteGeometryStore reads, placedObjectsStore reads/writes) no pueden
// confiar en ello — un cliente comprometido podría emitir el fetch
// directo. Este middleware exige una prueba criptográfica de que el
// step-up biometric pasó hace menos de N minutos para el projectId del
// request.
//
// ─── Protocolo ──────────────────────────────────────────────────────
//
//   1. Cliente completa Gate 3 biometric (Capacitor BiometricAuth o
//      WebAuthn passkey).
//   2. Cliente intercambia un id-token Firebase + proof-of-biometric con
//      el endpoint `/api/twin/stepup` (separado, fuera de scope acá).
//      El servidor responde con un JWT firmado con SESSION_SECRET cuyo
//      payload contiene { uid, projectId, iat }.
//   3. Para cualquier request a un endpoint twin, el cliente incluye el
//      header `X-Twin-Step-Up: <jwt>`.
//   4. Este middleware:
//      - Verifica firma con SESSION_SECRET.
//      - Verifica `payload.projectId === req.params[projectIdParam]`.
//      - Verifica `now - payload.iat < recentMinutes`.
//      - Verifica `payload.uid === req.user.uid` (verifyAuth ya corrió).
//
// ─── Por qué JWT y no opaque token ──────────────────────────────────
//
// JWT firmado HMAC permite verificación stateless (sin Firestore lookup
// en el path crítico). El payload codifica el binding (uid, projectId,
// iat) que querríamos enforcer; firma con SESSION_SECRET evita
// falsificación. Para revocación en caso de compromiso, rotar el secret
// en Secret Manager (Sprint 22 V) invalida todos los tokens activos.
//
// `jose` ya está en deps — usado en mercadoPagoIpn para JWK verify.

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

const ISSUER = 'praeventio-twin-stepup';
const ALGORITHM = 'HS256';

export interface TwinStepUpClaims {
  /** Firebase Auth uid del trabajador que pasó biometric. */
  uid: string;
  /** Project id para el cual el step-up es válido. */
  projectId: string;
  /** Epoch seconds del step-up. Validado contra `recentMinutes`. */
  iat: number;
}

export interface VerifyTwinStepUpOptions {
  /** Default 30. Tokens más viejos que esto se rechazan. */
  recentMinutes?: number;
  /** Nombre del param de ruta que contiene el projectId. Default 'projectId'. */
  projectIdParam?: string;
  /**
   * Override del secret. Default lee `process.env.SESSION_SECRET`.
   * Tests inyectan un secret determinístico.
   */
  secret?: string;
  /** Override de `Date.now`. Tests inyectan un clock determinístico. */
  now?: () => number;
}

function getSecretBytes(secretStr: string | undefined): Uint8Array {
  if (!secretStr || secretStr.length < 16) {
    throw new Error(
      'verifyTwinStepUp: SESSION_SECRET unset or too short (<16 chars). ' +
        'Configure in Secret Manager (Sprint 22 V).',
    );
  }
  return new TextEncoder().encode(secretStr);
}

/**
 * Firma un step-up token. Usado por el endpoint `/api/twin/stepup`
 * (fuera de scope) y por los tests del middleware.
 */
export async function signTwinStepUpToken(
  claims: { uid: string; projectId: string },
  opts: { secret?: string; now?: () => number; ttlSeconds?: number } = {},
): Promise<string> {
  const secret = getSecretBytes(opts.secret ?? process.env.SESSION_SECRET);
  const now = opts.now ?? (() => Date.now());
  const iatSec = Math.floor(now() / 1000);
  const ttl = opts.ttlSeconds ?? 30 * 60; // 30 min default
  const jwt = await new SignJWT({
    uid: claims.uid,
    projectId: claims.projectId,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setIssuedAt(iatSec)
    .setExpirationTime(iatSec + ttl)
    .sign(secret);
  return jwt;
}

/**
 * Middleware que verifica el header `X-Twin-Step-Up`.
 *
 * Asume que `verifyAuth` ya corrió y populó `req.user.uid`. Si no
 * (header faltante / firma inválida / projectId mismatch / expirado),
 * responde 401 con un código de error específico para que el cliente
 * pueda mostrar el lock-screen apropiado.
 */
export function verifyTwinStepUp(opts: VerifyTwinStepUpOptions = {}): RequestHandler {
  const recentMinutes = opts.recentMinutes ?? 30;
  const projectIdParam = opts.projectIdParam ?? 'projectId';
  const nowFn = opts.now ?? (() => Date.now());

  return async (req: Request, res: Response, next: NextFunction) => {
    const tokenHeader = req.header('X-Twin-Step-Up');
    if (!tokenHeader) {
      return res.status(401).json({
        error: 'twin_stepup_missing',
        message:
          'Acceso al Digital Twin requiere step-up biometric reciente (ADR 0011)',
      });
    }

    const projectIdFromReq =
      (req.params?.[projectIdParam] as string | undefined) ??
      (req.query?.[projectIdParam] as string | undefined) ??
      (req.body?.[projectIdParam] as string | undefined);
    if (!projectIdFromReq) {
      return res.status(400).json({
        error: 'twin_stepup_no_project',
        message: `Falta el param "${projectIdParam}" del request.`,
      });
    }

    const reqUid = (req as Request & { user?: { uid?: string } }).user?.uid;
    if (!reqUid) {
      return res.status(401).json({
        error: 'twin_stepup_no_auth',
        message: 'verifyAuth must run before verifyTwinStepUp',
      });
    }

    let payload: TwinStepUpClaims;
    try {
      const secret = getSecretBytes(opts.secret ?? process.env.SESSION_SECRET);
      const { payload: rawPayload } = await jwtVerify(tokenHeader, secret, {
        issuer: ISSUER,
        algorithms: [ALGORITHM],
        // jose checks `exp` automatically; we still re-check `iat` against
        // `recentMinutes` below for defense-in-depth.
      });
      payload = rawPayload as unknown as TwinStepUpClaims;
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return res.status(401).json({
          error: 'twin_stepup_expired',
          message: 'Step-up biometric expirado. Verifica de nuevo.',
        });
      }
      return res.status(401).json({
        error: 'twin_stepup_invalid',
        message: 'Token de step-up inválido.',
      });
    }

    if (payload.projectId !== projectIdFromReq) {
      return res.status(401).json({
        error: 'twin_stepup_project_mismatch',
        message: 'El step-up no es válido para este proyecto.',
      });
    }
    if (payload.uid !== reqUid) {
      return res.status(401).json({
        error: 'twin_stepup_uid_mismatch',
        message: 'El step-up pertenece a otro usuario.',
      });
    }
    const iatMs = (payload.iat ?? 0) * 1000;
    const ageMs = nowFn() - iatMs;
    if (ageMs > recentMinutes * 60 * 1000) {
      return res.status(401).json({
        error: 'twin_stepup_stale',
        message: `Step-up biometric mayor a ${recentMinutes} min. Verifica de nuevo.`,
      });
    }

    // Anexar el payload para handlers downstream (audit log, etc).
    (req as Request & { twinStepUp?: TwinStepUpClaims }).twinStepUp = payload;
    next();
    return undefined;
  };
}

export default verifyTwinStepUp;
