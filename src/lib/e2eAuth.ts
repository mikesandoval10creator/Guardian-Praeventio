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
const E2E_USER_KEY = 'gp.e2e.user';

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

/**
 * Shape mínima que el fixture `tests/e2e/fixtures/auth.ts:DEFAULT_TEST_USER`
 * inyecta en localStorage. Mantener en sync con `TestUser` allá — usamos
 * un type local porque este módulo se importa desde el bundle browser y
 * `@playwright/test` no está disponible en runtime.
 */
export interface E2EUserFixture {
  uid: string;
  email: string;
  displayName: string;
  roles: string[];
  projectIds: string[];
  tenantId: string;
}

/**
 * §2.19 fix (2026-05-21) — Resuelve el mismatch documentado en TODO.md:
 * el fixture E2E setea `gp.e2e.user` en localStorage pero `FirebaseContext`
 * solo escuchaba `onAuthStateChanged` de Firebase Auth real. Este helper
 * permite que `FirebaseContext` (y otros consumidores) inicialicen su
 * estado de "user logged-in" desde el fixture en modo test.
 *
 * Retorna null fuera de modo test, o cuando no hay fixture válido.
 *
 * **Garantía productiva:** este path está gateado por `isE2EMode()` que
 * solo es true cuando `import.meta.env.MODE === 'test'` — es decir, solo
 * cuando Vite arrancó con `--mode test`. La build productiva de Cloud Run
 * (`vite build`) usa `production` por default y nunca entra acá.
 */
export function getE2EUser(): E2EUserFixture | null {
  if (!isE2EMode()) return null;
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(E2E_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<E2EUserFixture>;
    if (!parsed || typeof parsed.uid !== 'string' || !parsed.uid) {
      return null;
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      roles: Array.isArray(parsed.roles) ? parsed.roles.filter((r): r is string => typeof r === 'string') : [],
      projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.filter((p): p is string => typeof p === 'string') : [],
      tenantId: typeof parsed.tenantId === 'string' ? parsed.tenantId : '',
    };
  } catch {
    return null;
  }
}

/**
 * §2.19 fix (2026-05-21) — Combina `isE2EMode()` + `getE2EUser()` para
 * uso conciso en componentes que necesitan saber "estamos en E2E con
 * fixture inyectado". Útil para `App.tsx` (auto-set `hasEntered=true`
 * cuando el test ya está "logged in" y queremos saltar Landing/Splash).
 */
export function hasE2EUserFixture(): boolean {
  return getE2EUser() !== null;
}
