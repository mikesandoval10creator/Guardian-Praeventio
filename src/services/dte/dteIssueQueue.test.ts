// Praeventio Guard — Sprint 49 D.8.b: dteIssueQueue unit tests.

import { describe, expect, it } from 'vitest';
import { decideDteIssue, type DteIssueRequest } from './dteAutoIssueOrchestrator';
import {
  BACKOFF_SCHEDULE_MS,
  enqueue,
  markFailed,
  markInFlight,
  markIssued,
  MAX_ATTEMPTS,
  shouldRetry,
} from './dteIssueQueue';

const sampleReq: DteIssueRequest = {
  paymentId: 'pay_queue_1',
  tenantId: 'tenant_queue',
  payerInfo: { taxId: '76.123.456-0', legalName: 'Empresa SpA' },
  amountClp: 11990,
  planCode: 'pro',
  paymentGateway: 'webpay',
  paidAt: '2026-05-13T10:00:00.000Z',
};

const decisionFor = (req = sampleReq) => decideDteIssue(req);

describe('enqueue', () => {
  it('crea entry pending con nextAttemptAt = now', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const entry = enqueue(decisionFor(), now);
    expect(entry.status).toBe('pending');
    expect(entry.attempts).toBe(0);
    expect(entry.nextAttemptAt).toBe(now.toISOString());
    expect(entry.createdAt).toBe(now.toISOString());
    expect(entry.idempotencyKey).toBe(decisionFor().idempotencyKey);
  });
});

describe('shouldRetry', () => {
  it('pending con nextAttemptAt en el pasado → true', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const entry = enqueue(decisionFor(), now);
    expect(shouldRetry(entry, new Date(now.getTime() + 1_000))).toBe(true);
  });

  it('failed_retry con nextAttemptAt en el futuro → false', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const fresh = markInFlight(enqueue(decisionFor(), now), now);
    const failed = markFailed(fresh, 'transient', now);
    // Backoff for attempt 1 = 60s; check 30s later → still no retry.
    expect(shouldRetry(failed, new Date(now.getTime() + 30_000))).toBe(false);
  });

  it('succeeded → false (no retry de un éxito)', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const inFlight = markInFlight(enqueue(decisionFor(), now), now);
    const done = markIssued(inFlight, { provider: 'bsale', folio: 123 }, now);
    expect(shouldRetry(done, new Date(now.getTime() + 24 * 3600_000))).toBe(false);
  });

  it('permanent_failure → false', () => {
    let entry = enqueue(decisionFor(), new Date('2026-05-13T00:00:00Z'));
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      entry = markInFlight(entry);
      entry = markFailed(entry, `err ${i}`);
    }
    expect(entry.status).toBe('permanent_failure');
    expect(shouldRetry(entry)).toBe(false);
  });

  it('in_flight → false (otro worker está procesando)', () => {
    const entry = markInFlight(enqueue(decisionFor()));
    expect(shouldRetry(entry)).toBe(false);
  });
});

describe('markFailed — backoff exponencial', () => {
  it('attempt 1 fail → backoff = 60s', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const fresh = markInFlight(enqueue(decisionFor(), now), now);
    const failed = markFailed(fresh, 'PSE timeout', now);
    expect(failed.status).toBe('failed_retry');
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe('PSE timeout');
    const expectedNext = new Date(now.getTime() + BACKOFF_SCHEDULE_MS[0]).toISOString();
    expect(failed.nextAttemptAt).toBe(expectedNext);
  });

  it('attempts 1..MAX_ATTEMPTS progresivos siguen la escalera', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    let entry = enqueue(decisionFor(), now);
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      entry = markInFlight(entry, now);
      entry = markFailed(entry, `err ${i + 1}`, now);
      expect(entry.status).toBe('failed_retry');
      expect(entry.attempts).toBe(i + 1);
      const expectedNext = new Date(now.getTime() + BACKOFF_SCHEDULE_MS[i]).toISOString();
      expect(entry.nextAttemptAt).toBe(expectedNext);
    }
  });

  it('fail tras MAX_ATTEMPTS intentos → permanent_failure', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    let entry = enqueue(decisionFor(), now);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      entry = markInFlight(entry, now);
      entry = markFailed(entry, `err ${i + 1}`, now);
    }
    expect(entry.status).toBe('permanent_failure');
    expect(entry.attempts).toBe(MAX_ATTEMPTS);
    expect(entry.nextAttemptAt).toBeUndefined();
    expect(entry.lastError).toBe(`err ${MAX_ATTEMPTS}`);
  });
});

describe('markIssued — terminal success', () => {
  it('limpia lastError + nextAttemptAt, stamps providerResponse', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const fresh = markInFlight(enqueue(decisionFor(), now), now);
    const failed = markFailed(fresh, 'transient', now);
    const retried = markInFlight(failed, now);
    const done = markIssued(
      retried,
      { provider: 'bsale', folio: 9001, trackId: 'trk_abc', pdfUrl: 'https://pse.example/9001.pdf' },
      now,
    );
    expect(done.status).toBe('succeeded');
    expect(done.lastError).toBeUndefined();
    expect(done.nextAttemptAt).toBeUndefined();
    expect(done.providerResponse?.provider).toBe('bsale');
    expect(done.providerResponse?.folio).toBe(9001);
  });
});

describe('markInFlight', () => {
  it('incrementa attempts y transiciona a in_flight', () => {
    const entry = enqueue(decisionFor());
    const after = markInFlight(entry);
    expect(after.status).toBe('in_flight');
    expect(after.attempts).toBe(1);
  });
});

describe('integration — happy path end-to-end', () => {
  it('enqueue → in_flight → markIssued → no retry', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    const entry = enqueue(decisionFor(), now);
    const dispatched = markInFlight(entry, now);
    const done = markIssued(dispatched, { provider: 'bsale', folio: 1 }, now);
    expect(done.status).toBe('succeeded');
    expect(shouldRetry(done, new Date(now.getTime() + 365 * 86400_000))).toBe(false);
  });

  it('enqueue → 4 fails → 5th succeeds', () => {
    const now = new Date('2026-05-13T12:00:00Z');
    let entry = enqueue(decisionFor(), now);
    for (let i = 0; i < 4; i++) {
      entry = markInFlight(entry, now);
      entry = markFailed(entry, `err ${i + 1}`, now);
      expect(entry.status).toBe('failed_retry');
    }
    entry = markInFlight(entry, now);
    expect(entry.attempts).toBe(5);
    entry = markIssued(entry, { provider: 'bsale', folio: 42 }, now);
    expect(entry.status).toBe('succeeded');
  });
});
