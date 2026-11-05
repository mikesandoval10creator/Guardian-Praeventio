import { doc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { queueIdentitiesMatch, resolveCurrentQueueIdentity, type QueueIdentity } from '../sync/queueIdentity';

export interface OnboardingUpload {
  type: string;
  collection: string;
  docId?: string;
  file?: Blob;
  queueIdentity?: QueueIdentity;
  data: Record<string, unknown>;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Stable, project-scoped replay. The caller owns queue retention/acknowledgement. */
export async function replayOnboardingUpload(action: OnboardingUpload): Promise<void> {
  const metadata = record(action.data.documentData) ? structuredClone(action.data.documentData) : null;
  const identity = action.queueIdentity ? { ...action.queueIdentity } : null;
  const documentId = action.docId;
  const file = action.file;
  if (action.type !== 'upload' || !metadata || !identity || !validId(documentId) ||
      !validId(metadata.projectId) || metadata.projectId === 'global' || !validId(metadata.workerId) || metadata.workerId === 'new' ||
      typeof metadata.name !== 'string' || !/^[A-Za-z0-9_.-]{1,240}\.pdf$/.test(metadata.name) ||
      metadata.type !== 'legal_onboarding' || metadata.archived !== false ||
      metadata.tenantId !== identity.tenantId || metadata.createdBy !== identity.ownerUid ||
      !file || file.type !== 'application/pdf' || file.size < 1) {
    throw new Error('onboarding_upload_scope_invalid');
  }
  const collection = `projects/${metadata.projectId}/workers/${metadata.workerId}/documents`;
  const path = `${collection}/${documentId}/${metadata.name}`;
  if (action.collection !== collection || action.data.storagePath !== path || metadata.storagePath !== path) {
    throw new Error('onboarding_upload_scope_invalid');
  }
  const capturedIdentity = identity;
  async function assertOwner() {
    const current = await resolveCurrentQueueIdentity();
    if (!current || !queueIdentitiesMatch(capturedIdentity, current)) throw new Error('onboarding_upload_owner_changed');
  }
  function validateExisting(data: unknown) {
    if (!record(data) || data.storagePath !== path || data.projectId !== metadata?.projectId ||
        data.workerId !== metadata?.workerId || data.createdBy !== identity?.ownerUid || data.tenantId !== identity?.tenantId) {
      throw new Error('onboarding_upload_existing_conflict');
    }
  }
  await assertOwner();
  const target = doc(db, collection, documentId);
  const existing = await getDocFromServer(target);
  await assertOwner();
  // A repeated ACK must not restore an archived record or overwrite its bytes.
  if (existing.exists()) { validateExisting(existing.data()); return; }
  await uploadBytes(ref(storage, path), file, { contentType: 'application/pdf' });
  await assertOwner();
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(target);
    await assertOwner();
    if (current.exists()) { validateExisting(current.data()); return; }
    transaction.set(target, metadata);
  });
  await assertOwner();
}
