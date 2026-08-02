// Praeventio Guard — real Firestore Emulator coverage for create-if-absent
// legal Zettelkasten nodes. This bypasses process-local guards and exercises
// the authoritative transaction under contention.

import { beforeEach, describe, expect, it } from 'vitest';
import type { RiskNodePayload } from '../../services/zettelkasten/types';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';
import { serverCreateNodeOnce } from './serverZkNodeWriter';

const PROJECT_ID = 'epp-create-once-project';
const STABLE_KEY = `epp-order-signature:${PROJECT_ID}:oc-concurrent`;

function signedNode(challengeId: string, signerUid: string): RiskNodePayload {
  return {
    title: 'OC firmada oc-concurrent',
    description: `Signed by ${signerUid} with ${challengeId}`,
    type: 'safety-learning',
    severity: 'info',
    metadata: {
      sourceType: 'purchase-order-signed',
      orderId: 'oc-concurrent',
      challengeId,
      signerUid,
      signedAt: '2026-08-02T14:00:00.000Z',
      status: 'signed',
    },
    connections: ['purchase-order:oc-concurrent'],
    references: ['Ley-19799'],
  } as RiskNodePayload;
}

describe('serverCreateNodeOnce — Firestore transaction contention', () => {
  beforeEach(async () => {
    await getEmulatorAdminFirestore().collection('projects').doc(PROJECT_ID).set({
      tenantId: 'tenant-epp-concurrency',
    });
  });

  it('persists exactly one legal artifact for two competing actors', async () => {
    const [left, right] = await Promise.all([
      serverCreateNodeOnce(
        signedNode('challenge-a', 'admin-a'),
        { projectId: PROJECT_ID },
        { createdBy: 'admin-a', createdByEmail: 'admin-a@praeventio.test' },
        STABLE_KEY,
      ),
      serverCreateNodeOnce(
        signedNode('challenge-b', 'admin-b'),
        { projectId: PROJECT_ID },
        { createdBy: 'admin-b', createdByEmail: 'admin-b@praeventio.test' },
        STABLE_KEY,
      ),
    ]);

    expect(left.id).toBe(right.id);
    expect([left.created, right.created].sort()).toEqual([false, true]);

    const db = getEmulatorAdminFirestore();
    const persisted = (
      await db.collection('zettelkasten_nodes').doc(left.id).get()
    ).data() as { createdBy?: string; metadata?: { challengeId?: string } };
    const winningActor = left.created ? 'admin-a' : 'admin-b';
    const winningChallenge = left.created ? 'challenge-a' : 'challenge-b';
    expect(persisted.createdBy).toBe(winningActor);
    expect(persisted.metadata?.challengeId).toBe(winningChallenge);

    const audit = await db
      .collection('audit_logs')
      .where('details.stableBusinessKey', '==', STABLE_KEY)
      .get();
    expect(audit.size).toBe(1);
  });
});
