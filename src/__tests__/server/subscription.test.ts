// Praeventio Guard — security depth: /api/subscription/upgrade paid-invoice gate.
//
// Closes DT-01 / DT-05 from the AUDITORIA: previously the SPA wrote
// `users/{uid}.subscription.planId` directly via client SDK, allowing
// any authed user to self-promote to the Ilimitado plan (~$5M CLP/mo).
// This file asserts that the server-side gate REQUIRES a `status: paid`
// invoice tagged with the requested plan before promoting.

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
});

describe('POST /api/subscription/upgrade — paid-invoice gate (DT-01/DT-05)', () => {
  it('rejects with 403 when the invoice is unpaid (pending-payment)', async () => {
    fs.store.set('invoices/inv_unpaid', {
      createdBy: 'uid-A',
      status: 'pending-payment',
      lineItems: [{ tierId: 'diamante', quantity: 1 }],
    });
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'diamante' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_paid_invoice_for_plan');
    // User was NOT promoted.
    expect(fs.store.get('users/uid-A')).toBeUndefined();
  });

  it('rejects with 403 when the only paid invoice belongs to a different uid', async () => {
    fs.store.set('invoices/inv_other', {
      createdBy: 'uid-other',
      status: 'paid',
      lineItems: [{ tierId: 'diamante' }],
    });
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'diamante' });
    expect(res.status).toBe(403);
  });

  it('rejects with 403 when the paid invoice is for a different plan', async () => {
    fs.store.set('invoices/inv_lower', {
      createdBy: 'uid-A',
      status: 'paid',
      lineItems: [{ tierId: 'plata' }],
    });
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'diamante' });
    expect(res.status).toBe(403);
  });

  it('rejects with 400 on invalid planId', async () => {
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'galactic-emperor' });
    expect(res.status).toBe(400);
  });

  it('happy path: paid invoice for the requested plan promotes the user', async () => {
    fs.store.set('invoices/inv_ok', {
      createdBy: 'uid-A',
      status: 'paid',
      lineItems: [{ tierId: 'oro' }],
    });
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'oro' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, planId: 'oro' });
    expect((fs.store.get('users/uid-A') as any).subscription).toMatchObject({
      planId: 'oro',
      status: 'active',
    });
  });

  it('accepts a legacy invoice tier id that normalizes to the requested plan', async () => {
    // Pre-collapse 'departamento-prevencion' → 'oro' via LEGACY_ALIASES.
    fs.store.set('invoices/inv_canonical', {
      createdBy: 'uid-A',
      status: 'paid',
      lineItems: [{ tierId: 'departamento-prevencion' }],
    });
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'oro' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, planId: 'oro' });
    expect((fs.store.get('users/uid-A') as any).subscription).toMatchObject({
      planId: 'oro',
      status: 'active',
    });
  });

  it('also accepts legacy top-level tierId on the invoice (schema back-compat)', async () => {
    fs.store.set('invoices/inv_legacy', {
      createdBy: 'uid-A',
      status: 'paid',
      tierId: 'plata', // legacy schema, no lineItems
    });
    const res = await request(handle.app)
      .post('/api/subscription/upgrade')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ planId: 'plata' });
    expect(res.status).toBe(200);
  });
});
