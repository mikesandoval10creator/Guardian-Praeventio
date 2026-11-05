import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingUpload } from './onboardingUpload';
const state = vi.hoisted(() => ({ metadata: new Map<string, Record<string, unknown>>(), objects: new Map<string, Blob>(), uploads: vi.fn(), writes: vi.fn(), failStorage: false, failMetadata: false, afterRead: undefined as (() => void) | undefined, afterUpload: undefined as (() => void) | undefined, beforeTransaction: undefined as (() => void) | undefined, identity: { ownerUid: 'owner', tenantId: 'tenant', installationId: 'installation', schemaVersion: 2 as const } }));
vi.mock('../firebase', () => ({ db: {}, storage: {} }));
vi.mock('../sync/queueIdentity', async (importOriginal) => ({ ...(await importOriginal<typeof import('../sync/queueIdentity')>()), resolveCurrentQueueIdentity: async () => state.identity }));
vi.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: async (target: { path: string }, file: Blob) => { state.uploads(target.path, file); if (state.failStorage) throw new Error('storage_failure'); state.objects.set(target.path, file); state.afterUpload?.(); } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  getDocFromServer: async (target: { path: string }) => { const data = state.metadata.get(target.path); state.afterRead?.(); return { exists: () => !!data, data: () => data }; },
  runTransaction: async (_db: unknown, callback: (tx: { get: (target: { path: string }) => Promise<{ exists: () => boolean; data: () => unknown }>; set: (target: { path: string }, data: Record<string, unknown>) => void }) => Promise<void>) => { state.beforeTransaction?.(); await callback({ get: async (target) => { const data = state.metadata.get(target.path); return { exists: () => !!data, data: () => data }; }, set: (target, data) => { if (state.failMetadata) throw new Error('metadata_failure'); state.writes(target.path, data); state.metadata.set(target.path, structuredClone(data)); } }); },
}));
import { replayOnboardingUpload } from './onboardingUpload';
const collection = 'projects/project-1/workers/worker-1/documents';
const metadataPath = `${collection}/document-1`;
const storagePath = `${metadataPath}/document-1.pdf`;
function action(): OnboardingUpload { return { type: 'upload', collection, docId: 'document-1', file: new Blob(['synthetic PDF fixture'], { type: 'application/pdf' }), queueIdentity: { ...state.identity }, data: { onboardingUpload: 1, storagePath, documentData: { projectId: 'project-1', workerId: 'worker-1', name: 'document-1.pdf', archived: false, type: 'legal_onboarding', storagePath, tenantId: 'tenant', createdBy: 'owner' } } }; }
beforeEach(() => { state.metadata.clear(); state.objects.clear(); state.uploads.mockClear(); state.writes.mockClear(); state.failStorage = state.failMetadata = false; state.afterRead = state.afterUpload = state.beforeTransaction = undefined; state.identity = { ownerUid: 'owner', tenantId: 'tenant', installationId: 'installation', schemaVersion: 2 }; });
describe('project-scoped onboarding replay (unit SDK mocks)', () => {
  it('snapshots the immutable File before asynchronous reads', async () => {
    const op = action(); const original = op.file;
    state.afterRead = () => { op.file = new Blob(['replaced'], { type: 'application/pdf' }); };
    await replayOnboardingUpload(op);
    expect(state.uploads.mock.calls[0][1]).toBe(original);
  });
  it('writes one stable metadata row and object, then acknowledges repeats without rewriting either', async () => {
    const op = action(); await replayOnboardingUpload(op); await replayOnboardingUpload(op);
    expect([...state.metadata.keys()]).toEqual([metadataPath]); expect([...state.objects.keys()]).toEqual([storagePath]);
    expect(state.uploads).toHaveBeenCalledOnce(); expect(state.writes).toHaveBeenCalledOnce();
    expect(state.metadata.get(metadataPath)).not.toHaveProperty('url');
  });
  it('keeps a recoverable deterministic object after metadata failure and completes the same target on retry', async () => {
    const op = action(); state.failMetadata = true;
    await expect(replayOnboardingUpload(op)).rejects.toThrow('metadata_failure');
    expect(state.objects.size).toBe(1); expect(state.metadata.size).toBe(0);
    state.failMetadata = false; await replayOnboardingUpload(op);
    expect(state.objects.size).toBe(1); expect(state.metadata.size).toBe(1);
  });
  it('does not write metadata after a Storage failure', async () => {
    state.failStorage = true;
    await expect(replayOnboardingUpload(action())).rejects.toThrow('storage_failure');
    expect(state.writes).not.toHaveBeenCalled(); expect(state.objects.size).toBe(0);
  });
  it('does not restore a remotely archived document on repeated replay', async () => {
    const op = action(); await replayOnboardingUpload(op); const row = state.metadata.get(metadataPath);
    if (!row) throw new Error('fixture metadata missing'); row.archived = true;
    await replayOnboardingUpload(op); expect(row.archived).toBe(true); expect(state.writes).toHaveBeenCalledOnce(); expect(state.uploads).toHaveBeenCalledOnce();
  });
  it('does not overwrite an archive created concurrently between services', async () => {
    const op = action(); state.beforeTransaction = () => { state.metadata.set(metadataPath, { ...op.data.documentData as Record<string, unknown>, archived: true }); };
    await replayOnboardingUpload(op); expect(state.metadata.get(metadataPath)?.archived).toBe(true); expect(state.writes).not.toHaveBeenCalled();
  });
  it('refuses conflicting existing metadata without overwriting bytes', async () => {
    state.metadata.set(metadataPath, { storagePath: 'other/object.pdf' });
    await expect(replayOnboardingUpload(action())).rejects.toThrow('existing_conflict'); expect(state.uploads).not.toHaveBeenCalled();
  });
  it('rechecks ownership between Storage and metadata', async () => {
    const op = action(); state.afterUpload = () => { state.identity = { ...state.identity, ownerUid: 'another-owner' }; };
    await expect(replayOnboardingUpload(op)).rejects.toThrow('owner_changed'); expect(state.writes).not.toHaveBeenCalled();
  });
  it.each(['ownerUid', 'tenantId', 'installationId'] as const)('does not replay another %s', async (field) => {
    const op = action(); if (!op.queueIdentity) throw new Error('fixture identity missing'); op.queueIdentity[field] = 'another';
    await expect(replayOnboardingUpload(op)).rejects.toThrow(); expect(state.uploads).not.toHaveBeenCalled();
  });
  it.each(['missing-file', 'root-collection', 'missing-doc-id', 'cross-project', 'cross-worker', 'root-storage', 'sentinel-worker', 'bad-mime'] as const)('rejects malformed or legacy-ambiguous scope: %s', async (mode) => {
    const op = action(); const metadata = op.data.documentData as Record<string, unknown>;
    if (mode === 'missing-file') op.file = undefined;
    if (mode === 'root-collection') op.collection = 'documents';
    if (mode === 'missing-doc-id') op.docId = undefined;
    if (mode === 'cross-project') metadata.projectId = 'other-project';
    if (mode === 'cross-worker') metadata.workerId = 'other-worker';
    if (mode === 'root-storage') op.data.storagePath = 'documents/file.pdf';
    if (mode === 'sentinel-worker') metadata.workerId = 'new';
    if (mode === 'bad-mime') op.file = new Blob(['other'], { type: 'image/png' });
    await expect(replayOnboardingUpload(op)).rejects.toThrow('scope_invalid'); expect(state.uploads).not.toHaveBeenCalled(); expect(state.writes).not.toHaveBeenCalled();
  });
});
