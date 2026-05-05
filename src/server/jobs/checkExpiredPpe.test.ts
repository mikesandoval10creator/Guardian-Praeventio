// SPDX-License-Identifier: MIT
//
// Tests for `checkExpiredPpe` — Sprint 28 H26.
//
// Mirrors the Firestore fake pattern used by checkOverdueMaintenance.test.ts:
// minimal in-memory shape that supports collection→doc→collection→get/update,
// `where('status','==',...)` filtering, and `.add()` capturing.

import { describe, it, expect, vi } from 'vitest';
import { checkExpiredPpe } from './checkExpiredPpe';

interface AssignmentSeed {
  id: string;
  data: {
    workerId?: string;
    workerName?: string;
    eppItemId?: string;
    eppItemName?: string;
    expiresAt?: string | null;
    status?: string;
  };
}

interface ProjectSeed {
  id: string;
  assignments: AssignmentSeed[];
}

function makeFakeDb(projects: ProjectSeed[]) {
  const auditAdded: any[] = [];
  const notificationsAdded: Array<{ projectId: string; data: any }> = [];
  const assignmentUpdates: Array<{
    projectId: string;
    assignmentId: string;
    patch: any;
  }> = [];

  const db: any = {
    collection(name: string) {
      if (name === 'projects') {
        return {
          limit() {
            return this;
          },
          get: async () => ({
            docs: projects.map((p) => ({
              id: p.id,
              data: () => ({}),
            })),
          }),
          doc(projectId: string) {
            const proj = projects.find((p) => p.id === projectId);
            return {
              collection(sub: string) {
                if (sub === 'epp_assignments') {
                  let statusFilter: string | null = null;
                  const builder: any = {
                    where(_field: string, _op: string, value: string) {
                      statusFilter = value;
                      return builder;
                    },
                    limit() {
                      return builder;
                    },
                    get: async () => {
                      const docs = (proj?.assignments ?? [])
                        .filter((a) =>
                          statusFilter === null
                            ? true
                            : a.data.status === statusFilter,
                        )
                        .map((a) => ({
                          id: a.id,
                          data: () => a.data,
                          ref: {
                            update: vi.fn(async (patch: any) => {
                              assignmentUpdates.push({
                                projectId: proj!.id,
                                assignmentId: a.id,
                                patch,
                              });
                              Object.assign(a.data, patch);
                            }),
                          },
                        }));
                      return { docs };
                    },
                  };
                  return builder;
                }
                if (sub === 'notifications') {
                  return {
                    add: async (data: any) => {
                      notificationsAdded.push({ projectId, data });
                      return { id: 'notif_' + notificationsAdded.length };
                    },
                  };
                }
                throw new Error(`unexpected sub-collection ${sub}`);
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

  return { db, auditAdded, notificationsAdded, assignmentUpdates };
}

describe('checkExpiredPpe', () => {
  const NOW = new Date('2026-05-05T12:00:00Z');

  it('returns zeros when no projects exist', async () => {
    const { db } = makeFakeDb([]);
    const result = await checkExpiredPpe({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });
    expect(result).toEqual({ scanned: 0, expired: 0, notified: 0 });
  });

  it('flips an expired active assignment to expired and emits audit + notification', async () => {
    const { db, auditAdded, notificationsAdded, assignmentUpdates } =
      makeFakeDb([
        {
          id: 'p1',
          assignments: [
            {
              id: 'a1',
              data: {
                workerId: 'w1',
                workerName: 'Alice',
                eppItemId: 'casco',
                eppItemName: 'Casco',
                expiresAt: '2026-04-01T00:00:00Z',
                status: 'active',
              },
            },
          ],
        },
      ]);

    const notify = vi.fn(async () => ({
      notified: 2,
      failed: 0,
      supervisorEmails: ['sup@x.com'],
    }));

    const result = await checkExpiredPpe({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      notifySupervisors: notify,
      now: () => NOW,
    });

    expect(result).toEqual({ scanned: 1, expired: 1, notified: 2 });
    expect(assignmentUpdates).toHaveLength(1);
    expect(assignmentUpdates[0].patch.status).toBe('expired');

    expect(auditAdded).toHaveLength(1);
    expect(auditAdded[0]).toMatchObject({
      action: 'ppe.expired',
      module: 'epp',
      projectId: 'p1',
    });

    expect(notificationsAdded).toHaveLength(1);
    expect(notificationsAdded[0]).toMatchObject({
      projectId: 'p1',
      data: { kind: 'ppe.expired', read: false },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const firstCallArg = (notify.mock.calls as any[])[0]?.[0] as
      | { projectId: string }
      | undefined;
    expect(firstCallArg?.projectId).toBe('p1');
  });

  it('skips assignments whose expiresAt is still in the future', async () => {
    const { db, auditAdded, assignmentUpdates } = makeFakeDb([
      {
        id: 'p1',
        assignments: [
          {
            id: 'a-future',
            data: {
              workerId: 'w1',
              eppItemName: 'Casco',
              expiresAt: '2027-01-01T00:00:00Z',
              status: 'active',
            },
          },
        ],
      },
    ]);

    const result = await checkExpiredPpe({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });

    expect(result).toEqual({ scanned: 1, expired: 0, notified: 0 });
    expect(assignmentUpdates).toHaveLength(0);
    expect(auditAdded).toHaveLength(0);
  });

  it('ignores active assignments missing expiresAt entirely', async () => {
    const { db, auditAdded, assignmentUpdates } = makeFakeDb([
      {
        id: 'p1',
        assignments: [
          {
            id: 'a-noexp',
            data: {
              workerId: 'w1',
              eppItemName: 'Guantes',
              expiresAt: null,
              status: 'active',
            },
          },
        ],
      },
    ]);

    const result = await checkExpiredPpe({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });

    expect(result).toEqual({ scanned: 1, expired: 0, notified: 0 });
    expect(assignmentUpdates).toHaveLength(0);
    expect(auditAdded).toHaveLength(0);
  });

  it('does not abort the scan when supervisor notification throws', async () => {
    const { db, auditAdded, assignmentUpdates } = makeFakeDb([
      {
        id: 'p1',
        assignments: [
          {
            id: 'a1',
            data: {
              workerId: 'w1',
              eppItemName: 'Casco',
              expiresAt: '2026-04-01T00:00:00Z',
              status: 'active',
            },
          },
          {
            id: 'a2',
            data: {
              workerId: 'w2',
              eppItemName: 'Guantes',
              expiresAt: '2026-04-02T00:00:00Z',
              status: 'active',
            },
          },
        ],
      },
    ]);

    const notify = vi.fn(async () => {
      throw new Error('FCM down');
    });

    const result = await checkExpiredPpe({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      notifySupervisors: notify,
      now: () => NOW,
    });

    // Both assignments still flipped + audited despite FCM error.
    expect(result.scanned).toBe(2);
    expect(result.expired).toBe(2);
    expect(result.notified).toBe(0);
    expect(assignmentUpdates).toHaveLength(2);
    expect(auditAdded).toHaveLength(2);
  });
});
