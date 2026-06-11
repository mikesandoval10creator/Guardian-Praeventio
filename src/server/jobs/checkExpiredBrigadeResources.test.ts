// SPDX-License-Identifier: MIT
//
// Tests for `checkExpiredBrigadeResources` — Phase 5 arista A3 (2026-06).
//
// Brigade resources (extintores / DEA / botiquines / …) live in
// `tenants/{tid}/projects/{pid}/emergency_brigade` (docType='resource',
// see routes/emergencyBrigade.ts) and carry an ISO `nextExpirationAt`.
// Before this job nothing reaped them: an expired extinguisher only ever
// surfaced if a human opened the readiness report. The job closes the
// loop the same way checkExpiredPpe does: idempotency marker on the
// resource, deterministic finding in `projects/{pid}/findings`, audit
// row, in-app notification, best-effort supervisor push.

import { describe, it, expect, vi } from 'vitest';
import { checkExpiredBrigadeResources } from './checkExpiredBrigadeResources';

interface ResourceSeed {
  id: string;
  data: {
    docType?: string;
    kind?: string;
    location?: string;
    nextExpirationAt?: string | null;
    operational?: boolean;
    expiryFindingAt?: string;
  };
}

interface FindingSeed {
  id: string;
  data: Record<string, unknown>;
}

interface ProjectSeed {
  id: string;
  /** tenantId stored on the project doc; absent → job falls back to projectId. */
  tenantId?: string;
  resources: ResourceSeed[];
  findings?: FindingSeed[];
}

function makeFakeDb(projects: ProjectSeed[]) {
  const auditAdded: any[] = [];
  const notificationsAdded: Array<{ projectId: string; data: any }> = [];
  const resourceUpdates: Array<{
    projectId: string;
    resourceId: string;
    patch: any;
  }> = [];
  const findingsSet: Array<{ projectId: string; id: string; data: any }> = [];
  const brigadePathsQueried: string[] = [];

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
              data: () => (p.tenantId ? { tenantId: p.tenantId } : {}),
            })),
          }),
          doc(projectId: string) {
            const proj = projects.find((p) => p.id === projectId);
            return {
              collection(sub: string) {
                if (sub === 'notifications') {
                  return {
                    add: async (data: any) => {
                      notificationsAdded.push({ projectId, data });
                      return { id: 'notif_' + notificationsAdded.length };
                    },
                  };
                }
                if (sub === 'findings') {
                  return {
                    doc(findingId: string) {
                      return {
                        get: async () => {
                          const seeded = (proj?.findings ?? []).some(
                            (f) => f.id === findingId,
                          );
                          const written = findingsSet.some(
                            (f) =>
                              f.projectId === projectId && f.id === findingId,
                          );
                          return { exists: seeded || written };
                        },
                        set: async (data: any) => {
                          findingsSet.push({ projectId, id: findingId, data });
                        },
                      };
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
      // tenants/{tid}/projects/{pid}/emergency_brigade
      const m = /^tenants\/([^/]+)\/projects\/([^/]+)\/emergency_brigade$/.exec(
        name,
      );
      if (m) {
        brigadePathsQueried.push(name);
        const projectId = m[2];
        const tenantId = m[1];
        const proj = projects.find(
          (p) => p.id === projectId && (p.tenantId ?? p.id) === tenantId,
        );
        let docTypeFilter: string | null = null;
        const builder: any = {
          where(_field: string, _op: string, value: string) {
            docTypeFilter = value;
            return builder;
          },
          limit() {
            return builder;
          },
          get: async () => {
            const docs = (proj?.resources ?? [])
              .filter((r) =>
                docTypeFilter === null ? true : r.data.docType === docTypeFilter,
              )
              .map((r) => ({
                id: r.id,
                data: () => r.data,
                ref: {
                  update: vi.fn(async (patch: any) => {
                    resourceUpdates.push({
                      projectId: proj!.id,
                      resourceId: r.id,
                      patch,
                    });
                    Object.assign(r.data, patch);
                  }),
                },
              }));
            return { docs };
          },
        };
        return builder;
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };

  return {
    db,
    auditAdded,
    notificationsAdded,
    resourceUpdates,
    findingsSet,
    brigadePathsQueried,
  };
}

describe('checkExpiredBrigadeResources', () => {
  const NOW = new Date('2026-05-05T12:00:00Z');

  it('returns zeros when no projects exist', async () => {
    const { db } = makeFakeDb([]);
    const result = await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });
    expect(result).toEqual({
      scanned: 0,
      expired: 0,
      notified: 0,
      findingsCreated: 0,
    });
  });

  it('reaps an expired extinguisher: marker + critical finding + audit + notification + push', async () => {
    const {
      db,
      auditAdded,
      notificationsAdded,
      resourceUpdates,
      findingsSet,
    } = makeFakeDb([
      {
        id: 'p1',
        tenantId: 't1',
        resources: [
          {
            id: 'r1',
            data: {
              docType: 'resource',
              kind: 'extinguisher',
              location: 'Bodega Norte',
              nextExpirationAt: '2026-04-01T00:00:00Z',
              operational: true,
            },
          },
        ],
      },
    ]);

    const notify = vi.fn(async () => ({
      notified: 1,
      failed: 0,
      supervisorEmails: ['sup@x.com'],
    }));

    const result = await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      notifySupervisors: notify,
      now: () => NOW,
    });

    expect(result).toEqual({
      scanned: 1,
      expired: 1,
      notified: 1,
      findingsCreated: 1,
    });

    // Idempotency marker stamped on the resource doc.
    expect(resourceUpdates).toHaveLength(1);
    expect(resourceUpdates[0]).toMatchObject({
      projectId: 'p1',
      resourceId: 'r1',
    });
    expect(typeof resourceUpdates[0].patch.expiryFindingAt).toBe('string');

    // Deterministic finding in the canonical projects/{pid}/findings path.
    expect(findingsSet).toHaveLength(1);
    expect(findingsSet[0].projectId).toBe('p1');
    expect(findingsSet[0].id).toBe('brigade-expiry_r1');
    expect(findingsSet[0].data).toMatchObject({
      type: 'Condición Subestándar',
      status: 'Abierto',
      priority: 'Crítica', // life-safety kind (extinguisher)
      projectId: 'p1',
      reportedBy: 'sistema',
      resourceId: 'r1',
      resourceKind: 'extinguisher',
      source: 'brigade_resource_expiry',
    });
    expect(findingsSet[0].data.title).toContain('Extintor');
    expect(findingsSet[0].data.description).toContain('Bodega Norte');
    expect(findingsSet[0].data.description).toContain('01-04-2026');
    expect(findingsSet[0].data.createdAt).toBeInstanceOf(Date);

    // Audit row.
    expect(auditAdded).toHaveLength(1);
    expect(auditAdded[0]).toMatchObject({
      action: 'brigade.resource_expired',
      module: 'emergencyBrigade',
      projectId: 'p1',
      details: {
        resourceId: 'r1',
        kind: 'extinguisher',
        findingId: 'brigade-expiry_r1',
        findingCreated: true,
      },
    });

    // In-app notification + push.
    expect(notificationsAdded).toHaveLength(1);
    expect(notificationsAdded[0]).toMatchObject({
      projectId: 'p1',
      data: { kind: 'brigade.resource_expired', read: false },
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('uses priority Alta for non life-critical kinds (first_aid_kit)', async () => {
    const { db, findingsSet } = makeFakeDb([
      {
        id: 'p1',
        tenantId: 't1',
        resources: [
          {
            id: 'r2',
            data: {
              docType: 'resource',
              kind: 'first_aid_kit',
              location: 'Comedor',
              nextExpirationAt: '2026-04-01T00:00:00Z',
            },
          },
        ],
      },
    ]);

    await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });

    expect(findingsSet).toHaveLength(1);
    expect(findingsSet[0].data.priority).toBe('Alta');
    expect(findingsSet[0].data.title).toContain('Botiquín');
  });

  it('a second run does not duplicate (expiryFindingAt marker is the gate)', async () => {
    const { db, findingsSet, auditAdded, notificationsAdded } = makeFakeDb([
      {
        id: 'p1',
        tenantId: 't1',
        resources: [
          {
            id: 'r1',
            data: {
              docType: 'resource',
              kind: 'aed',
              location: 'Acceso principal',
              nextExpirationAt: '2026-04-01T00:00:00Z',
            },
          },
        ],
      },
    ]);

    const opts = {
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    };
    const first = await checkExpiredBrigadeResources(opts);
    const second = await checkExpiredBrigadeResources(opts);

    expect(first.expired).toBe(1);
    expect(first.findingsCreated).toBe(1);
    expect(second).toEqual({
      scanned: 1,
      expired: 0,
      notified: 0,
      findingsCreated: 0,
    });
    expect(findingsSet).toHaveLength(1);
    expect(auditAdded).toHaveLength(1);
    expect(notificationsAdded).toHaveLength(1);
  });

  it('does not clobber a pre-existing finding on crash-replay (no marker yet)', async () => {
    const { db, findingsSet, resourceUpdates, auditAdded } = makeFakeDb([
      {
        id: 'p1',
        tenantId: 't1',
        resources: [
          {
            id: 'r1',
            data: {
              docType: 'resource',
              kind: 'extinguisher',
              location: 'Bodega Norte',
              nextExpirationAt: '2026-04-01T00:00:00Z',
            },
          },
        ],
        findings: [{ id: 'brigade-expiry_r1', data: { status: 'Cerrado' } }],
      },
    ]);

    const result = await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });

    expect(result.findingsCreated).toBe(0);
    expect(findingsSet).toHaveLength(0);
    // Marker + audit still written so the next pass skips cleanly.
    expect(resourceUpdates).toHaveLength(1);
    expect(auditAdded).toHaveLength(1);
    expect(auditAdded[0].details).toMatchObject({ findingCreated: false });
  });

  it('skips resources whose nextExpirationAt is in the future or missing', async () => {
    const { db, findingsSet, resourceUpdates, auditAdded } = makeFakeDb([
      {
        id: 'p1',
        tenantId: 't1',
        resources: [
          {
            id: 'r-future',
            data: {
              docType: 'resource',
              kind: 'extinguisher',
              location: 'Bodega Sur',
              nextExpirationAt: '2027-01-01T00:00:00Z',
            },
          },
          {
            id: 'r-noexp',
            data: {
              docType: 'resource',
              kind: 'aed',
              location: 'Casino',
              nextExpirationAt: null,
            },
          },
        ],
      },
    ]);

    const result = await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });

    expect(result).toEqual({
      scanned: 2,
      expired: 0,
      notified: 0,
      findingsCreated: 0,
    });
    expect(findingsSet).toHaveLength(0);
    expect(resourceUpdates).toHaveLength(0);
    expect(auditAdded).toHaveLength(0);
  });

  it('falls back to projectId when the project doc has no tenantId', async () => {
    const { db, findingsSet, brigadePathsQueried } = makeFakeDb([
      {
        id: 'p-legacy',
        // no tenantId → legacy project; data lives under tenants/p-legacy/…
        resources: [
          {
            id: 'r1',
            data: {
              docType: 'resource',
              kind: 'spill_kit',
              location: 'Patio químico',
              nextExpirationAt: '2026-04-01T00:00:00Z',
            },
          },
        ],
      },
    ]);

    const result = await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      now: () => NOW,
    });

    expect(brigadePathsQueried).toContain(
      'tenants/p-legacy/projects/p-legacy/emergency_brigade',
    );
    expect(result.expired).toBe(1);
    expect(findingsSet).toHaveLength(1);
  });

  it('does not abort the scan when the supervisor push throws', async () => {
    const { db, auditAdded, resourceUpdates } = makeFakeDb([
      {
        id: 'p1',
        tenantId: 't1',
        resources: [
          {
            id: 'r1',
            data: {
              docType: 'resource',
              kind: 'extinguisher',
              location: 'Bodega Norte',
              nextExpirationAt: '2026-04-01T00:00:00Z',
            },
          },
          {
            id: 'r2',
            data: {
              docType: 'resource',
              kind: 'eyewash',
              location: 'Laboratorio',
              nextExpirationAt: '2026-04-02T00:00:00Z',
            },
          },
        ],
      },
    ]);

    const notify = vi.fn(async () => {
      throw new Error('FCM down');
    });

    const result = await checkExpiredBrigadeResources({
      getDb: () => db as any,
      getMessaging: () => ({} as any),
      notifySupervisors: notify,
      now: () => NOW,
    });

    expect(result.scanned).toBe(2);
    expect(result.expired).toBe(2);
    expect(result.notified).toBe(0);
    expect(result.findingsCreated).toBe(2);
    expect(resourceUpdates).toHaveLength(2);
    expect(auditAdded).toHaveLength(2);
  });
});
