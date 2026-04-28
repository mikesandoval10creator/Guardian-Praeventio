// Praeventio Guard — assertProjectMember() unit tests.
//
// Round 14 (A5 audit) — Several server endpoints accept a `projectId` from
// req.body and write to /projects/{id}/... without checking that the caller
// is a member of that project. The mitigation is `assertProjectMember`:
// a tiny helper that resolves the project doc and verifies the caller's
// uid is in `members[]` (or is `createdBy`). This file pins the contract.
//
// We don't mock firebase-admin globally; the helper takes a `MinimalDb`
// parameter so the test injects an in-memory fake. The production caller
// (server.ts) injects `admin.firestore()`.

import { describe, it, expect, vi } from 'vitest';
import {
  assertProjectMember,
  ProjectMembershipError,
  type MinimalProjectsDb,
} from './projectMembership.js';

function makeDb(initial: Record<string, { exists: boolean; data?: any }>): MinimalProjectsDb {
  return {
    collection(name: string) {
      expect(name).toBe('projects');
      return {
        doc(id: string) {
          return {
            get: async () => {
              const entry = initial[id];
              return {
                exists: !!entry?.exists,
                data: () => entry?.data,
              };
            },
          };
        },
      };
    },
  };
}

describe('assertProjectMember', () => {
  it('resolves silently when caller is in members[]', async () => {
    const db = makeDb({
      'p-1': { exists: true, data: { members: ['uid-A', 'uid-B'] } },
    });
    await expect(
      assertProjectMember('uid-B', 'p-1', db),
    ).resolves.toBeUndefined();
  });

  it('resolves silently when caller is the createdBy field', async () => {
    // A project may only have its creator (no members[] yet) and we still
    // want them to pass — they are implicitly a member of their own project.
    const db = makeDb({
      'p-2': { exists: true, data: { createdBy: 'uid-creator', members: [] } },
    });
    await expect(
      assertProjectMember('uid-creator', 'p-2', db),
    ).resolves.toBeUndefined();
  });

  it('throws ProjectMembershipError (403) when project doc is missing', async () => {
    const db = makeDb({});
    await expect(assertProjectMember('uid-X', 'ghost', db)).rejects.toBeInstanceOf(
      ProjectMembershipError,
    );
    try {
      await assertProjectMember('uid-X', 'ghost', db);
    } catch (e: any) {
      expect(e.httpStatus).toBe(403);
    }
  });

  it('throws ProjectMembershipError when caller is NOT in members[] and not creator', async () => {
    const db = makeDb({
      'p-3': { exists: true, data: { members: ['uid-A'], createdBy: 'uid-A' } },
    });
    await expect(assertProjectMember('uid-Z', 'p-3', db)).rejects.toBeInstanceOf(
      ProjectMembershipError,
    );
  });

  it('throws ProjectMembershipError when members is missing entirely and createdBy mismatches', async () => {
    const db = makeDb({
      'p-4': { exists: true, data: { name: 'Faena Norte' } },
    });
    await expect(assertProjectMember('uid-A', 'p-4', db)).rejects.toBeInstanceOf(
      ProjectMembershipError,
    );
  });

  it('does not throw on Firestore errors silently — propagates the original error', async () => {
    // Belt-and-suspenders: a Firestore outage should NOT be silently
    // swallowed as "not a member" — that would mask infra alerts.
    const brokenDb: MinimalProjectsDb = {
      collection() {
        return {
          doc() {
            return {
              get: vi.fn(async () => {
                throw new Error('firestore unreachable');
              }),
            };
          },
        };
      },
    };
    await expect(assertProjectMember('uid-A', 'p-5', brokenDb)).rejects.toThrow(
      /firestore unreachable/,
    );
  });
});
