// Praeventio Guard — auditServerEvent helper unit test (CLAUDE.md #14).
//
// The helper must NEVER break the request path: on a Firestore failure it
// returns false (callers keep going) — but a broken COMPLIANCE trail must be
// VISIBLE in Sentry, not only in logs. This pins the failure path that the
// route-level tests (auditLog.test.ts) don't exercise (they only hit success).
//
// No supertest here (direct helper call) → no TCP server / open-handle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const captureException = vi.fn();
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException }),
}));

const addMock = vi.fn();
vi.mock('firebase-admin', () => ({
  default: {
    firestore: Object.assign(() => ({ collection: () => ({ add: addMock }) }), {
      FieldValue: { serverTimestamp: () => 'server-ts' },
    }),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { auditServerEvent } from '../../server/middleware/auditLog.js';

function fakeReq(uid?: string): Request {
  return {
    user: uid ? { uid, email: `${uid}@test.com` } : undefined,
    ip: '127.0.0.1',
    header: () => 'test-agent',
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auditServerEvent', () => {
  it('success → writes the row, returns true, does NOT touch Sentry', async () => {
    addMock.mockResolvedValueOnce({ id: 'audit-1' });
    const ok = await auditServerEvent(fakeReq('uid-A'), 'reports.export', 'reports', { n: 1 }, {
      projectId: 'proj-A',
    });
    expect(ok).toBe(true);
    expect(addMock).toHaveBeenCalledOnce();
    const row = addMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.userId).toBe('uid-A'); // server-stamped from req.user
    expect(row.action).toBe('reports.export');
    expect(captureException).not.toHaveBeenCalled();
  });

  it('Firestore failure → returns false (never throws) AND forwards to Sentry', async () => {
    addMock.mockRejectedValueOnce(new Error('firestore down'));
    const ok = await auditServerEvent(fakeReq('uid-A'), 'stoppage.declare', 'stoppage', {}, {});
    expect(ok).toBe(false); // request path is never broken by an audit failure
    expect(captureException).toHaveBeenCalledOnce();
    const [err, ctx] = captureException.mock.calls[0] as [Error, { tags?: Record<string, string> }];
    expect(err).toBeInstanceOf(Error);
    expect(ctx.tags?.action).toBe('stoppage.declare');
  });

  it('a throwing Sentry adapter is itself swallowed (observability never breaks the path)', async () => {
    addMock.mockRejectedValueOnce(new Error('firestore down'));
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry exploded');
    });
    // Must still resolve to false, not reject.
    await expect(
      auditServerEvent(fakeReq('uid-A'), 'a', 'm', {}, {}),
    ).resolves.toBe(false);
  });
});
