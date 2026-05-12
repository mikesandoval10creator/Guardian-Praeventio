import { describe, it, expect } from 'vitest';
import { CustodyChainAdapter } from './custodyChainFirestoreAdapter.js';
import { createFakeFirestore } from '../../test/fakeFirestore.js';
import { registerArtifact, recordAccess } from './custodyChainService.js';

function makeArtifact(over: { uploadedByUid?: string; linkedNodeId?: string; payload?: string } = {}) {
  return registerArtifact({
    kind: 'photo',
    mimeType: 'image/jpeg',
    bytes: new TextEncoder().encode(over.payload ?? 'evidence-photo-bytes'),
    uploadedByUid: over.uploadedByUid ?? 'w1',
    linkedNodeId: over.linkedNodeId ?? 'incident-1',
    now: new Date('2026-05-11T10:00:00Z'),
  });
}

describe('CustodyChainAdapter', () => {
  it('saveArtifact + getArtifact persiste y recupera por hash', async () => {
    const db = createFakeFirestore();
    const a = new CustodyChainAdapter(db, 't1');
    const { artifact } = makeArtifact();
    await a.saveArtifact(artifact);
    const got = await a.getArtifact(artifact.id);
    expect(got?.id).toBe(artifact.id);
    expect(got?.kind).toBe('photo');
  });

  it('appendEvent + listEvents en subcollection ordenado desc', async () => {
    const db = createFakeFirestore();
    const a = new CustodyChainAdapter(db, 't1');
    const { artifact, event: uploadEvent } = makeArtifact();
    await a.saveArtifact(artifact);
    await a.appendEvent(uploadEvent);
    const accessEvent = recordAccess(
      artifact,
      'supervisor-1',
      'supervisor',
      undefined,
      new Date('2026-05-11T11:00:00Z'),
    );
    await a.appendEvent(accessEvent);
    const events = await a.listEvents(artifact.id);
    expect(events).toHaveLength(2);
    expect(events[0].eventKind).toBe('access'); // más reciente primero
    expect(events[1].eventKind).toBe('upload');
  });

  it('markReplaced setea replacedByHash y replacedAt', async () => {
    const db = createFakeFirestore();
    const a = new CustodyChainAdapter(db, 't1');
    const { artifact } = makeArtifact();
    await a.saveArtifact(artifact);
    const replacementHash = 'a'.repeat(64);
    await a.markReplaced(artifact.id, replacementHash, '2026-05-11T12:00:00Z');
    const got = await a.getArtifact(artifact.id);
    expect(got?.replacedByHash).toBe(replacementHash);
    expect(got?.replacedAt).toBe('2026-05-11T12:00:00Z');
  });

  it('listArtifactsForNode filtra por linkedNodeId', async () => {
    const db = createFakeFirestore();
    const a = new CustodyChainAdapter(db, 't1');
    const { artifact: art1 } = makeArtifact({ linkedNodeId: 'inc-A', payload: 'a' });
    const { artifact: art2 } = makeArtifact({ linkedNodeId: 'inc-A', payload: 'b' });
    const { artifact: art3 } = makeArtifact({ linkedNodeId: 'inc-B', payload: 'c' });
    await a.saveArtifact(art1);
    await a.saveArtifact(art2);
    await a.saveArtifact(art3);
    const list = await a.listArtifactsForNode('inc-A');
    expect(list).toHaveLength(2);
    expect(list.every((art) => art.linkedNodeId === 'inc-A')).toBe(true);
  });

  it('subcollections aisladas por artifact hash', async () => {
    const db = createFakeFirestore();
    const a = new CustodyChainAdapter(db, 't1');
    const r1 = makeArtifact({ payload: 'foto-1' });
    const r2 = makeArtifact({ payload: 'foto-2' });
    await a.saveArtifact(r1.artifact);
    await a.saveArtifact(r2.artifact);
    await a.appendEvent(r1.event);
    await a.appendEvent(r2.event);
    const events1 = await a.listEvents(r1.artifact.id);
    const events2 = await a.listEvents(r2.artifact.id);
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0].artifactHash).toBe(r1.artifact.id);
    expect(events2[0].artifactHash).toBe(r2.artifact.id);
  });
});
