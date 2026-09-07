import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import {
  claimDteIssueEntry,
  finalizeDteIssueEntry,
  DTE_ISSUE_CLAIMS_COLLECTION,
  DTE_QUEUE_LEASE_MS,
} from '../../../services/dte/dteIssueClaim.js';
import { markIssued } from '../../../services/dte/dteIssueQueue.js';

const instanceId = process.env.DTE_QUEUE_INSTANCE_ID ?? 'unknown-instance';
const queueKey = process.env.DTE_QUEUE_KEY ?? 'missing-queue-key';
const now = new Date(process.env.DTE_QUEUE_NOW ?? '2026-06-11T13:00:00.000Z');
const projectId = process.env.GCLOUD_PROJECT ?? 'praeventio-test';

const app = initializeApp(
  { projectId },
  `dte-queue-${instanceId}-${process.pid}`,
);
const db = getFirestore(app);
const queueRef = db.collection('dte_issue_queue').doc(queueKey);
const claimRef = db.collection(DTE_ISSUE_CLAIMS_COLLECTION).doc(queueKey);

function send(message: Record<string, unknown>): void {
  process.send?.({ instanceId, ...message });
}

async function cleanupAndExit(code: number): Promise<never> {
  await deleteApp(app);
  process.exit(code);
}

async function waitForComplete(): Promise<void> {
  await new Promise<void>((resolve) => {
    const onMessage = (message: { type?: string }): void => {
      if (message.type !== 'complete') return;
      process.off('message', onMessage);
      resolve();
    };
    process.on('message', onMessage);
  });
}

async function run(): Promise<void> {
  send({ type: 'ready', pid: process.pid });
  await new Promise<void>((resolve) => {
    const onMessage = (message: { type?: string }): void => {
      if (message.type !== 'release') return;
      process.off('message', onMessage);
      resolve();
    };
    process.on('message', onMessage);
  });

  const claim = await claimDteIssueEntry({
    db,
    queueRef,
    claimRef,
    now,
    leaseMs: DTE_QUEUE_LEASE_MS,
    token: `${instanceId}-claim-token`,
  });
  send({ type: 'claim-result', kind: claim.kind });

  if (claim.kind !== 'claimed') {
    return cleanupAndExit(0);
  }

  // This is the stand-in for the external DTE provider side effect. The
  // parent releases completion only after both workers report their claim
  // result, so exactly one message here means exactly one active claimant.
  send({ type: 'provider-attempt', idempotencyKey: queueKey });
  await waitForComplete();

  const done = markIssued(claim.entry, { provider: 'test-pse', folio: 9001 }, now);
  const finalized = await finalizeDteIssueEntry({
    db,
    queueRef,
    claimRef,
    token: claim.token,
    entry: done,
    invoice: claim.entry.invoice,
    source: claim.entry.source,
  });
  send({ type: 'finalized', finalized });
  await cleanupAndExit(finalized ? 0 : 1);
}

run().catch(async (error: unknown) => {
  send({
    type: 'fatal',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  await cleanupAndExit(1);
});
