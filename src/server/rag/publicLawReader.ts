// Existing indexed public-law corpus; no model client or embedding computation.
import { FieldPath, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { createNormativeRetriever, MAX_LAW_CHUNKS, type LawChunkRow } from '../../services/rag/nativeNormativeContext.js';

export async function readPublicLawCandidates(limit = MAX_LAW_CHUNKS + 1, db: Firestore = getFirestore()): Promise<LawChunkRow[]> {
  const cap = Number.isFinite(limit) ? Math.min(MAX_LAW_CHUNKS + 1, Math.max(1, Math.floor(limit))) : MAX_LAW_CHUNKS + 1;
  const snapshot = await db.collection('vector_store')
    .orderBy(FieldPath.documentId()).startAt('law-').endAt('law-\uf8ff')
    .select('lawId', 'title', 'content', 'nodeId', 'projectId', 'tenantId')
    .limit(cap).get();
  return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
}

export const retrieveNativeNormative = createNormativeRetriever(readPublicLawCandidates);
