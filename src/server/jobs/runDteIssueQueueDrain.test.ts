// Praeventio Guard — B5/B15: DTE issue queue drain worker tests.
//
// Pinned contract:
//   • gate closed (DTE_AUTO_ISSUE off) → entries untouched, attempts unburned;
//   • success → succeeded + provider snapshot + audit row;
//   • transient failure → failed_retry with the dteIssueQueue backoff ladder;
//   • MAX_ATTEMPTS exhausted → permanent_failure + audit row + Sentry, never infinite;
//   • idempotent re-drain — succeeded entries are never re-attempted, and
//     entries whose nextAttemptAt is in the future are skipped.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

const H = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: H.captureException }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { runDteIssueQueueDrain } from './runDteIssueQueueDrain';
import { decideDteIssue, type DteIssueRequest } from '../../services/dte/dteAutoIssueOrchestrator';
import { enqueue, markFailed, markInFlight, MAX_ATTEMPTS } from '../../services/dte/dteIssueQueue';
import {
  DTE_ISSUE_QUEUE_COLLECTION,
  queueEntryToDoc,
  type DteQueueInvoicePayload,
} from '../../services/dte/dteIssueQueueStore';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const sampleReq: DteIssueRequest = {
  paymentId: 'manual:inv-q-1',
  tenantId: 'uid-owner',
  payerInfo: { taxId: '76.123.456-0', legalName: 'Empresa SpA', email: 'pagos@empresa.cl' },
  amountClp: 50000,
  planCode: 'comite-paritario',
  paymentGateway: 'manual',
  paidAt: '2026-06-11T12:00:00.000Z',
};
const decision = decideDteIssue(sampleReq);
const DOC_PATH = `${DTE_ISSUE_QUEUE_COLLECTION}/${decision.idempotencyKey}`;

const invoicePayload: DteQueueInvoicePayload = {
  id: 'inv-q-1',
  status: 'paid',
  paidAt: '2026-06-11T12:00:00.000Z',
  paymentMethod: 'manual-transfer',
  cliente: { nombre: 'Empresa SpA', rut: '76.123.456-0', email: 'pagos@empresa.cl' },
  lineItems: [{ tierId: 'comite-paritario', description: 'Suscripción', quantity: 1, unitAmount: 42017, currency: 'CLP' }],
  totals: { subtotal: 42017, iva: 7983, total: 50000, currency: 'CLP' },
};

type FakeDb = ReturnType<typeof createFakeFirestore>;

function asDb(db: FakeDb): Firestore {
  return db as unknown as Firestore;
}

const NOW = new Date('2026-06-11T13:00:00.000Z');

function auditRows(db: FakeDb): Array<Record<string, unknown>> {
  return [...db._store.keys()]
    .filter((k) => k.startsWith('audit_logs/'))
    .map((k) => db._store.get(k) as Record<string, unknown>);
}

beforeEach(() => {
  H.captureException.mockReset();
});

describe('runDteIssueQueueDrain — gate', () => {
  it('DTE_AUTO_ISSUE off → gateClosed, entries untouched, attempts unburned', async () => {
    const db = createFakeFirestore();
    db._seed(DOC_PATH, queueEntryToDoc(enqueue(decision, NOW), invoicePayload, 'mark-paid'));
    const issueDte = vi.fn();

    const result = await runDteIssueQueueDrain({
      db: asDb(db),
      now: () => NOW,
      autoIssueEnabled: false,
      issueDte,
    });

    expect(result.gateClosed).toBe(true);
    expect(result.scanned).toBe(0);
    expect(issueDte).not.toHaveBeenCalled();
    const doc = db._store.get(DOC_PATH) as Record<string, unknown>;
    expect(doc.status).toBe('pending');
    expect(doc.attempts).toBe(0);
  });
});

describe('runDteIssueQueueDrain — success path', () => {
  it('drains a pending entry → succeeded + provider snapshot + audit row', async () => {
    const db = createFakeFirestore();
    db._seed(DOC_PATH, queueEntryToDoc(enqueue(decision, NOW), invoicePayload, 'mark-paid'));
    const issueDte = vi.fn(async (_invoice: unknown) => ({
      ok: true,
      result: { ok: true, folio: 4321, trackingId: 'trk-1', pdfUrl: 'https://pse.test/4321.pdf' },
    }));

    const result = await runDteIssueQueueDrain({
      db: asDb(db),
      now: () => NOW,
      autoIssueEnabled: true,
      issueDte,
    });

    expect(result).toMatchObject({ scanned: 1, attempted: 1, issued: 1, retried: 0, permanentFailures: 0, errors: 0 });
    expect(issueDte).toHaveBeenCalledTimes(1);
    const invoiceArg = issueDte.mock.calls[0]![0] as { id: string; status: string };
    expect(invoiceArg.id).toBe('inv-q-1');
    expect(invoiceArg.status).toBe('paid');

    const doc = db._store.get(DOC_PATH) as Record<string, unknown>;
    expect(doc.status).toBe('succeeded');
    expect(doc.attempts).toBe(1);
    expect((doc.providerResponse as { folio: number }).folio).toBe(4321);

    const audits = auditRows(db);
    const issuedRow = audits.find((r) => r.action === 'dte.queue.issued');
    expect(issuedRow).toBeTruthy();
    expect((issuedRow!.details as Record<string, unknown>).invoiceId).toBe('inv-q-1');
    expect((issuedRow!.details as Record<string, unknown>).folio).toBe(4321);
    expect(H.captureException).not.toHaveBeenCalled();
  });

  it('idempotent re-drain — a succeeded entry is never re-attempted (no double-emit)', async () => {
    const db = createFakeFirestore();
    db._seed(DOC_PATH, queueEntryToDoc(enqueue(decision, NOW), invoicePayload, 'mark-paid'));
    const issueDte = vi.fn(async () => ({ ok: true, result: { ok: true, folio: 1 } }));

    await runDteIssueQueueDrain({ db: asDb(db), now: () => NOW, autoIssueEnabled: true, issueDte });
    const again = await runDteIssueQueueDrain({ db: asDb(db), now: () => NOW, autoIssueEnabled: true, issueDte });

    expect(issueDte).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ scanned: 0, attempted: 0, issued: 0 });
  });
});

describe('runDteIssueQueueDrain — retry/backoff path', () => {
  it('transient failure → failed_retry with backoff (attempt 1 → +1 min), no Sentry', async () => {
    const db = createFakeFirestore();
    db._seed(DOC_PATH, queueEntryToDoc(enqueue(decision, NOW), invoicePayload, 'mark-paid'));
    const issueDte = vi.fn(async () => ({ ok: false, errorMessage: 'bsale 503' }));

    const result = await runDteIssueQueueDrain({
      db: asDb(db),
      now: () => NOW,
      autoIssueEnabled: true,
      issueDte,
    });

    expect(result).toMatchObject({ scanned: 1, attempted: 1, issued: 0, retried: 1, permanentFailures: 0 });
    const doc = db._store.get(DOC_PATH) as Record<string, unknown>;
    expect(doc.status).toBe('failed_retry');
    expect(doc.attempts).toBe(1);
    expect(doc.lastError).toBe('bsale 503');
    // BACKOFF_SCHEDULE_MS[0] = 60_000 — next attempt 1 minute later.
    expect(doc.nextAttemptAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(H.captureException).not.toHaveBeenCalled();
    expect(auditRows(db)).toHaveLength(0);
  });

  it('entry whose nextAttemptAt is in the future is skipped (skippedNotDue)', async () => {
    const db = createFakeFirestore();
    const waiting = markFailed(markInFlight(enqueue(decision, NOW), NOW), 'bsale 503', NOW);
    db._seed(DOC_PATH, queueEntryToDoc(waiting, invoicePayload, 'mark-paid'));
    const issueDte = vi.fn();

    const result = await runDteIssueQueueDrain({
      db: asDb(db),
      now: () => NOW, // backoff pushed nextAttemptAt to NOW+1min
      autoIssueEnabled: true,
      issueDte,
    });

    expect(result).toMatchObject({ scanned: 1, skippedNotDue: 1, attempted: 0 });
    expect(issueDte).not.toHaveBeenCalled();
  });

  it('MAX_ATTEMPTS exhausted → permanent_failure + audit row + Sentry, never infinite', async () => {
    const db = createFakeFirestore();
    // Entry that already failed MAX_ATTEMPTS-1 times and is due now.
    const entry = {
      ...enqueue(decision, NOW),
      status: 'failed_retry' as const,
      attempts: MAX_ATTEMPTS - 1,
      lastError: 'bsale 503',
      nextAttemptAt: NOW.toISOString(),
    };
    db._seed(DOC_PATH, queueEntryToDoc(entry, invoicePayload, 'mark-paid'));
    const issueDte = vi.fn(async () => ({ ok: false, errorMessage: 'bsale still down' }));

    const result = await runDteIssueQueueDrain({
      db: asDb(db),
      now: () => NOW,
      autoIssueEnabled: true,
      issueDte,
    });

    expect(result).toMatchObject({ scanned: 1, attempted: 1, permanentFailures: 1, retried: 0 });
    const doc = db._store.get(DOC_PATH) as Record<string, unknown>;
    expect(doc.status).toBe('permanent_failure');
    expect(doc.attempts).toBe(MAX_ATTEMPTS);
    expect('nextAttemptAt' in doc).toBe(false); // terminal — never retried again

    const audits = auditRows(db);
    const failRow = audits.find((r) => r.action === 'dte.queue.permanent-failure');
    expect(failRow).toBeTruthy();
    expect((failRow!.details as Record<string, unknown>).lastError).toBe('bsale still down');
    expect((failRow!.details as Record<string, unknown>).invoiceId).toBe('inv-q-1');
    expect(H.captureException).toHaveBeenCalled();

    // Re-drain: terminal entry is excluded — no infinite loop, no new attempt.
    issueDte.mockClear();
    const again = await runDteIssueQueueDrain({ db: asDb(db), now: () => NOW, autoIssueEnabled: true, issueDte });
    expect(again.scanned).toBe(0);
    expect(issueDte).not.toHaveBeenCalled();
  });

  it('issueDte throwing (defensive) → counted as error + state persisted, drain continues', async () => {
    const db = createFakeFirestore();
    db._seed(DOC_PATH, queueEntryToDoc(enqueue(decision, NOW), invoicePayload, 'mark-paid'));
    const issueDte = vi.fn(async () => {
      throw new Error('unexpected explosion');
    });

    const result = await runDteIssueQueueDrain({
      db: asDb(db),
      now: () => NOW,
      autoIssueEnabled: true,
      issueDte,
    });

    expect(result.errors).toBe(1);
    const doc = db._store.get(DOC_PATH) as Record<string, unknown>;
    expect(doc.status).toBe('failed_retry');
    expect(H.captureException).toHaveBeenCalled();
  });
});
