import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetEncryptedKvForTests, getRawEnvelope, listEncryptedKeys } from '../security/encryptedKvStore';
import { __resetDeviceKekForTests } from '../security/deviceKek';
import { prepareCommuteSample, persistCommuteSample, flushCommuteSamples, countCommuteSamples,
  markCommuteClosePending, isCommuteClosePending, clearCommuteClosePending } from './commuteSamples';

const scope = { uid: 'worker-A', projectId: 'project-A', sessionId: 'session-A' };
const sample = { lat: -33.4, lng: -70.6, speedKmh: 36, accuracyM: 5, timestamp: 1_717_000_000_000 };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  __resetEncryptedKvForTests();
  __resetDeviceKekForTests();
});

afterEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

describe('commute samples — encrypted durable pending evidence', () => {
  it('preserves an encrypted close intent across reopen and isolates it by actor, project and session', async () => {
    await markCommuteClosePending(scope);
    __resetEncryptedKvForTests(); __resetDeviceKekForTests();
    expect(await isCommuteClosePending(scope)).toBe(true);
    for (const patch of [{ uid: 'other' }, { projectId: 'other' }, { sessionId: 'other' }]) {
      expect(await isCommuteClosePending({ ...scope, ...patch })).toBe(false);
    }
    const [key] = await listEncryptedKeys();
    expect((await getRawEnvelope(key))?.algorithm).toBe('AES-256-GCM');
    await clearCommuteClosePending(scope);
    expect(await isCommuteClosePending(scope)).toBe(false);
  });
  it('persists ciphertext and reopens the same pending fix after store handles are reset', async () => {
    const item = prepareCommuteSample(scope, sample);
    await persistCommuteSample(item);
    const envelope = await getRawEnvelope(item.key);
    expect(envelope?.algorithm).toBe('AES-256-GCM');
    expect(JSON.stringify(envelope)).not.toContain('"lat"');
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    const send = vi.fn(async () => undefined);
    await flushCommuteSamples(scope, send, () => true);
    expect(send).toHaveBeenCalledWith(sample);
    expect(await countCommuteSamples(scope)).toBe(0);
  });

  it('retains a failed send and replays the identical fix on retry', async () => {
    await persistCommuteSample(prepareCommuteSample(scope, sample));
    await expect(flushCommuteSamples(scope, async () => { throw new Error('offline'); }, () => true)).rejects.toThrow('offline');
    expect(await countCommuteSamples(scope)).toBe(1);
    const send = vi.fn(async () => undefined);
    await flushCommuteSamples(scope, send, () => true);
    expect(send).toHaveBeenCalledWith(sample);
    expect(await countCommuteSamples(scope)).toBe(0);
  });

  it('never flushes another actor, project or session', async () => {
    await persistCommuteSample(prepareCommuteSample(scope, sample));
    for (const patch of [{ uid: 'worker-B' }, { projectId: 'project-B' }, { sessionId: 'session-B' }]) {
      const send = vi.fn(async () => undefined);
      await flushCommuteSamples({ ...scope, ...patch }, send, () => true);
      expect(send).not.toHaveBeenCalled();
    }
    expect(await countCommuteSamples(scope)).toBe(1);
  });

  it('does not acknowledge a queued point after the current identity changes during HTTP', async () => {
    await persistCommuteSample(prepareCommuteSample(scope, sample));
    let current = true;
    await flushCommuteSamples(scope, async () => { current = false; }, () => current);
    expect(await countCommuteSamples(scope)).toBe(1);
  });

  it('preserves independent arrivals and the original retry key without a shared-array overwrite', async () => {
    const a = prepareCommuteSample(scope, sample);
    const b = prepareCommuteSample(scope, { ...sample, timestamp: sample.timestamp + 60_000 });
    await Promise.all([persistCommuteSample(a), persistCommuteSample(b)]);
    await persistCommuteSample(a);
    expect(await countCommuteSamples(scope)).toBe(2);
    const delivered: number[] = [];
    await flushCommuteSamples(scope, async (point) => { delivered.push(point.timestamp); }, () => true);
    expect(delivered).toEqual([sample.timestamp, sample.timestamp + 60_000]);
  });

  it('retains an arrival while an earlier sample is being acknowledged', async () => {
    await persistCommuteSample(prepareCommuteSample(scope, sample));
    const next = prepareCommuteSample(scope, { ...sample, timestamp: sample.timestamp + 60_000 });
    await flushCommuteSamples(scope, async () => { await persistCommuteSample(next); }, () => true);
    expect(await listEncryptedKeys()).toEqual([next.key]);
  });
});
