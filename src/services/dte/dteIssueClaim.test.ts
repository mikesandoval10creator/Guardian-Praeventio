import { describe, expect, it } from 'vitest';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore.js';
import { decideDteIssue } from './dteAutoIssueOrchestrator.js';
import {
  claimDteIssueEntry,
  DTE_ISSUE_CLAIMS_COLLECTION,
  finalizeDteIssueEntry,
} from './dteIssueClaim.js';
import { enqueue, markIssued } from './dteIssueQueue.js';
import {
  DTE_ISSUE_QUEUE_COLLECTION,
  queueEntryToDoc,
  type DteQueueInvoicePayload,
} from './dteIssueQueueStore.js';

const firstNow = new Date('2026-06-11T13:00:00.000Z');
const secondNow = new Date('2026-06-11T13:00:02.000Z');
const decision = decideDteIssue({
  paymentId: 'manual:inv-claim-fence-1',
  tenantId: 'uid-owner',
  payerInfo: { taxId: '76.123.456-0', legalName: 'Empresa SpA', email: 'pagos@empresa.cl' },
  amountClp: 50_000,
  planCode: 'comite-paritario',
  paymentGateway: 'manual',
  paidAt: firstNow.toISOString(),
});
const invoice: DteQueueInvoicePayload = {
  id: 'inv-claim-fence-1',
  status: 'paid',
  paidAt: firstNow.toISOString(),
  paymentMethod: 'manual-transfer',
  cliente: { nombre: 'Empresa SpA', rut: '76.123.456-0', email: 'pagos@empresa.cl' },
  lineItems: [{ tierId: 'comite-paritario', description: 'Suscripción', quantity: 1, unitAmount: 42_017, currency: 'CLP' }],
  totals: { subtotal: 42_017, iva: 7_983, total: 50_000, currency: 'CLP' },
};

function asDb(db: ReturnType<typeof createFakeFirestore>): Firestore {
  return db as unknown as Firestore;
}

describe('DTE issue claim fence', () => {
  it('rejects a stale worker from finalizing after a newer lease is reclaimed', async () => {
    const db = createFakeFirestore();
    const queueRef = db.collection(DTE_ISSUE_QUEUE_COLLECTION).doc(decision.idempotencyKey) as unknown as DocumentReference;
    const claimRef = db.collection(DTE_ISSUE_CLAIMS_COLLECTION).doc(decision.idempotencyKey) as unknown as DocumentReference;
    await queueRef.set(queueEntryToDoc(enqueue(decision, firstNow), invoice, 'mark-paid'));

    const firstClaim = await claimDteIssueEntry({
      db: asDb(db),
      queueRef,
      claimRef,
      now: firstNow,
      leaseMs: 1_000,
      token: 'worker-a-token',
    });
    expect(firstClaim.kind).toBe('claimed');
    if (firstClaim.kind !== 'claimed') return;

    const secondClaim = await claimDteIssueEntry({
      db: asDb(db),
      queueRef,
      claimRef,
      now: secondNow,
      leaseMs: 1_000,
      token: 'worker-b-token',
    });
    expect(secondClaim.kind).toBe('claimed');
    if (secondClaim.kind !== 'claimed') return;

    const staleFinalized = await finalizeDteIssueEntry({
      db: asDb(db),
      queueRef,
      claimRef,
      token: firstClaim.token,
      entry: markIssued(firstClaim.entry, { provider: 'test-pse', folio: 1 }, secondNow),
      invoice,
      source: 'mark-paid',
    });
    expect(staleFinalized).toBe(false);
    expect((db._store.get(`${DTE_ISSUE_QUEUE_COLLECTION}/${decision.idempotencyKey}`) as Record<string, unknown>).status).toBe('in_flight');

    const currentFinalized = await finalizeDteIssueEntry({
      db: asDb(db),
      queueRef,
      claimRef,
      token: secondClaim.token,
      entry: markIssued(secondClaim.entry, { provider: 'test-pse', folio: 2 }, secondNow),
      invoice,
      source: 'mark-paid',
    });
    expect(currentFinalized).toBe(true);
    expect((db._store.get(`${DTE_ISSUE_QUEUE_COLLECTION}/${decision.idempotencyKey}`) as Record<string, unknown>).status).toBe('succeeded');
    expect(db._store.has(`${DTE_ISSUE_CLAIMS_COLLECTION}/${decision.idempotencyKey}`)).toBe(false);
  });
});
