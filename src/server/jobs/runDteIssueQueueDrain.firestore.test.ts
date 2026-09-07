// Firestore Emulator contract for DTE queue claim concurrency.
// This is intentionally a separate *.firestore.test.ts file: the default
// Vitest sweep excludes it because it requires a real Firestore transaction.

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup.js';
import { decideDteIssue } from '../../services/dte/dteAutoIssueOrchestrator.js';
import { enqueue } from '../../services/dte/dteIssueQueue.js';
import {
  DTE_ISSUE_QUEUE_COLLECTION,
  queueEntryToDoc,
  type DteQueueInvoicePayload,
} from '../../services/dte/dteIssueQueueStore.js';

type WorkerMessage =
  | { type: 'ready'; instanceId: string; pid: number }
  | { type: 'claim-result'; instanceId: string; kind: string }
  | { type: 'provider-attempt'; instanceId: string; idempotencyKey: string }
  | { type: 'finalized'; instanceId: string; finalized: boolean }
  | { type: 'fatal'; instanceId: string; error: string };

interface WorkerHarness {
  child: ChildProcess;
  instanceId: string;
  messages: WorkerMessage[];
}

const workerPath = fileURLToPath(
  new URL('./__fixtures__/dteIssueQueueInstance.worker.ts', import.meta.url),
);
const instances: WorkerHarness[] = [];
const NOW = new Date('2026-06-11T13:00:00.000Z');
const QUEUE_KEY = 'dte-queue-concurrent-1';

const decision = decideDteIssue({
  paymentId: 'manual:inv-concurrent-1',
  tenantId: 'uid-owner',
  payerInfo: {
    taxId: '76.123.456-0',
    legalName: 'Empresa SpA',
    email: 'pagos@empresa.cl',
  },
  amountClp: 50_000,
  planCode: 'comite-paritario',
  paymentGateway: 'manual',
  paidAt: NOW.toISOString(),
});

const invoicePayload: DteQueueInvoicePayload = {
  id: 'inv-concurrent-1',
  status: 'paid',
  paidAt: NOW.toISOString(),
  paymentMethod: 'manual-transfer',
  cliente: {
    nombre: 'Empresa SpA',
    rut: '76.123.456-0',
    email: 'pagos@empresa.cl',
  },
  lineItems: [
    {
      tierId: 'comite-paritario',
      description: 'Suscripción',
      quantity: 1,
      unitAmount: 42_017,
      currency: 'CLP',
    },
  ],
  totals: { subtotal: 42_017, iva: 7_983, total: 50_000, currency: 'CLP' },
};

function startInstance(instanceId: string): WorkerHarness {
  const child = fork(workerPath, [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      DTE_QUEUE_INSTANCE_ID: instanceId,
      DTE_QUEUE_KEY: QUEUE_KEY,
      DTE_QUEUE_NOW: NOW.toISOString(),
      GCLOUD_PROJECT: 'praeventio-test',
      GOOGLE_CLOUD_PROJECT: 'praeventio-test',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const harness: WorkerHarness = { child, instanceId, messages: [] };
  child.on('message', (message: WorkerMessage) => harness.messages.push(message));
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

function messagesOfType<T extends WorkerMessage['type']>(
  harnesses: WorkerHarness[],
  type: T,
): Extract<WorkerMessage, { type: T }>[] {
  return harnesses.flatMap((harness) =>
    harness.messages.filter(
      (message): message is Extract<WorkerMessage, { type: T }> =>
        message.type === type,
    ),
  );
}

function waitForExit(child: ChildProcess, timeoutMs = 15_000): Promise<void> {
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

afterEach(async () => {
  const active = instances.splice(0);
  await Promise.all(
    active.map(async ({ child }) => {
      if (child.exitCode !== null) return;
      child.kill();
      await waitForExit(child).catch(() => undefined);
    }),
  );
});

describe.skipIf(process.env.RUN_DTE_QUEUE_FIRESTORE_TESTS !== '1')(
  'DTE queue — cross-instance atomic claim',
  () => {
    it('allows exactly one active claimant and one provider attempt', async () => {
      const db = getEmulatorAdminFirestore();
      const queueRef = db.collection(DTE_ISSUE_QUEUE_COLLECTION).doc(QUEUE_KEY);
      await queueRef.set(queueEntryToDoc(enqueue(decision, NOW), invoicePayload, 'mark-paid'));

      const workers = [startInstance('instance-a'), startInstance('instance-b')];
      await vi.waitFor(
        () => expect(messagesOfType(workers, 'ready')).toHaveLength(2),
        { timeout: 15_000, interval: 50 },
      );
      for (const worker of workers) worker.child.send({ type: 'release' });

      await vi.waitFor(
        () => {
          const fatal = messagesOfType(workers, 'fatal');
          if (fatal.length > 0) throw new Error(fatal[0]!.error);
          expect(messagesOfType(workers, 'claim-result')).toHaveLength(2);
        },
        { timeout: 15_000, interval: 50 },
      );

      const claims = messagesOfType(workers, 'claim-result');
      expect(claims.filter((message) => message.kind === 'claimed')).toHaveLength(1);
      expect(claims.filter((message) => message.kind === 'leased')).toHaveLength(1);
      expect(messagesOfType(workers, 'provider-attempt')).toEqual([
        { type: 'provider-attempt', instanceId: expect.any(String), idempotencyKey: QUEUE_KEY },
      ]);

      const winnerId = claims.find((message) => message.kind === 'claimed')!.instanceId;
      const winner = workers.find((worker) => worker.instanceId === winnerId)!;
      winner.child.send({ type: 'complete' });
      await vi.waitFor(
        () => expect(messagesOfType([winner], 'finalized')).toEqual([
          { type: 'finalized', instanceId: winnerId, finalized: true },
        ]),
        { timeout: 15_000, interval: 50 },
      );
      await Promise.all(workers.map((worker) => waitForExit(worker.child)));

      const finalDoc = (await queueRef.get()).data();
      expect(finalDoc).toMatchObject({ status: 'succeeded', attempts: 1 });
      expect(finalDoc).not.toHaveProperty('leaseExpiresAt');
      expect(finalDoc).not.toHaveProperty('claimToken');
      expect((await db.collection('dte_issue_claims').doc(QUEUE_KEY).get()).exists).toBe(false);
      expect(messagesOfType(workers, 'fatal')).toEqual([]);
    });
  },
);
