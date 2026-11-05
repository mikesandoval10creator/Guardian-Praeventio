import { auth } from '../../firebase';
import type { SyncOperation } from '../../sync/syncStateMachine';
import { queueIdentitiesMatch, resolveCurrentQueueIdentity } from '../../sync/queueIdentity';

function hasPersistedKey(value: unknown): value is Record<string, unknown> & { idempotencyKey: string } {
  return typeof value === 'object' && value !== null && 'idempotencyKey' in value &&
    typeof value.idempotencyKey === 'string' && /^[A-Za-z0-9_:.-]{1,256}$/.test(value.idempotencyKey);
}

/** Replay the persisted batch through its authoritative server writer. */
export async function replayZettelkastenNodeBatch(op: SyncOperation): Promise<void> {
  const { projectId, nodes } = op.data;
  // Legacy batch envelopes omit op.projectId: retain their explicit payload scope.
  if (op.collection !== 'zettelkasten_nodes' || op.type !== 'create' ||
      typeof projectId !== 'string' || projectId.length < 1 || projectId.length > 128 ||
      (op.projectId !== undefined && op.projectId !== projectId) ||
      !Array.isArray(nodes) || nodes.length < 1 || nodes.length > 32 || !nodes.every(hasPersistedKey)) {
    throw new Error('zettelkasten_replay_invalid_batch');
  }
  const expected = nodes.map((n) => n.idempotencyKey);
  const body = JSON.stringify({ projectId, nodes });
  const user = auth.currentUser;
  if (!user) throw new Error('zettelkasten_replay_auth_unavailable');
  if (user.uid !== op.ownerUid) throw new Error('zettelkasten_replay_identity_mismatch');
  const credentials = await user.getIdTokenResult();
  const identity = await resolveCurrentQueueIdentity();
  if (!identity || !queueIdentitiesMatch(op, identity) || auth.currentUser !== user || credentials.claims.tenantId !== op.tenantId || !credentials.token) {
    throw new Error('zettelkasten_replay_identity_mismatch');
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    const response = await fetch('/api/zettelkasten/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.token}`, 'Idempotency-Key': `zk-node-batch-${op.id}` },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`zettelkasten_replay_http_${response.status}`);
    const ack: unknown = await response.json().catch(() => null);
    if (typeof ack !== 'object' || ack === null || !('success' in ack) || ack.success !== true ||
        !('count' in ack) || ack.count !== expected.length || !('ids' in ack) || !Array.isArray(ack.ids) ||
        ack.ids.length !== expected.length || !ack.ids.every((id: unknown, i: number) => id === expected[i])) {
      throw new Error('zettelkasten_replay_invalid_ack');
    }
  } catch (error) {
    if (timedOut) throw new Error('zettelkasten_replay_timeout', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
