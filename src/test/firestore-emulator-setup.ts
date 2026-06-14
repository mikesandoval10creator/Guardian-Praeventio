// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase C.1.
//
// Setup file para `vitest.firestore.config.ts`. Conecta firebase-admin al
// Firestore Emulator local (puerto 8080) y expone helpers para que cada
// test limpie su estado entre runs.
//
// Patrón:
//   - `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` es la única forma de hacer
//     que firebase-admin apunte al emulator (NO hay `connectFirestoreEmulator`
//     en admin SDK; eso es solo client SDK). Lo seteamos antes de
//     `initializeApp`.
//   - `clearFirestoreData(projectId)` borra TODAS las collections del
//     proyecto entre tests. Usa la REST API del emulator (no admin SDK)
//     porque admin no expone "delete project data" sin recursión manual.
//   - Cada `.firestore.test.ts` puede importar `clearFirestore()` y
//     llamarlo en `beforeEach`.
//
// NOTA importante sobre el client SDK:
//   Los stores que voy a testear viven en `src/services/*Store.ts` y usan
//   el CLIENT SDK (`firebase/firestore`) — no admin. Para que el client
//   SDK también apunte al emulator dentro del proceso de test, el setup
//   también dispara `connectFirestoreEmulator` cuando el modulo
//   `../services/firebase` se importa por primera vez. Ya está habilitado
//   por la rama `MODE === 'test'` en `firebase.ts` (Fase 2.22 §455). En
//   este config corremos con `environment: 'node'` SIN `--mode test` por
//   default, pero seteamos `import.meta.env.MODE = 'test'` acá para
//   forzar la rama.

import { initializeApp, cert, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll } from 'vitest';

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'praeventio-test';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

// Setea las env vars ANTES de inicializar admin para que el SDK
// detecte el emulator. Si el caller ya las seteó (CI), respetamos.
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
// `MODE === 'test'` activa el `connectFirestoreEmulator` del client SDK
// (firebase.ts §2.22 / 2026-05-21). Sin esto el client apuntaría a prod.
process.env.VITE_MODE = 'test';

let adminApp: App | null = null;

beforeAll(async () => {
  // Idempotente — si otra suite del mismo fork ya inicializó, reusamos.
  if (!adminApp) {
    adminApp = initializeApp({
      projectId: PROJECT_ID,
      // Admin SDK requiere algunas credenciales aunque sean dummies cuando
      // FIRESTORE_EMULATOR_HOST está seteado (el emulator las ignora).
      credential: cert({
        projectId: PROJECT_ID,
        clientEmail: `firebase-adminsdk-fake@${PROJECT_ID}.iam.gserviceaccount.com`,
        // PEM dummy — el emulator no valida la firma, solo necesita la shape.
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC/gdVt8+bB8KpL\nOCIpUH4dUO7gDRJoaPuML5yHDvs1OtHghEnK28FY8zkOi3bcbwh/ACymo2CBO6QN\nsc9BIZIjfkjgFff9O+KNww9cAOxvsm59KoY8e+7t9lrZxq/b23xWDb3hJm6e5R8z\nvo1JJ66TUk1b+w6xWr0lh4wkVcbvElolsMUvMiEtARsVbHvRoYO5UaLDf5VvGpRd\nyNKQnpTV0YaEZJWVpvFlLbDkXb4zVkfFn2o3gDSPGTnvXfSP0ZjCL8Nd05q0jHbI\nedtSqjGKXrRJE0PQ+CZuuuFqfm4Djly81Ncc+46pa6N9grxTkGynckQCwAKf52HX\ndr+dTbYHAgMBAAECggEAXzvC9btBCTfTj7VZ856mIJEDQWLuwQJX+VYh6l3uWYGn\nJhXTFnCi3UeSm6OKF8OVf4aILdP4JTwR8Id4T+TQZhsiRWFXYdR6bNHQHQoOids7\nK75OY9yjrC2C72JpSJWE5sxNnR3+C8FX+2TqoLL9kyBt/OxD2bmMbxHRhK4tT+w9\ncx6/6wNBzQEuAuTE8MU6XTgaDb+LCkY6iq8wnXk5/iFd22mG9s+mUa6t2gU9th1M\n53ZEDW/BbkdYrAqwABirl6HkjXWZeW6C2kaYQDqy6nPiEYvteNdA/ymWiCdU2Wd5\n18olMZHWgjxwLDiMP8Y/y/2SdMhgaDnFg1FH8YNj6QKBgQDoZn6eAj/VVHyO7EO8\nhFYEX/Wo+sQLEnZoywo8qodPe2GYmFCvjGVyqlzFhcBbR3q1TPHAUH7pY8WWJxDK\nLrhXx/8g5sPnsF58HIhfOs3NURq7ZOE6OSSMLELAjxqQ6ooEYp65tGW6rYKz3Ybq\nKzHjMtrOnL6Bn4XA2qS0uvcW/wKBgQDS9EZcHtdi5veftR5FGsMV6kH6L5b7FlMf\njT+AEX3Fj4LPINFD4bdwBcHYZehQXGigCPZnvtwBumqCmIEqZ5DhfStLsQbGxoSA\nFV/LAaSurjaMO6hUmEvNRF6YDzT+GE20lpXcNr+n1Ihv/axM8f8kBnT+trbB+EUF\n13+zLR+o+QKBgQClpvk1s7DAZPpr/ajCpSmS8LtweV5n7f8M7z0axQqx8uY8GMXa\ne56MPzblbFMSPT8QIApp5Hax8XYTc0EafHbVyy7lytd1PFf863GhP48WfGsri9qm\n37hXWe0yyE5NYYCDY7Bz+kxQ5gC2KH9URvnGUqd4gm2gg46ZSsAAOwyJDQKBgEpN\n2GqiQmOHzzjl5t+YaZbSiKLDGH8gge7fJbrKbm6j+gNTH+K1IpPGs1yxqH6FziRw\ng7pPM9c3/kQ5y2VQTWvfVty2Yhip3AnxfWhYD9Wnb3c9nDEP48NNjbQpxxSpItW1\nJNwIPMG0zsoDpCkGJERgMd12JjF0bXt9SHGoNzqhAoGAR4coSY2uC7gBCrF8T9rF\nvds1DWaQvdyB6lDxDa8U4id2ipKOmJMlqJyM/VknwW7zhIT90WzFQ1q32/PKAM1g\n2oF76PdRbIWmfBiigrI71nlsGJPgk+xtZCQ3GG2JD57S7g36oqxuYP9MNQlnhKUD\nbBJICvmsCGZ6Stx0dK7qBdc=\n-----END PRIVATE KEY-----\n',
      }),
    });
  }
}, 30_000);

afterAll(async () => {
  if (adminApp) {
    await deleteApp(adminApp);
    adminApp = null;
  }
});

afterEach(async () => {
  // Limpia el proyecto entre tests usando la REST API del emulator.
  // Endpoint documentado:
  //   DELETE /emulator/v1/projects/{projectId}/databases/(default)/documents
  const host = EMULATOR_HOST;
  const url = `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {

      console.warn(
        `[firestore-emulator-setup] clear endpoint respondió ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {

    console.warn('[firestore-emulator-setup] clear falló (emulator down?):', err);
  }
});

/**
 * Helper opcional: retorna un Firestore admin handle para los tests que
 * quieran sembrar data SIN pasar por el store (ej. tests que verifican
 * que `subscribe` recibe data escrita por otro caller).
 */
export function getEmulatorAdminFirestore() {
  if (!adminApp) {
    throw new Error('firestore-emulator-setup: admin app no inicializada (beforeAll no corrió)');
  }
  return getAdminFirestore(adminApp);
}
