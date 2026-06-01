// SPDX-License-Identifier: MIT
//
// Tests for `sendSusesoReminders` — Sprint 28 follow-up.
//
// Mirrors the in-memory Firestore fake from checkExpiredPpe.test.ts:
// minimal collection→doc→collection chain that supports limit + get +
// doc-ref.update + audit_logs.add.

import { describe, it, expect, vi } from 'vitest';
import { sendSusesoReminders } from './sendSusesoReminders';
import { logger } from '../../utils/logger.js';

// Silent-failure fix (2026-06-01): the per-recipient / marker / audit-write
// catches now log instead of swallowing. Mock the logger so a forced dispatch
// failure can assert the event surfaces AND the scan still completes (the
// non-abort invariant is preserved).
vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

interface FormSeed {
  id: string;
  data: any;
}

interface TenantSeed {
  id: string;
  forms: FormSeed[];
  members?: Array<{ uid: string; role: string }>;
  projectId?: string;
}

function makeFakeDb(tenants: TenantSeed[]) {
  const auditAdded: any[] = [];
  const formUpdates: Array<{ tenantId: string; formId: string; patch: any }> = [];

  const db: any = {
    collection(name: string) {
      if (name === 'tenants') {
        return {
          limit() {
            return this;
          },
          get: async () => ({
            docs: tenants.map((t) => ({ id: t.id, data: () => ({}) })),
          }),
          doc(tenantId: string) {
            const tenant = tenants.find((t) => t.id === tenantId);
            return {
              collection(sub: string) {
                if (sub !== 'suseso_forms') {
                  throw new Error(`unexpected sub-collection ${sub}`);
                }
                return {
                  limit() {
                    return this;
                  },
                  get: async () => ({
                    docs: (tenant?.forms ?? []).map((f) => ({
                      id: f.id,
                      data: () => f.data,
                      ref: {
                        update: vi.fn(async (patch: any) => {
                          formUpdates.push({ tenantId, formId: f.id, patch });
                          Object.assign(f.data, patch);
                        }),
                      },
                    })),
                  }),
                };
              },
            };
          },
        };
      }
      if (name === 'projects') {
        return {
          doc(projectId: string) {
            const tenantWithProject = tenants.find(
              (t) => t.projectId === projectId,
            );
            return {
              collection(sub: string) {
                if (sub !== 'members') {
                  throw new Error(`unexpected sub ${sub}`);
                }
                return {
                  get: async () => ({
                    docs: (tenantWithProject?.members ?? []).map((m) => ({
                      id: m.uid,
                      data: () => ({ role: m.role }),
                    })),
                  }),
                };
              },
            };
          },
        };
      }
      if (name === 'audit_logs') {
        return {
          add: async (data: any) => {
            auditAdded.push(data);
            return { id: 'audit_' + auditAdded.length };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  return { db, auditAdded, formUpdates };
}

describe('sendSusesoReminders', () => {
  const NOW = new Date('2026-05-05T12:00:00Z');

  it('returns zeros when no tenants exist', async () => {
    const { db } = makeFakeDb([]);
    const dispatcher = vi.fn(async () => ({ pushSent: false, emailSent: false }));
    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });
    expect(result.scanned).toBe(0);
    expect(result.remindedTotal).toBe(0);
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('reminds gerente + creator + worker (DIAT) for a pending form', async () => {
    const { db, formUpdates, auditAdded } = makeFakeDb([
      {
        id: 'tenantA',
        projectId: 'proj1',
        members: [
          { uid: 'gerente1', role: 'gerente' },
          { uid: 'sup1', role: 'supervisor' },
          { uid: 'op1', role: 'operario' },
        ],
        forms: [
          {
            id: 'form1',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-05-08T12:00:00Z', // 3 days left → yellow
              incidentDate: '2026-05-03T12:00:00Z',
              workerUid: 'worker1',
              projectId: 'proj1',
              reportedBy: { uid: 'creator1' },
              remindersSent: [],
            },
          },
        ],
      },
    ]);

    const dispatcher = vi.fn(async () => ({ pushSent: true, emailSent: true }));

    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });

    expect(result.scanned).toBe(1);
    // 4 recipients (gerente, supervisor, creator, worker) × 2 channels = 8
    expect(result.remindedTotal).toBe(8);
    expect(result.escalations.yellow).toBe(1);

    // Operario should NOT have been reminded.
    const recipients = dispatcher.mock.calls.map((c: any[]) => c[0].recipientUid);
    expect(recipients).toContain('gerente1');
    expect(recipients).toContain('sup1');
    expect(recipients).toContain('creator1');
    expect(recipients).toContain('worker1');
    expect(recipients).not.toContain('op1');

    expect(formUpdates).toHaveLength(1);
    expect(formUpdates[0].patch.remindersSent).toHaveLength(8);

    expect(auditAdded).toHaveLength(1);
    expect(auditAdded[0]).toMatchObject({
      action: 'suseso.deadline.reminded',
      module: 'suseso',
    });
  });

  it('logs dispatch_failed and continues the scan when a recipient send throws', async () => {
    vi.mocked(logger.warn).mockClear();
    const { db, auditAdded, formUpdates } = makeFakeDb([
      {
        id: 'tenantA',
        projectId: 'proj1',
        members: [{ uid: 'gerente1', role: 'gerente' }],
        forms: [
          {
            id: 'form1',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-05-08T12:00:00Z', // 3 days left
              incidentDate: '2026-05-03T12:00:00Z',
              workerUid: 'worker1',
              projectId: 'proj1',
              reportedBy: { uid: 'creator1' },
              remindersSent: [],
            },
          },
        ],
      },
    ]);
    // Every per-recipient dispatch throws (e.g. FCM/email provider down).
    const dispatcher = vi.fn(async () => {
      throw new Error('FCM unavailable');
    });

    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });

    // Non-abort invariant: the scan still completes and reports the form.
    expect(result.scanned).toBe(1);
    // Nothing was delivered → no reminders counted, no marker update, no audit row.
    expect(result.remindedTotal).toBe(0);
    expect(formUpdates).toHaveLength(0);
    expect(auditAdded).toHaveLength(0);
    // ...but the failure is no longer silent (the whole point of the fix).
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'suseso_reminder.dispatch_failed',
      expect.objectContaining({ recipientUid: 'gerente1' }),
    );
  });

  it('does NOT spam forms already submitted_by_company', async () => {
    const { db, formUpdates } = makeFakeDb([
      {
        id: 'tenantA',
        projectId: 'proj1',
        members: [{ uid: 'gerente1', role: 'gerente' }],
        forms: [
          {
            id: 'form_done',
            data: {
              kind: 'DIAT',
              status: 'submitted_by_company',
              legalDeadline: '2026-05-08T12:00:00Z',
              workerUid: 'w1',
              projectId: 'proj1',
              reportedBy: { uid: 'c1' },
              remindersSent: [],
            },
          },
        ],
      },
    ]);

    const dispatcher = vi.fn(async () => ({ pushSent: true, emailSent: true }));

    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });

    expect(result.scanned).toBe(1);
    expect(result.remindedTotal).toBe(0);
    expect(dispatcher).not.toHaveBeenCalled();
    expect(formUpdates).toHaveLength(0);
  });

  it('is idempotent on the same UTC day (no double-reminders)', async () => {
    const todayStamp = '2026-05-05T08:00:00.000Z'; // earlier today UTC
    const { db, formUpdates } = makeFakeDb([
      {
        id: 'tenantA',
        projectId: 'proj1',
        members: [{ uid: 'gerente1', role: 'gerente' }],
        forms: [
          {
            id: 'form_x',
            data: {
              kind: 'DIEP',
              status: 'pending',
              legalDeadline: '2026-05-09T12:00:00Z',
              workerUid: 'w1',
              projectId: 'proj1',
              reportedBy: { uid: 'creator1' },
              remindersSent: [
                { sentAt: todayStamp, channel: 'push', recipientUid: 'gerente1' },
                { sentAt: todayStamp, channel: 'email', recipientUid: 'gerente1' },
                { sentAt: todayStamp, channel: 'push', recipientUid: 'creator1' },
                { sentAt: todayStamp, channel: 'email', recipientUid: 'creator1' },
              ],
            },
          },
        ],
      },
    ]);

    const dispatcher = vi.fn(async () => ({ pushSent: true, emailSent: true }));

    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });

    // DIEP → no worker recipient, only gerente + creator. Both already
    // notified today, so dispatcher fires zero times.
    expect(result.scanned).toBe(1);
    expect(result.remindedTotal).toBe(0);
    expect(dispatcher).not.toHaveBeenCalled();
    expect(formUpdates).toHaveLength(0);
  });

  it('skips stale forms whose deadline elapsed > 7 days ago', async () => {
    const { db } = makeFakeDb([
      {
        id: 'tenantA',
        projectId: 'proj1',
        members: [{ uid: 'gerente1', role: 'gerente' }],
        forms: [
          {
            id: 'form_stale',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-04-01T00:00:00Z', // > 7d before NOW
              workerUid: 'w1',
              projectId: 'proj1',
              reportedBy: { uid: 'c1' },
              remindersSent: [],
            },
          },
        ],
      },
    ]);

    const dispatcher = vi.fn(async () => ({ pushSent: true, emailSent: true }));
    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });

    expect(result.scanned).toBe(1);
    expect(result.remindedTotal).toBe(0);
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('classifies escalations: green/yellow/orange/red/overdue', async () => {
    const { db } = makeFakeDb([
      {
        id: 'tenantA',
        projectId: 'proj1',
        members: [{ uid: 'g1', role: 'gerente' }],
        forms: [
          // 6 days left → green
          {
            id: 'g',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-05-11T12:00:00Z',
              projectId: 'proj1',
              reportedBy: { uid: 'c' },
              remindersSent: [],
            },
          },
          // 3 days left → yellow
          {
            id: 'y',
            data: {
              kind: 'DIEP',
              status: 'pending',
              legalDeadline: '2026-05-08T12:00:00Z',
              projectId: 'proj1',
              reportedBy: { uid: 'c' },
              remindersSent: [],
            },
          },
          // 1 day left → orange
          {
            id: 'o',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-05-06T12:00:00Z',
              projectId: 'proj1',
              reportedBy: { uid: 'c' },
              remindersSent: [],
            },
          },
          // today → red
          {
            id: 'r',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-05-05T18:00:00Z',
              projectId: 'proj1',
              reportedBy: { uid: 'c' },
              remindersSent: [],
            },
          },
          // -2 días → overdue (still <7d so it gets reminded)
          {
            id: 'ov',
            data: {
              kind: 'DIAT',
              status: 'pending',
              legalDeadline: '2026-05-03T12:00:00Z',
              projectId: 'proj1',
              reportedBy: { uid: 'c' },
              remindersSent: [],
            },
          },
        ],
      },
    ]);

    const dispatcher = vi.fn(async () => ({ pushSent: true, emailSent: false }));
    const result = await sendSusesoReminders({
      getDb: () => db,
      dispatcher,
      now: () => NOW,
    });

    expect(result.scanned).toBe(5);
    expect(result.escalations).toEqual({
      green: 1,
      yellow: 1,
      orange: 1,
      red: 1,
      overdue: 1,
    });
  });
});
