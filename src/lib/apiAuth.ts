// Praeventio Guard — §2.20 fix (2026-05-21).
//
// Helper unificado para construir el header `Authorization` que la API
// del backend espera. Resuelve un hallazgo del audit §2.19 (TODO.md):
//
//   - `src/lib/e2eAuth.ts:51` exporta `getE2EAuthHeader()` que devuelve
//     el header sintético `E2E <secret>:<uid>` cuando MODE=test.
//   - PERO ningún archivo en src/services/, src/pages/, src/hooks/ usaba
//     ese helper antes de este fix. Los 20+ call-sites llamaban
//     `user.getIdToken()` + manualmente `Authorization: Bearer ${token}`.
//   - Resultado: en modo E2E (Playwright full-stack), las peticiones
//     autenticadas iban con `Bearer <token-no-válido>` y el backend las
//     rechazaba con 401, aunque `verifyAuth.ts:67` SÍ acepta `E2E ...`.
//
// Este módulo provee `apiAuthHeader()` que centraliza la decisión:
//   1. Si `getE2EAuthHeader()` devuelve algo (MODE=test + fixture
//      presente) → ese header tal cual (incluye `E2E ` prefix).
//   2. Si hay `auth.currentUser` → `Bearer ${await getIdToken()}`.
//   3. Si no hay user → `null` (caller decide: skip request o 401).
//
// **Migración incremental:** los 20+ callers existentes pueden migrar
// uno por uno. La interfaz mantiene 100% compatibilidad: el caller
// recibe un string con el header completo (incluye prefijo correcto).
//
// **Garantía productiva:** El path E2E está doblemente gateado:
//   - `getE2EAuthHeader()` interno checkea `isE2EMode()` (MODE=test).
//   - El backend `verifyAuth.ts:49` tira fatal si NODE_ENV=production
//     y E2E_MODE=1.
// Producción nunca activa el branch E2E.

import { auth } from '../services/firebase';
import { getE2EAuthHeader, isE2EMode } from './e2eAuth';
import { logger } from '../utils/logger';

/**
 * Devuelve el header `Authorization` listo para inyectar en
 * `fetch().headers`. Retorna `null` si no hay user autenticado y no
 * estamos en E2E mode — el caller debe decidir si proceder sin auth
 * (request anónimo a endpoint público) o abortar.
 *
 * @example
 * const authHeader = await apiAuthHeader();
 * if (!authHeader) {
 *   logger.warn('skipping authenticated request: no user');
 *   return;
 * }
 * await fetch('/api/foo', { headers: { Authorization: authHeader } });
 */
export async function apiAuthHeader(): Promise<string | null> {
  // 1. E2E mode con fixture inyectado — `getE2EAuthHeader()` ya valida
  //    MODE=test internamente. Devuelve `E2E <secret>:<uid>`.
  const e2e = getE2EAuthHeader();
  if (e2e) return e2e;

  // 2. Modo productivo (o E2E sin fixture). Pedimos idToken al user
  //    actual de Firebase Auth.
  const user = auth.currentUser;
  if (!user) return null;

  try {
    const token = await user.getIdToken();
    // Plan v2 B3 — guard contra token vacío. `getIdToken()` puede
    // resolver a "" si el refresh token expiró o el user fue eliminado;
    // emitir `Bearer ` (sin token) hace que el server responda 401 sin
    // forma de distinguir "user signed out" de "auth bug". El test
    // `orchestrator.test.ts` documenta este comportamiento esperado.
    if (typeof token !== 'string' || token.length === 0) return null;
    return `Bearer ${token}`;
  } catch (err) {
    // `getIdToken()` puede tirar si el refresh token está expirado o
    // si la red está caída. Logueamos warning y devolvemos null para
    // que el caller maneje (request fallará con 401 si es necesario).
    logger.warn('[apiAuth] getIdToken failed', { err });
    return null;
  }
}

/**
 * Versión que tira si no hay header (en lugar de retornar null). Útil
 * cuando el caller ya garantizó el user vía gating externo y un
 * `getIdToken()` fail debe propagar como error explícito en vez de
 * 401 silencioso.
 */
export async function apiAuthHeaderOrThrow(): Promise<string> {
  const header = await apiAuthHeader();
  if (!header) {
    throw new Error(
      'apiAuthHeader: no auth available (user not logged in and no E2E fixture)',
    );
  }
  return header;
}

/**
 * Conveniencia para fetch wrappers que ya construyen el resto del
 * objeto `headers`. Devuelve un objeto vacío si no hay auth (en lugar
 * de null) para spread fluido:
 *
 * @example
 * const res = await fetch(url, {
 *   headers: { 'Content-Type': 'application/json', ...(await apiAuthHeaders()) },
 * });
 */
export async function apiAuthHeaders(): Promise<Record<string, string>> {
  const header = await apiAuthHeader();
  return header ? { Authorization: header } : {};
}

/**
 * Marca informativa para tests/debugging: ¿estamos usando E2E header
 * o Bearer real? Útil para asserts que verifican la fuente del header.
 */
export function detectAuthSource(): 'e2e' | 'bearer' | 'anonymous' {
  if (isE2EMode() && getE2EAuthHeader()) return 'e2e';
  if (auth.currentUser) return 'bearer';
  return 'anonymous';
}
