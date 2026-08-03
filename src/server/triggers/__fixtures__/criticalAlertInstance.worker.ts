// SPDX-License-Identifier: MIT
// Child-process fixture: one isolated Cloud Run-style background-trigger instance.

import { randomUUID } from 'node:crypto';
import type admin from 'firebase-admin';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  setupBackgroundTriggers,
  type BackgroundTriggersDeps,
} from '../backgroundTriggers.js';

type ParentMessage = { type: 'release' } | { type: 'shutdown' };

type WorkerMessage =
  | { type: 'ready'; instanceId: string; pid: number }
  | { type: 'observed'; instanceId: string }
  | { type: 'claim-token'; instanceId: string; token: string }
  | { type: 'claim-result'; instanceId: string; kind: string }
  | { type: 'sent'; instanceId: string; tokens: string[] }
  | { type: 'stopped'; instanceId: string }
  | { type: 'fatal'; instanceId: string; error: string };

const instanceId = process.env.CRITICAL_INSTANCE_ID ?? randomUUID();
const projectId = process.env.GCLOUD_PROJECT ?? 'praeventio-test';
const app = initializeApp(
  { projectId },
  `critical-alert-instance-${instanceId}-${process.pid}`,
);
const db = getFirestore(app);

function send(message: WorkerMessage): void {
  process.send?.(message);
}

let releaseBarrier: (() => void) | undefined;
const released = new Promise<void>((resolve) => {
  releaseBarrier = resolve;
});
let firstClaimTransaction = true;
let claimSequence = 0;

const triggerDb = {
  collection: db.collection.bind(db),
  runTransaction: async <T>(
    updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
  ): Promise<T> => {
    const isFirstClaim = firstClaimTransaction;
    if (isFirstClaim) {
      firstClaimTransaction = false;
      send({ type: 'observed', instanceId });
      await released;
    }

    let result: T;
    try {
      result = await db.runTransaction(updateFunction);
    } catch (error) {
      send({ type: 'fatal', instanceId, error: `tx-error: ${error instanceof Error ? error.message : String(error)}` });
      throw error;
    }
    if (
      result !== null &&
      typeof result === 'object' &&
      'kind' in result &&
      typeof (result as { kind?: unknown }).kind === 'string'
    ) {
      send({
        type: 'claim-result',
        instanceId,
        kind: (result as { kind: string }).kind,
      });
    }
    return result;
  },
} as unknown as admin.firestore.Firestore;

const messaging = {
  sendEachForMulticast: async (message: admin.messaging.MulticastMessage) => {
    send({ type: 'sent', instanceId, tokens: [...message.tokens] });
    return { successCount: 1, failureCount: 0, responses: [] };
  },
} as unknown as BackgroundTriggersDeps['messaging'];

const resend = {
  emails: { send: async () => ({ id: 'unused' }) },
} as unknown as BackgroundTriggersDeps['resend'];

const firestoreNamespace = {
  FieldValue,
} as unknown as BackgroundTriggersDeps['firestoreNamespace'];

const handle = setupBackgroundTriggers({
  db: triggerDb,
  messaging,
  resend,
  resendApiKey: '',
  firestoreNamespace,
  createClaimToken: () => {
    const token = `${instanceId}-${claimSequence++}`;
    send({ type: 'claim-token', instanceId, token });
    return token;
  },
});

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  releaseBarrier?.();
  handle.unsubscribe();
  await deleteApp(app);
  const done = (): void => process.exit(0);
  if (process.send) {
    process.send({ type: 'stopped', instanceId } satisfies WorkerMessage, done);
  } else {
    done();
  }
}

process.on('message', (raw: unknown) => {
  if (!raw || typeof raw !== 'object' || !('type' in raw)) return;
  const message = raw as ParentMessage;
  if (message.type === 'release') releaseBarrier?.();
  if (message.type === 'shutdown') void shutdown();
});

function fatal(reason: unknown): void {
  const error = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  send({ type: 'fatal', instanceId, error });
  process.exitCode = 1;
  releaseBarrier?.();
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
send({ type: 'ready', instanceId, pid: process.pid });
