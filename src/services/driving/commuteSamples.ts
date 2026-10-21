import { randomId } from '../../utils/randomId';
import { deleteEncrypted, getEncrypted, listEncryptedKeys, setEncrypted } from '../security/encryptedKvStore';
import type { CommuteSample } from './commuteSession';

export interface CommuteScope { uid: string; projectId: string; sessionId: string }
export interface PendingCommuteSample extends CommuteScope { key: string; sample: CommuteSample }

// Keys contain coordination identifiers, never GPS. Payloads use the existing
// device-bound encrypted store; there is no plaintext or in-memory fallback.
function prefix(scope: Pick<CommuteScope, 'uid' | 'projectId'>): string {
  return `commute-samples:v1:${encodeURIComponent(JSON.stringify([scope.uid, scope.projectId]))}:`;
}

export function prepareCommuteSample(scope: CommuteScope, sample: CommuteSample): PendingCommuteSample {
  return { ...scope, sample, key: `${prefix(scope)}${randomId()}` };
}

export async function persistCommuteSample(item: PendingCommuteSample): Promise<void> {
  await setEncrypted(item.key, item);
}

function closeKey(scope: CommuteScope): string {
  return `commute-close:v1:${encodeURIComponent(JSON.stringify([scope.uid, scope.projectId, scope.sessionId]))}`;
}

export async function markCommuteClosePending(scope: CommuteScope): Promise<void> {
  await setEncrypted(closeKey(scope), { ...scope, pending: true });
}

export async function isCommuteClosePending(scope: CommuteScope): Promise<boolean> {
  const value = await getEncrypted<CommuteScope & { pending: boolean }>(closeKey(scope));
  if (value === null) return false;
  if (value.uid !== scope.uid || value.projectId !== scope.projectId
    || value.sessionId !== scope.sessionId || value.pending !== true) throw new Error('Invalid commute close intent');
  return true;
}

export async function clearCommuteClosePending(scope: CommuteScope): Promise<void> {
  await deleteEncrypted(closeKey(scope));
}

export async function countCommuteSamples(scope: Pick<CommuteScope, 'uid' | 'projectId'>): Promise<number> {
  return (await listEncryptedKeys()).filter((key) => key.startsWith(prefix(scope))).length;
}

export async function flushCommuteSamples(
  scope: CommuteScope,
  send: (sample: CommuteSample) => Promise<void>,
  isCurrent: () => boolean,
): Promise<void> {
  const keys = (await listEncryptedKeys()).filter((key) => key.startsWith(prefix(scope)));
  const entries: PendingCommuteSample[] = [];
  for (const key of keys) {
    if (!isCurrent()) return;
    const item = await getEncrypted<PendingCommuteSample>(key);
    if (!item) continue;
    if (item.uid !== scope.uid || item.projectId !== scope.projectId || item.key !== key) {
      throw new Error('Invalid pending commute scope');
    }
    if (item.sessionId === scope.sessionId) entries.push(item);
  }
  entries.sort((a, b) => a.sample.timestamp - b.sample.timestamp || a.key.localeCompare(b.key));
  for (const item of entries) {
    if (!isCurrent()) return;
    await send(item.sample);
    if (!isCurrent()) return;
    // Per-point keys prevent acknowledgements from overwriting new arrivals.
    // A lost acknowledgement replays the same exact sample (server dedupes).
    await deleteEncrypted(item.key);
  }
}
