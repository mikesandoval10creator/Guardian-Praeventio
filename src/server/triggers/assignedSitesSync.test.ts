import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  membersOf,
  syncUserAssignedSites,
  type AssignedSitesSyncDeps,
} from './assignedSitesSync';

// Minimal fakes mirroring roleClaimsSync.test.ts conventions.
function makeDeps(customClaims: Record<string, unknown> | undefined, opts: { noUser?: boolean } = {}) {
  const getUser = vi.fn(async () => {
    if (opts.noUser) throw new Error('no such user');
    return { customClaims } as never;
  });
  const setCustomUserClaims = vi.fn(async () => undefined);
  const revokeRefreshTokens = vi.fn(async () => undefined);
  const auditAdd = vi.fn(async () => ({ id: 'a1' }));
  const deps: AssignedSitesSyncDeps = {
    // only audit_logs.add is exercised
    db: { collection: () => ({ add: auditAdd }) } as never,
    auth: { getUser, setCustomUserClaims, revokeRefreshTokens } as never,
    firestoreNamespace: { FieldValue: { serverTimestamp: () => 'ts' } } as never,
  };
  return { deps, getUser, setCustomUserClaims, revokeRefreshTokens, auditAdd };
}

function index(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([pid, uids]) => [pid, new Set(uids)]));
}

describe('membersOf', () => {
  it('merges members[] and createdBy, dropping non-strings/empties', () => {
    const s = membersOf({ members: ['u1', 'u2', '', 3, null], createdBy: 'owner' });
    expect([...s].sort()).toEqual(['owner', 'u1', 'u2']);
  });
  it('createdBy alone (no members[]) still grants access', () => {
    expect([...membersOf({ createdBy: 'owner' })]).toEqual(['owner']);
  });
  it('empty/undefined doc → empty set', () => {
    expect(membersOf(undefined).size).toBe(0);
    expect(membersOf({}).size).toBe(0);
  });
});

describe('syncUserAssignedSites', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mints the sorted deduped site list, PRESERVING existing claims', async () => {
    const { deps, setCustomUserClaims } = makeDeps({ role: 'operario', tenantId: 'u1' });
    await syncUserAssignedSites(deps, 'u1', index({ p2: ['u1'], p1: ['u1'], p3: ['other'] }));
    expect(setCustomUserClaims).toHaveBeenCalledExactlyOnceWith('u1', {
      role: 'operario',
      tenantId: 'u1',
      assignedSiteIds: ['p1', 'p2'],
    });
  });

  it('steady-state: claim already equals computed → NO write, NO revoke', async () => {
    const { deps, setCustomUserClaims, revokeRefreshTokens, auditAdd } = makeDeps({
      assignedSiteIds: ['p1', 'p2'],
    });
    await syncUserAssignedSites(deps, 'u1', index({ p1: ['u1'], p2: ['u1'] }));
    expect(setCustomUserClaims).not.toHaveBeenCalled();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
    expect(auditAdd).not.toHaveBeenCalled();
  });

  it('pure ADDITION does not revoke tokens (no mid-shift logout)', async () => {
    const { deps, setCustomUserClaims, revokeRefreshTokens } = makeDeps({ assignedSiteIds: ['p1'] });
    await syncUserAssignedSites(deps, 'u1', index({ p1: ['u1'], p2: ['u1'] }));
    expect(setCustomUserClaims).toHaveBeenCalledOnce();
    expect(revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('REMOVAL of a site revokes refresh tokens (kill stale storage access)', async () => {
    const { deps, setCustomUserClaims, revokeRefreshTokens } = makeDeps({ assignedSiteIds: ['p1', 'p2'] });
    await syncUserAssignedSites(deps, 'u1', index({ p1: ['u1'] })); // p2 removed
    expect(setCustomUserClaims).toHaveBeenCalledWith('u1', { assignedSiteIds: ['p1'] });
    expect(revokeRefreshTokens).toHaveBeenCalledExactlyOnceWith('u1');
  });

  it('removal to EMPTY (user left all projects) mints [] and revokes', async () => {
    const { deps, setCustomUserClaims, revokeRefreshTokens } = makeDeps({ assignedSiteIds: ['p1'] });
    await syncUserAssignedSites(deps, 'u1', index({ p1: ['other'] })); // u1 no longer a member
    expect(setCustomUserClaims).toHaveBeenCalledWith('u1', { assignedSiteIds: [] });
    expect(revokeRefreshTokens).toHaveBeenCalledOnce();
  });

  it('no auth account (getUser throws) → skips silently, no claim write', async () => {
    const { deps, setCustomUserClaims } = makeDeps(undefined, { noUser: true });
    await syncUserAssignedSites(deps, 'ghost', index({ p1: ['ghost'] }));
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('over the 100-site cap → skips (no throw, no partial write)', async () => {
    const many: Record<string, string[]> = {};
    for (let i = 0; i < 101; i++) many[`p${i}`] = ['u1'];
    const { deps, setCustomUserClaims } = makeDeps({});
    await syncUserAssignedSites(deps, 'u1', index(many));
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('writes an audit_logs row on a real mint', async () => {
    const { deps, auditAdd } = makeDeps({});
    await syncUserAssignedSites(deps, 'u1', index({ p1: ['u1'] }));
    expect(auditAdd).toHaveBeenCalledOnce();
    const row = (auditAdd.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row.action).toBe('assigned_sites_claim_sync');
    expect((row.details as Record<string, unknown>).newSites).toEqual(['p1']);
  });
});
