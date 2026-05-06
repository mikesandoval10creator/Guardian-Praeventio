// SPDX-License-Identifier: MIT
//
// Sprint 33 — replay protection + per-uid rate limiter for POST /api/ai/feedback.
//
// Audit hallazgo P0 (AUDIT_2026-05-05_FULL.md §1.3): un atacante con Bearer
// válido podía sobrescribir un voto 'down' por 'up' usando el mismo
// `messageId` porque el handler antiguo usaba `set({ merge: true })`. Estos
// tests pinean los dos arreglos:
//
//   1. Replay guard transaccional → 409 'already_voted' en duplicados.
//   2. `aiFeedbackLimiter` (30 votes / 5 min por uid) → 429 al exceder.
//
// Patrón de mock copia el shape de `apiKeyService.test.ts` + el harness
// supertest de los tests del bucket B3.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// In-memory firestore con soporte para `runTransaction` — el handler usa
// admin.firestore().runTransaction, así que el shim debe exponerlo.
const mocks = vi.hoisted(() => {
  const store = new Map<string, any>();
  const audit: any[] = [];

  const makeDocRef = (path: string) => ({
    path,
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
    }),
    set: async (data: any, opts?: { merge?: boolean }) => {
      if (opts?.merge && store.has(path)) {
        store.set(path, { ...store.get(path), ...data });
      } else {
        store.set(path, { ...data });
      }
    },
  });

  const collectionFactory = (col: string): any => ({
    doc: (id: string) => {
      const path = `${col}/${id}`;
      return {
        ...makeDocRef(path),
        collection: (sub: string) => collectionFactory(`${col}/${id}/${sub}`),
      };
    },
    add: async (data: any) => {
      const id = `auto_${Math.random().toString(36).slice(2, 10)}`;
      store.set(`${col}/${id}`, { ...data });
      if (col === 'audit_logs') audit.push({ ...data });
      return { id };
    },
  });

  const firestoreFactory = () => ({
    collection: collectionFactory,
    runTransaction: async (fn: (tx: any) => Promise<any>) => {
      // Sequencial: get/set leen y mutan `store` directamente. Suficiente
      // para tests determinísticos — no estamos validando concurrency real.
      const tx = {
        get: async (ref: any) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
        }),
        set: async (ref: any, data: any, opts?: { merge?: boolean }) => {
          if (opts?.merge && store.has(ref.path)) {
            store.set(ref.path, { ...store.get(ref.path), ...data });
          } else {
            store.set(ref.path, { ...data });
          }
        },
      };
      return fn(tx);
    },
  });

  return { store, audit, firestoreFactory };
});

vi.mock('firebase-admin', () => {
  const fs = mocks.firestoreFactory();
  return {
    default: {
      firestore: Object.assign(() => fs, {
        FieldValue: { serverTimestamp: () => ({ __ts: true }) },
      }),
      auth: () => ({
        verifyIdToken: async (token: string) => {
          // Convención: "test:uid:email" → decoded.
          if (token === 'invalid') throw new Error('invalid');
          const [, uid, email] = token.split(':');
          return { uid: uid ?? 'uid-default', email: email ?? `${uid}@test.com` };
        },
      }),
    },
    firestore: () => fs,
  };
});

vi.mock('firebase-admin/firestore', () => {
  const fs = mocks.firestoreFactory();
  return { getFirestore: () => fs };
});

// Mockear el limiter para el caso 4 — necesitamos un `max` chico para no
// disparar 30 requests reales en un test. Inyectamos un override por
// header `x-test-vote-burst` que el limiter no controla; en su lugar
// reemplazamos el módulo entero. Patrón: `vi.mock` con factory.
vi.mock('../middleware/limiters.js', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, any>;
  // express-rate-limit con max:30 funciona idéntico que en prod aquí
  // (cada test arranca con un nuevo router → bucket fresco).
  return orig;
});

import aiFeedbackRouter from './aiFeedback.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiFeedbackRouter);
  return app;
}

beforeEach(() => {
  mocks.store.clear();
  mocks.audit.length = 0;
});

describe('POST /api/ai/feedback — replay protection (Sprint 33 P0)', () => {
  it('first vote succeeds, persists doc + audit row', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/ai/feedback')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({
        messageId: 'msg-001',
        vote: 'down',
        response: 'la IA dijo X',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.override).toBe(false);
    expect(mocks.store.get('ai_feedback/uid-A/items/msg-001')).toMatchObject({
      vote: 'down',
      messageId: 'msg-001',
    });
    const auditRow = mocks.audit.find((a) => a.action === 'ai_feedback.voted');
    expect(auditRow).toBeDefined();
    expect(auditRow.details.override).toBe(false);
    expect(auditRow.details.vote).toBe('down');
  });

  it('duplicate vote on same messageId returns 409 already_voted', async () => {
    const app = buildApp();
    // Primer voto 'down'
    await request(app)
      .post('/api/ai/feedback')
      .set('Authorization', 'Bearer test:uid-B:b@test.com')
      .send({ messageId: 'msg-002', vote: 'down', response: 'r' });
    // Intento de flip a 'up' — debe ser bloqueado.
    const res = await request(app)
      .post('/api/ai/feedback')
      .set('Authorization', 'Bearer test:uid-B:b@test.com')
      .send({ messageId: 'msg-002', vote: 'up', response: 'r' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('already_voted');
    expect(res.body.existing).toBe('down');
    // El doc original NO se cambió.
    expect(mocks.store.get('ai_feedback/uid-B/items/msg-002').vote).toBe('down');
  });

  it('vote with ?force=true overwrites + writes audit row with override:true', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/ai/feedback')
      .set('Authorization', 'Bearer test:uid-C:c@test.com')
      .send({ messageId: 'msg-003', vote: 'down', response: 'r' });
    const res = await request(app)
      .post('/api/ai/feedback?force=true')
      .set('Authorization', 'Bearer test:uid-C:c@test.com')
      .send({ messageId: 'msg-003', vote: 'up', response: 'r' });
    expect(res.status).toBe(200);
    expect(res.body.override).toBe(true);
    expect(mocks.store.get('ai_feedback/uid-C/items/msg-003').vote).toBe('up');
    const overrideAudit = mocks.audit.find(
      (a) => a.action === 'ai_feedback.voted' && a.details.override === true,
    );
    expect(overrideAudit).toBeDefined();
    expect(overrideAudit.details.previousVote).toBe('down');
  });

  it('limiter trips after 30 votes / 5min for the same uid (returns 429)', async () => {
    const app = buildApp();
    // 30 votos OK con messageIds distintos.
    for (let i = 0; i < 30; i++) {
      const r = await request(app)
        .post('/api/ai/feedback')
        .set('Authorization', 'Bearer test:uid-D:d@test.com')
        .send({ messageId: `msg-burst-${i}`, vote: 'up', response: 'r' });
      expect(r.status).toBe(200);
    }
    // El 31º cae al limiter.
    const blocked = await request(app)
      .post('/api/ai/feedback')
      .set('Authorization', 'Bearer test:uid-D:d@test.com')
      .send({ messageId: 'msg-burst-31', vote: 'up', response: 'r' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('ai_feedback_rate_limited');
  }, 20_000);
});
