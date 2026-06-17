// Praeventio Guard — B5/B15: dteIssueQueueStore persistence tests.
//
// The store is the Firestore side of the pure dteIssueQueue state machine.
// Pinned contract: deterministic doc id (idempotencyKey), create-if-absent
// semantics, succeeded jobs are NEVER reset (no double-emit).

import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

import { decideDteIssue, type DteIssueRequest } from './dteAutoIssueOrchestrator';
import {
  DTE_ISSUE_QUEUE_COLLECTION,
  buildDteQueueInvoicePayload,
  enqueueDteIssueJob,
  queueEntryToDoc,
  shouldQueueDteRetry,
  type DteQueueInvoicePayload,
} from './dteIssueQueueStore';
import { enqueue, markIssued } from './dteIssueQueue';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const sampleReq: DteIssueRequest = {
  paymentId: 'manual:inv-b2b-1',
  tenantId: 'uid-owner',
  payerInfo: { taxId: '76.123.456-0', legalName: 'Empresa SpA', email: 'pagos@empresa.cl' },
  amountClp: 50000,
  planCode: 'comite-paritario',
  paymentGateway: 'manual',
  paidAt: '2026-06-11T12:00:00.000Z',
};

const decision = decideDteIssue(sampleReq);

const invoicePayload: DteQueueInvoicePayload = {
  id: 'inv-b2b-1',
  status: 'paid',
  paidAt: '2026-06-11T12:00:00.000Z',
  paymentMethod: 'manual-transfer',
  cliente: { nombre: 'Empresa SpA', rut: '76.123.456-0', email: 'pagos@empresa.cl' },
  lineItems: [{ tierId: 'comite-paritario', description: 'Suscripción', quantity: 1, unitAmount: 42017, currency: 'CLP' }],
  totals: { subtotal: 42017, iva: 7983, total: 50000, currency: 'CLP' },
};

function fakeDb() {
  return createFakeFirestore() as unknown as Firestore & {
    _store: Map<string, Record<string, unknown>>;
  };
}

describe('enqueueDteIssueJob', () => {
  it('persists a fresh pending entry at the DETERMINISTIC doc id (idempotencyKey)', async () => {
    const db = fakeDb();
    const now = new Date('2026-06-11T12:00:00.000Z');

    const outcome = await enqueueDteIssueJob(db, decision, invoicePayload, 'mark-paid', now);

    expect(outcome).toBe('enqueued');
    const docPath = `${DTE_ISSUE_QUEUE_COLLECTION}/${decision.idempotencyKey}`;
    const doc = db._store.get(docPath) as Record<string, unknown>;
    expect(doc).toBeTruthy();
    expect(doc.status).toBe('pending');
    expect(doc.attempts).toBe(0);
    expect(doc.idempotencyKey).toBe(decision.idempotencyKey);
    expect(doc.nextAttemptAt).toBe(now.toISOString());
    expect(doc.source).toBe('mark-paid');
    expect((doc.invoice as DteQueueInvoicePayload).id).toBe('inv-b2b-1');
    expect((doc.decision as { documentKind: string }).documentKind).toBe('factura_electronica');
  });

  it('re-enqueue of an already-queued job is a no-op (keeps backoff state)', async () => {
    const db = fakeDb();
    const docPath = `${DTE_ISSUE_QUEUE_COLLECTION}/${decision.idempotencyKey}`;
    // Simulate a job the drain already retried twice.
    (db as unknown as { _seed(p: string, d: Record<string, unknown>): void })._seed(docPath, {
      ...queueEntryToDoc(enqueue(decision), invoicePayload, 'mark-paid'),
      status: 'failed_retry',
      attempts: 2,
      lastError: 'bsale 503',
    });

    const outcome = await enqueueDteIssueJob(db, decision, invoicePayload, 'mark-paid');

    expect(outcome).toBe('already-queued');
    const doc = db._store.get(docPath) as Record<string, unknown>;
    expect(doc.status).toBe('failed_retry');
    expect(doc.attempts).toBe(2);
    expect(doc.lastError).toBe('bsale 503');
  });

  it('NEVER resets a succeeded job — double-mark cannot double-emit', async () => {
    const db = fakeDb();
    const docPath = `${DTE_ISSUE_QUEUE_COLLECTION}/${decision.idempotencyKey}`;
    const done = markIssued(enqueue(decision), { provider: 'bsale', folio: 777 });
    (db as unknown as { _seed(p: string, d: Record<string, unknown>): void })._seed(
      docPath,
      queueEntryToDoc(done, invoicePayload, 'mark-paid'),
    );

    const outcome = await enqueueDteIssueJob(db, decision, invoicePayload, 'mark-paid');

    expect(outcome).toBe('already-succeeded');
    const doc = db._store.get(docPath) as Record<string, unknown>;
    expect(doc.status).toBe('succeeded');
    expect((doc.providerResponse as { folio: number }).folio).toBe(777);
  });
});

describe('queueEntryToDoc', () => {
  it('strips undefined values so the Firestore write never rejects', () => {
    const done = markIssued(enqueue(decision), { provider: 'bsale', folio: 1 });
    // markIssued sets lastError/nextAttemptAt to undefined.
    const doc = queueEntryToDoc(done, invoicePayload, 'mark-paid');
    expect('lastError' in doc).toBe(false);
    expect('nextAttemptAt' in doc).toBe(false);
    expect(Object.values(doc)).not.toContain(undefined);
    const provider = doc.providerResponse as Record<string, unknown>;
    expect('trackId' in provider).toBe(false);
    expect('pdfUrl' in provider).toBe(false);
  });
});

describe('buildDteQueueInvoicePayload', () => {
  it('narrows a raw invoice doc to the DTE-relevant subset, re-hydrated as paid', () => {
    const payload = buildDteQueueInvoicePayload(
      'inv-9',
      {
        cliente: { nombre: 'Cliente', email: 'c@x.cl' },
        lineItems: [{ tierId: 'oro', description: 'Plan', quantity: 1, unitAmount: 100, currency: 'CLP' }],
        totals: { subtotal: 100, iva: 19, total: 119, currency: 'CLP' },
        paymentMethod: 'manual-transfer',
        webpayToken: 'SECRET-MUST-NOT-LEAK',
        createdByEmail: 'pii@x.cl',
      },
      '2026-06-11T12:00:00.000Z',
    );
    expect(payload.id).toBe('inv-9');
    expect(payload.status).toBe('paid');
    expect(payload.paidAt).toBe('2026-06-11T12:00:00.000Z');
    expect(payload.lineItems).toHaveLength(1);
    expect((payload as unknown as Record<string, unknown>).webpayToken).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).createdByEmail).toBeUndefined();
  });
});

describe('shouldQueueDteRetry — which auto-issue outcomes get retried', () => {
  it('queues a transient adapter failure (errorMessage present)', () => {
    expect(shouldQueueDteRetry({ ok: false, errorMessage: 'bsale 503' })).toBe(true);
  });

  it("queues a credential outage (skipped: 'no-adapter')", () => {
    expect(shouldQueueDteRetry({ ok: false, skipped: 'no-adapter' })).toBe(true);
  });

  it('never queues a successful emission', () => {
    expect(shouldQueueDteRetry({ ok: true })).toBe(false);
  });

  it('never queues deliberate skips (decisions, not failures)', () => {
    for (const skipped of ['disabled', 'usd', 'invalid-status', 'not-configured']) {
      expect(shouldQueueDteRetry({ ok: false, skipped })).toBe(false);
    }
  });
});
