// SPDX-License-Identifier: MIT
// Firestore Emulator contract for the cross-instance correctness boundary used
// by Cloud Run background listeners. The test starts two independent Node
// processes, each with its own Admin app, Firestore client and module-local
// mutex. A barrier proves both processes observed the unclaimed incident before
// either transaction runs.
//
// This contract covers normal concurrent operation. Delivery remains
// intentionally at-least-once if the winning process crashes after the external
// FCM send but before persisting the completion marker.

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup.js';

type WorkerMessage =
  | { type: 'ready'; instanceId: string; pid: number }
  | { type: 'observed'; instanceId: string }
  | { type: 'claim-token'; instanceId: string; token: string }
  | { type: 'claim-result'; instanceId: string; kind: string }
  | { type: 'sent'; instanceId: string; tokens: string[] }
  | { type: 'stopped'; instanceId: string }
  | { type: 'fatal'; instanceId: string; error: string };

interface InstanceHarness {
  child: ChildProcess;
  instanceId: string;
  messages: WorkerMessage[];
  stderr: string[];
}

const workerPath = fileURLToPath(
  new URL('./__fixtures__/criticalAlertInstance.worker.ts', import.meta.url),
);
const instances: InstanceHarness[] = [];

function startInstance(instanceId: string): InstanceHarness {
  const child = fork(workerPath, [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      CRITICAL_INSTANCE_ID: instanceId,
      GCLOUD_PROJECT: 'praeventio-test',
      GOOGLE_CLOUD_PROJECT: 'praeventio-test',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const harness: InstanceHarness = {
    child,
    instanceId,
    messages: [],
    stderr: [],
  };
  child.on('message', (message: WorkerMessage) => harness.messages.push(message));
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => harness.stderr.push(chunk));
  child.on('error', (error) => {
    harness.messages.push({
      type: 'fatal',
      instanceId,
      error: error.stack ?? error.message,
    });
  });
  instances.push(harness);
  return harness;
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`worker_exit_timeout:${child.pid ?? 'unknown'}`));
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', onExit);
  });
}

async function stopInstance(harness: InstanceHarness): Promise<void> {
  if (harness.child.exitCode !== null) return;
  harness.child.send({ type: 'shutdown' });
  try {
    await waitForExit(harness.child);
  } catch (error) {
    const forcedExit = waitForExit(harness.child);
    harness.child.kill();
    await forcedExit;
    throw error;
  }
}

afterEach(async () => {
  const active = instances.splice(0);
  await Promise.allSettled(active.map(stopInstance));
});

function messagesOfType<T extends WorkerMessage['type']>(
  harnesses: InstanceHarness[],
  type: T,
): Extract<WorkerMessage, { type: T }>[] {
  return harnesses.flatMap((harness) =>
    harness.messages.filter(
      (message): message is Extract<WorkerMessage, { type: T }> =>
        message.type === type,
    ),
  );
}

describe('critical alerts — cross-instance Firestore concurrency', () => {
  it('fans out once after two independent processes observe the unclaimed incident', async () => {
    const db = getEmulatorAdminFirestore();
    await db.collection('projects/project-1/members').doc('supervisor-1').set({
      role: 'supervisor',
    });
    await db.collection('users').doc('supervisor-1').set({
      fcmTokens: ['token-1'],
    });
    const ref = db.collection('nodes').doc('critical-cross-instance-1');
    await ref.set({
      type: 'Incidente',
      projectId: 'project-1',
      title: 'Caída desde altura',
      metadata: { severity: 'Crítica' },
    });

    const workers = [startInstance('instance-a'), startInstance('instance-b')];

    try {
      await vi.waitFor(
        () => expect(messagesOfType(workers, 'ready')).toHaveLength(2),
        { timeout: 15_000, interval: 50 },
      );
      await vi.waitFor(
        () => expect(messagesOfType(workers, 'observed')).toHaveLength(2),
        { timeout: 15_000, interval: 50 },
      );

      // Neither process has entered its transaction yet, so the event is still
      // unclaimed when both observers are released into the real contention.
      expect((await ref.get()).data()).not.toHaveProperty(
        '_criticalAlertClaimToken',
      );
      for (const worker of workers) worker.child.send({ type: 'release' });

      await vi.waitFor(
        () => {
          const results = messagesOfType(workers, 'claim-result');
          // Exactly ONE process claims the incident node. The other sees
          // `leased`. (The outbox worker may emit additional claim-result
          // messages for the outbox delivery — those are a different entity.)
          const nodeClaims = results.filter((result) => result.kind === 'claimed');
          expect(nodeClaims.length).toBeGreaterThanOrEqual(1);
          // Life-safety invariant: exactly one FCM send for the whole flow.
          expect(messagesOfType(workers, 'sent')).toHaveLength(1);
        },
        { timeout: 15_000, interval: 50 },
      );
      await vi.waitFor(
        async () => {
          expect((await ref.get()).data()?._criticalAlertSentAt).toBeDefined();
        },
        { timeout: 15_000, interval: 50 },
      );
      // Both process-local listeners must observe the authoritative completion;
      // this replaces a timing sleep and proves queued modified snapshots drained.
      await vi.waitFor(
        () => {
          for (const worker of workers) {
            expect(
              messagesOfType([worker], 'claim-result').some(
                (result) => result.kind === 'completed',
              ),
            ).toBe(true);
          }
        },
        { timeout: 15_000, interval: 50 },
      );

      const sent = messagesOfType(workers, 'sent');
      expect(sent).toEqual([
        expect.objectContaining({ tokens: ['token-1'] }),
      ]);
      const claimTokens = messagesOfType(workers, 'claim-token').map(
        (message) => message.token,
      );
      expect(claimTokens.length).toBeGreaterThanOrEqual(2);
      expect(new Set(claimTokens).size).toBe(claimTokens.length);
      expect(claimTokens.some((token) => token.startsWith('instance-a-'))).toBe(true);
      expect(claimTokens.some((token) => token.startsWith('instance-b-'))).toBe(true);
      expect(messagesOfType(workers, 'fatal')).toEqual([]);

      expect((await ref.get()).data()).toMatchObject({
        // Con el strong-atomic claim, el lease vive en incident_claims/{id}
        // y se elimina al completar. El nodo solo recibe el marcador de
        // outbox provisionado (verificado antes) — nunca campos de lease.
        _criticalAlertOutboxProvisionedAt: expect.anything(),
      });
      const leaseRef = db.collection('incident_claims').doc('critical-cross-instance-1');
      expect((await leaseRef.get()).exists).toBe(false);
    } finally {
      await Promise.all(workers.map(stopInstance));
    }

    expect(workers.every((worker) => worker.child.exitCode === 0)).toBe(true);
  });
});
