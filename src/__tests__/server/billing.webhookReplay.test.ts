// Praeventio Guard — Sprint 35 audit P0 (billing webhook replay defense).
//
// AUDIT CONTEXT
// -------------
// All three Chilean LATAM payment rails (Webpay/Transbank, Khipu, MercadoPago)
// retry IPN/return deliveries on transient receiver errors. Without
// idempotency, a redelivered notification would either:
//   • Double-grant the subscription (revenue loss / fraud vector if the
//     attacker can replay a signed token), OR
//   • Double-charge / double-credit the invoice in our books, breaking
//     reconciliation with the gateway.
//
// The production code uses two complementary mechanisms, both already
// covered by unit tests but never asserted *together* as a "replay
// defense" suite:
//
//   1. `acquireWebpayIdempotencyLock` (firstWriteWins on processed_webpay/
//      {token_ws}) — guards GET /billing/webpay/return.
//   2. `withIdempotency` (lock-then-complete on processed_khipu / processed_
//      mp_ipn keyed by payment_id) — guards POST /api/billing/khipu/webhook
//      and POST /api/billing/webhook/mercadopago.
//
// This file exercises BOTH at the integration layer:
//   • Webpay: against the test-server harness (mirrors the production
//     Express handler exactly — see src/__tests__/server/test-server.ts).
//   • Khipu/MP: against `withIdempotency` directly with an in-memory
//     MinimalFirestore. The production handlers wrap their entire
//     work() block in this primitive, so the contract `kind: 'duplicate'
//     ⇒ work skipped` IS the replay defense. We assert the work-fn
//     call-count, not just the outcome shape.
//
// Why service-layer for Khipu/MP and not full HTTP harness? The Khipu
// route requires raw-body HMAC + a real `KhipuAdapter.fromEnv()` call;
// MP's route requires JWKS plumbing + canonical-JSON HMAC. Both are
// already exhaustively covered by their own *.test.ts files. Stacking
// another layer of HTTP harness would test plumbing we already test
// and add ~200 LOC of fixture noise. The replay defense IS the
// idempotency wrapper — exercise that primitive once with realistic
// work() fns and we cover the audit ask.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';
import {
  withIdempotency,
  type MinimalFirestore,
} from '../../services/billing/idempotency.js';

// ───────────────────────────────────────────────────────────────────────────
// Webpay — full HTTP integration (mirrors GET /billing/webpay/return).
// ───────────────────────────────────────────────────────────────────────────

describe('Billing webhook replay — Webpay (GET /billing/webpay/return)', () => {
  let handle: TestServerHandle;
  let fs: InMemoryFirestore;

  beforeEach(() => {
    fs = new InMemoryFirestore();
  });

  it('first delivery: token_ws=tok-W1 → AUTHORIZED, redirect /pricing/success', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => ({
        status: 'AUTHORIZED',
        buyOrder: 'inv-W1',
        amount: 11990,
        authorizationCode: 'A-W1',
      }),
    });
    fs.store.set('invoices/inv-W1', { status: 'pending-payment', createdBy: 'uid-w1' });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-W1');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/success?invoice=inv-W1');
    expect((fs.store.get('invoices/inv-W1') as any).status).toBe('paid');
    // Idempotency lock landed in 'done' state under processed_webpay/tok-W1.
    expect((fs.store.get('processed_webpay/tok-W1') as any).status).toBe('done');
    expect((fs.store.get('processed_webpay/tok-W1') as any).outcome).toBe('paid');
  });

  it('redelivery: same token_ws → replay redirect, NO second commitTransaction call', async () => {
    let firstCommitCount = 0;
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => {
        firstCommitCount++;
        return {
          status: 'AUTHORIZED',
          buyOrder: 'inv-W2',
          amount: 11990,
          authorizationCode: 'A-W2',
        };
      },
    });
    fs.store.set('invoices/inv-W2', { status: 'pending-payment', createdBy: 'uid-w2' });
    await request(handle.app).get('/billing/webpay/return?token_ws=tok-W2');
    expect(firstCommitCount).toBe(1);

    // Second delivery with the same token. The lock under processed_webpay/
    // tok-W2 is already 'done' so the handler must NOT call commit again.
    let secondCommitCount = 0;
    handle = buildTestServer({
      firestore: fs, // share state
      webpayCommit: async () => {
        secondCommitCount++;
        return { status: 'AUTHORIZED', buyOrder: 'inv-W2', amount: 11990 };
      },
    });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-W2');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/success?invoice=inv-W2');
    expect(secondCommitCount).toBe(0);
  });

  it('redelivery of a REJECTED outcome → replays /pricing/failed (NOT /pricing/success)', async () => {
    handle = buildTestServer({
      firestore: fs,
      webpayCommit: async () => ({
        status: 'REJECTED',
        buyOrder: 'inv-W3',
        amount: 11990,
      }),
    });
    fs.store.set('invoices/inv-W3', { status: 'pending-payment', createdBy: 'uid-w3' });
    await request(handle.app).get('/billing/webpay/return?token_ws=tok-W3');
    // Mutate the persisted outcome — this catches a "replay always sends
    // success" regression.
    expect((fs.store.get('processed_webpay/tok-W3') as any).outcome).toBe('rejected');

    const res = await request(handle.app).get('/billing/webpay/return?token_ws=tok-W3');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/pricing/failed?invoice=inv-W3');
  });

  it('malformed token_ws → 400, no idempotency lock written', async () => {
    handle = buildTestServer({ firestore: fs });
    const res = await request(handle.app).get('/billing/webpay/return?token_ws=has spaces');
    expect(res.status).toBe(400);
    expect([...fs.store.keys()].some((k) => k.startsWith('processed_webpay/'))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Khipu / MercadoPago — service-layer integration via withIdempotency.
//
// The production handlers each wrap their entire work() block in
// withIdempotency(). Therefore the replay defense reduces to: given a
// 'done' lock doc on the second delivery, work() MUST NOT run.
// ───────────────────────────────────────────────────────────────────────────

interface FakeDoc { data: Record<string, any> | undefined }

function makeMemFirestore(): { db: MinimalFirestore; store: Map<string, FakeDoc> } {
  const store = new Map<string, FakeDoc>();
  const db: MinimalFirestore = {
    collection(col: string) {
      return {
        doc(key: string) {
          const path = `${col}/${key}`;
          return {
            async get() {
              const e = store.get(path);
              return { exists: !!e, data: () => e?.data };
            },
            async set(data: Record<string, any>, options?: { merge?: boolean }) {
              const prev = store.get(path);
              if (options?.merge && prev?.data) {
                store.set(path, { data: { ...prev.data, ...data } });
              } else {
                store.set(path, { data: { ...data } });
              }
            },
            async update(data: Record<string, any>) {
              const prev = store.get(path);
              if (!prev) throw new Error('cannot update missing doc');
              store.set(path, { data: { ...prev.data, ...data } });
            },
          };
        },
      };
    },
  };
  return { db, store };
}

describe('Billing webhook replay — Khipu (processed_khipu/{paymentId})', () => {
  it('first delivery: work() runs, returns fresh-success, lock marked done', async () => {
    const { db, store } = makeMemFirestore();
    const work = vi.fn(async () => ({ ok: true, status: 'completed' as const }));
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_khipu', key: 'pay-K1' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('fresh-success');
    expect(store.get('processed_khipu/pay-K1')?.data?.status).toBe('done');
  });

  it('redelivery: work() is NOT called, outcome is duplicate with previous result', async () => {
    const { db } = makeMemFirestore();
    const work = vi.fn(async () => ({ ok: true, status: 'completed' as const }));
    // First call seeds the doc with status:'done'.
    await withIdempotency(
      db,
      { collection: 'processed_khipu', key: 'pay-K2' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);

    // Second call MUST be the replay path — work() not invoked again.
    const replay = await withIdempotency(
      db,
      { collection: 'processed_khipu', key: 'pay-K2' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1); // unchanged
    expect(replay.kind).toBe('duplicate');
    if (replay.kind === 'duplicate') {
      expect(replay.previousResult).toMatchObject({ ok: true, status: 'completed' });
    }
  });

  it('different dedupeKey → fresh work() invocation (no cross-collision)', async () => {
    const { db } = makeMemFirestore();
    const work = vi.fn(async (label: string) => ({ paid: label }));
    await withIdempotency(
      db,
      { collection: 'processed_khipu', key: 'pay-K3a' },
      () => work('a'),
    );
    await withIdempotency(
      db,
      { collection: 'processed_khipu', key: 'pay-K3b' },
      () => work('b'),
    );
    expect(work).toHaveBeenCalledTimes(2);
  });
});

describe('Billing webhook replay — MercadoPago (processed_mp_ipn/{paymentId})', () => {
  it('first delivery: work() runs, fresh-success, doc marked done', async () => {
    const { db, store } = makeMemFirestore();
    const work = vi.fn(async () => ({ outcome: 'paid' as const, invoiceId: 'inv-MP1' }));
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_mp_ipn', key: 'mp-pay-1' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('fresh-success');
    expect(store.get('processed_mp_ipn/mp-pay-1')?.data?.status).toBe('done');
  });

  it('redelivery: duplicate kind, work() NOT re-invoked → no double-credit', async () => {
    const { db } = makeMemFirestore();
    let runs = 0;
    const work = async () => {
      runs++;
      return { outcome: 'paid' as const, invoiceId: 'inv-MP2' };
    };
    // Seed.
    const first = await withIdempotency(
      db,
      { collection: 'processed_mp_ipn', key: 'mp-pay-2' },
      work,
    );
    expect(first.kind).toBe('fresh-success');
    expect(runs).toBe(1);

    // Replay → MUST NOT re-credit the invoice.
    const second = await withIdempotency(
      db,
      { collection: 'processed_mp_ipn', key: 'mp-pay-2' },
      work,
    );
    expect(runs).toBe(1);
    expect(second.kind).toBe('duplicate');
  });

  it('replayed-rejected outcome reports duplicate → handler must surface rejected (not silently retry)', async () => {
    // Production behaviour: if MP first reports 'rejected', the invoice
    // is locked into 'rejected'. A redelivery with the same paymentId
    // MUST resolve to duplicate (NOT re-invoke work() to avoid stale
    // status flips if the gateway later corrects to 'paid' — that path
    // requires a NEW paymentId per MP's own contract).
    const { db } = makeMemFirestore();
    const work = vi.fn(async () => ({ outcome: 'rejected' as const, invoiceId: 'inv-MP3' }));
    await withIdempotency(
      db,
      { collection: 'processed_mp_ipn', key: 'mp-pay-3' },
      work,
    );
    const second = await withIdempotency(
      db,
      { collection: 'processed_mp_ipn', key: 'mp-pay-3' },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    expect(second.kind).toBe('duplicate');
    if (second.kind === 'duplicate') {
      expect(second.previousResult).toMatchObject({
        outcome: 'rejected',
        invoiceId: 'inv-MP3',
      });
    }
  });
});
