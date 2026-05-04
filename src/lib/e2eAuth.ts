// Praeventio Guard — Sprint 19 / F-B01.
//
// E2E auth helper para el frontend (browser). Cuando estamos en `MODE=test`
// (compilación de Playwright vía Vite preview con `--mode test`) y existe
// un header guardado por el fixture `loginAsTestUser`, exponemos un
// `getAuthHeader()` que devuelve el header sintético en lugar de pedir un
// idToken real a Firebase.
//
// Producción NUNCA toca este path:
//   1. `import.meta.env.MODE` solo es `'test'` cuando Vite arrancó con
//      `--mode test`. La build de Cloud Run usa `production`.
//   2. Aún si por error el bundle prod incluyera este módulo, no encuentra
//      el header en localStorage (no es seteado por la app real).
//   3. El backend tira fatal si detecta `NODE_ENV=production && E2E_MODE=1`
//      (ver src/server/middleware/verifyAuth.ts).
//
// Uso desde fetch wrappers:
//
// ```ts
// import { getE2EAuthHeader } from '@/lib/e2eAuth';
//
// const e2eHeader = getE2EAuthHeader();
// const headers = e2eHeader
//   ? { Authorization: e2eHeader }
//   : { Authorization: `Bearer ${await auth.currentUser?.getIdToken()}` };
// ```

const E2E_HEADER_KEY = 'gp.e2e.auth_header';

/**
 * Detecta si la app está corriendo bajo Playwright (`MODE=test`). Solo
 * devuelve true cuando la build expuso `import.meta.env.MODE === 'test'` —
 * production builds nunca activan esto.
 */
export function isE2EMode(): boolean {
  try {
    return import.meta.env.MODE === 'test';
  } catch {
    return false;
  }
}

/**
 * Devuelve el header `E2E <secret>:<uid>` guardado por `loginAsTestUser`,
 * o null si no estamos en modo test o no hay header en localStorage.
 *
 * Pensado para ser combinado con el flujo normal de Firebase ID token —
 * el caller mantiene el fallback a `Bearer ${idToken}` cuando esto retorna
 * null.
 */
export function getE2EAuthHeader(): string | null {
  if (!isE2EMode()) return null;
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(E2E_HEADER_KEY);
}
