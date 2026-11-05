import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOperation } from '../../sync/syncStateMachine';
const fixtures = vi.hoisted(() => {
  const user = { uid: 'owner', getIdTokenResult: vi.fn(async () => ({ token: 'bound-token', claims: { tenantId: 'tenant' } })) };
  return { user, auth: { currentUser: user as typeof user | null }, identity: vi.fn(async () => ({ ownerUid: 'owner', tenantId: 'tenant', installationId: 'installation', schemaVersion: 2 as const })) };
});
vi.mock('../../sync/queueIdentity', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../sync/queueIdentity')>()), resolveCurrentQueueIdentity: fixtures.identity }));
vi.mock('../../firebase', () => ({ auth: fixtures.auth }));
import { replayZettelkastenNodeBatch } from './replayNodeBatch';
const node = { title: 'Finding', description: 'Offline finding', type: 'finding', severity: 'low', metadata: {}, connections: [], references: [], idempotencyKey: '0123456789abcdef' };
function operation(): SyncOperation {
  return { id: 'op-1', type: 'create', collection: 'zettelkasten_nodes', data: { projectId: 'project-A', nodes: [{ ...node }], localUpdatedAt: 'queue-envelope-only' }, ownerUid: 'owner', tenantId: 'tenant', installationId: 'installation', schemaVersion: 2, queueClass: 'generic', attempts: 0, createdAt: 1 };
}
beforeEach(() => {
  fixtures.auth.currentUser = fixtures.user;
  fixtures.user.getIdTokenResult.mockReset().mockResolvedValue({ token: 'bound-token', claims: { tenantId: 'tenant' } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('server-only Zettelkasten replay acknowledgement', () => {
  it('bounds a stalled request and leaves no retry timer behind', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    let release = () => undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      release = () => { resolve(new Response(JSON.stringify({ success: true, count: 1, ids: [node.idempotencyKey] }))); return undefined; };
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = replayZettelkastenNodeBatch(operation());
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      expect(signal).toBeInstanceOf(AbortSignal);
      const rejected = expect(pending).rejects.toThrow('zettelkasten_replay_timeout');
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      release();
      await pending.catch(() => undefined);
    }
  });
  it('preserves a dotted legacy node key accepted by the server', async () => {
    const key = 'legacy.node:1';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, count: 1, ids: [key] })));
    vi.stubGlobal('fetch', fetchMock);
    await replayZettelkastenNodeBatch({ ...operation(), data: { projectId: 'project-A', nodes: [{ ...node, idempotencyKey: key }] } });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[0][1].body)).nodes[0].idempotencyKey).toBe(key);
  });
  it('reuses the request identity and payload after an ambiguous network failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, count: 1, ids: [node.idempotencyKey] })));
    fetchMock.mockRejectedValueOnce(new Error('connection lost after server commit'));
    vi.stubGlobal('fetch', fetchMock);
    const op = operation();
    await expect(replayZettelkastenNodeBatch(op)).rejects.toThrow('connection lost');
    await replayZettelkastenNodeBatch(op);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(new Headers(calls[0][1].headers).get('Idempotency-Key')).toBe('zk-node-batch-op-1');
    expect(new Headers(calls[1][1].headers).get('Idempotency-Key')).toBe('zk-node-batch-op-1');
    expect(calls[0][1].body).toBe(calls[1][1].body);
    expect(JSON.parse(String(calls[1][1].body)).nodes[0].idempotencyKey).toBe(node.idempotencyKey);
  });
  it.each([
    { label: 'wrong operation', patch: { type: 'delete' as const } },
    { label: 'wrong collection', patch: { collection: 'incidents' } },
    { label: 'project envelope mismatch', patch: { projectId: 'different-project' } },
    { label: 'missing project', patch: { data: { nodes: [node] } } },
    { label: 'empty batch', patch: { data: { projectId: 'project-A', nodes: [] } } },
    { label: 'over-limit batch', patch: { data: { projectId: 'project-A', nodes: Array.from({ length: 33 }, () => ({ ...node })) } } },
    { label: 'missing persisted key', patch: { data: { projectId: 'project-A', nodes: [{ title: 'legacy' }] } } },
  ])('rejects an invalid persisted batch before dispatch: $label', async ({ patch }) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, count: 1, ids: [node.idempotencyKey] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(replayZettelkastenNodeBatch({ ...operation(), ...patch })).rejects.toThrow('zettelkasten_replay_invalid_batch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('holds a persisted operation belonging to another installation', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, count: 1, ids: [node.idempotencyKey] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(replayZettelkastenNodeBatch({ ...operation(), installationId: 'old-installation' })).rejects.toThrow('zettelkasten_replay_identity_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([{ mode: 'tenant' }, { mode: 'switched-user' }, { mode: 'empty-token' }])('does not dispatch with invalid bound credentials: $mode', async ({ mode }) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, count: 1, ids: [node.idempotencyKey] })));
    vi.stubGlobal('fetch', fetchMock);
    fixtures.user.getIdTokenResult.mockImplementation(async () => {
      if (mode === 'switched-user') fixtures.auth.currentUser = { ...fixtures.user };
      return { token: mode === 'empty-token' ? '' : 'bound-token', claims: { tenantId: mode === 'tenant' ? 'other-tenant' : 'tenant' } };
    });
    await expect(replayZettelkastenNodeBatch(operation())).rejects.toThrow('zettelkasten_replay_identity_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses replay under another authenticated owner', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, count: 1, ids: [node.idempotencyKey] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(replayZettelkastenNodeBatch({ ...operation(), ownerUid: 'different-owner' })).rejects.toThrow('zettelkasten_replay_identity_mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { label: 'missing identifiers', ack: { success: true } },
    { label: 'wrong identifier', ack: { success: true, count: 1, ids: ['different-node'] } },
    { label: 'wrong count', ack: { success: true, count: 0, ids: [node.idempotencyKey] } },
    { label: 'unsuccessful response', ack: { success: false, count: 1, ids: [node.idempotencyKey] } },
    { label: 'extra identifiers', ack: { success: true, count: 1, ids: [node.idempotencyKey, 'extra'] } },
    { label: 'null response', ack: null },
  ])('rejects HTTP200 without the exact persisted acknowledgement: $label', async ({ ack }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ack), { status: 200 })));
    await expect(replayZettelkastenNodeBatch(operation())).rejects.toThrow('zettelkasten_replay_invalid_ack');
  });
  it.each([401, 403, 429, 500, 503])('propagates HTTP%s for the queue retry policy without storing the server error body', async (status) => {
    const response = new Response('private-backend-error-body', { status });
    const json = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(replayZettelkastenNodeBatch(operation())).rejects.toThrow(`zettelkasten_replay_http_${status}`);
    expect(json).not.toHaveBeenCalled();
  });
  it('rejects an HTTP200 non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>not an acknowledgement</html>')));
    await expect(replayZettelkastenNodeBatch(operation())).rejects.toThrow('zettelkasten_replay_invalid_ack');
  });
  it('does not send an unauthenticated batch', async () => {
    fixtures.auth.currentUser = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(replayZettelkastenNodeBatch(operation())).rejects.toThrow('zettelkasten_replay_auth_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
