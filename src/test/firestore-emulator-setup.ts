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
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\nKUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIJLixBy2qpFoS4DSmoEm\n93JoQpQy0fI5pkVwsdaCmFx65gPDuxsxq2hPo7ZBJgUTo7nXOq6nlMxJzNZGUd0J\nIQIhAMjFvrhBKLDtkKBmmwHwULkP6cKMHa2RObsBKAa6Lc0PAiEA1U7t1uxOEsvY\nl0PnEsvHmEYHO0/5MeKvAjeyR0Xq2gECIEEPemFAUS6tpXNwbHfMjcahlmFNeF5o\n5w8Bk9oZIbHfAiBbE/Y2sUNXIu9tjg7iA/8gXi8VkA3aBNVZPgmHcF2yIQIhALLD\n1nCpHQz9MBcjvc6lOWMV+5HIWqLwHRD5Yl+u9zMS\n-----END PRIVATE KEY-----\n',
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
      // eslint-disable-next-line no-console
      console.warn(
        `[firestore-emulator-setup] clear endpoint respondió ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
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
