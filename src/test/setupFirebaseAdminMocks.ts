// SPDX-License-Identifier: MIT
// Grieta de migración firebase-admin v14 (PR #1744): 250 archivos de test
// mockean SOLO la raíz `vi.mock('firebase-admin', ...)` (contrato adminObj:
// `firestore()`, `auth()`, `credential`, ...), pero el código migrado importa
// los SUB-módulos `firebase-admin/app|firestore|auth|messaging|storage`, que
// quedaban sin mock y revientan en runtime ("The default Firebase app does not
// exist" → 500 en las rutas → muro rojo de suites enteras).
//
// Cierre global de la grieta: cada sub-módulo se mockea UNA vez acá, y la
// factory delega en el mock raíz DEL PROPIO ARCHIVO DE TEST (via
// `await import('firebase-admin')`, que resuelve al factory de ese archivo).
// Así los ~250 archivos conservan su config por-test (db inyectado, getUser
// por uid, etc.) sin tocarse.
//
// Los exports no sobreescritos vienen del módulo real vía importOriginal, así
// no hay riesgo de export faltante (FieldPath, Filter, tipos-erased, etc.).
//
// NOTA de alcance: este setup corre SOLO desde `vitest.config.ts` (suite
// unit). `vitest.firestore.config.ts` (emulator, `*.firestore.test.ts`)
// necesita firebase-admin REAL y NO debe cargar este archivo.

import { vi } from 'vitest';

type AnyRecord = Record<string, any>;

/** El mock raíz adminObj de ESTE archivo de test (factory de vi.mock('firebase-admin')). */
async function rootAdmin(): Promise<AnyRecord> {
  const mod = (await import('firebase-admin')) as AnyRecord;
  // Vista LAZY del mock raíz: prioriza `default` (contrato adminObj) con
  // fallback al namespace del módulo, y resuelve cada propiedad al momento
  // del call — así los tests que MUTAN el módulo en runtime
  // (`adminModule.default.firestore = fakeDb`, patrón pre-migración contra
  // `admin.firestore()`) quedan cubiertos por la delegación de sub-módulos.
  return new Proxy({} as AnyRecord, {
    get: (_target, key: string) => {
      const d = mod.default as AnyRecord | undefined;
      return d && key in d ? d[key] : (mod as AnyRecord)[key];
    },
  });
}

// ── firebase-admin/app ──────────────────────────────────────────────────────
vi.mock('firebase-admin/app', async (importOriginal) => {
  const orig = await importOriginal<AnyRecord>();
  const admin = await rootAdmin();
  return {
    ...orig,
    initializeApp: (...args: unknown[]) =>
      admin.initializeApp ? admin.initializeApp(...args) : { name: '[DEFAULT]' },
    getApp: () => (admin.app ? admin.app() : { name: '[DEFAULT]' }),
    getApps: () => admin.apps ?? [{ name: '[DEFAULT]' }],
    deleteApp: async () => {},
    cert: (...args: unknown[]) =>
      admin.credential?.cert ? admin.credential.cert(...args) : {},
    applicationDefault: (...args: unknown[]) =>
      admin.credential?.applicationDefault
        ? admin.credential.applicationDefault(...args)
        : {},
  };
});

// ── firebase-admin/firestore ────────────────────────────────────────────────
vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const orig = await importOriginal<AnyRecord>();
  const admin = await rootAdmin();
  return {
    ...orig,
    getFirestore: (...args: unknown[]) => {
      // Lectura LAZY del mock raíz (ver rootAdmin): captura mutaciones de
      // runtime del módulo hechas después de cargar los mocks.
      const fs = admin.firestore;
      if (typeof fs === 'function') return fs(...args);
      // Shape tolerante: algunos tests entregan el db DIRECTO como
      // `firestore: fakeDb` (objeto con collection/doc), no una factory.
      if (fs && typeof fs === 'object' && typeof fs.collection === 'function') {
        return fs;
      }
      throw new Error(
        'firebase-admin/firestore: el mock raíz de este archivo no provee firestore()',
      );
    },
    // Sentinels FALSOS (mismo contrato del mock raíz) para que las fake stores
    // que resuelven __fv sigan funcionando con el código migrado. Getters
    // lazy: el mock raíz puede mutarse en runtime.
    get FieldValue() {
      return admin.firestore?.FieldValue ?? orig.FieldValue;
    },
    get Timestamp() {
      return admin.firestore?.Timestamp ?? orig.Timestamp;
    },
    get FieldPath() {
      return admin.firestore?.FieldPath ?? orig.FieldPath;
    },
  };
});

// ── firebase-admin/auth ─────────────────────────────────────────────────────
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const orig = await importOriginal<AnyRecord>();
  const admin = await rootAdmin();
  return {
    ...orig,
    getAuth: (...args: unknown[]) => {
      if (typeof admin.auth === 'function') return admin.auth(...args);
      // Mismo default honesto que adminMock: identidad neutra de test.
      return {
        verifyIdToken: async () => ({ uid: 'test' }),
        getUser: async () => ({ uid: 'test' }),
      };
    },
  };
});

// ── firebase-admin/messaging ────────────────────────────────────────────────
vi.mock('firebase-admin/messaging', async (importOriginal) => {
  const orig = await importOriginal<AnyRecord>();
  const admin = await rootAdmin();
  return {
    ...orig,
    getMessaging: (...args: unknown[]) => {
      if (typeof admin.messaging !== 'function') {
        // Honestidad > éxito falso (regla del repo): si el test no configuró
        // messaging en su mock raíz, fallar ruidosamente en vez de simular
        // un envío que nunca pasó.
        throw new Error(
          'firebase-admin/messaging: el mock raíz de este archivo no provee messaging()',
        );
      }
      return admin.messaging(...args);
    },
  };
});

// ── firebase-admin/storage ──────────────────────────────────────────────────
vi.mock('firebase-admin/storage', async (importOriginal) => {
  const orig = await importOriginal<AnyRecord>();
  const admin = await rootAdmin();
  return {
    ...orig,
    getStorage: (...args: unknown[]) => {
      if (typeof admin.storage !== 'function') {
        throw new Error(
          'firebase-admin/storage: el mock raíz de este archivo no provee storage()',
        );
      }
      return admin.storage(...args);
    },
  };
});

export {};
