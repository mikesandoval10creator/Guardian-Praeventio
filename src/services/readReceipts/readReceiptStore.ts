// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) read-receipt store.
// Plan 2026-05-23 §Fase B.4 — refactor: usa factory para DocumentForRead.
//
// `ReadReceipt` mantiene su lógica custom porque usa composite id
// (documentId__workerUid) — no encaja con el factory genérico que asume
// `T.id` como key Firestore.
//
// Schema:
//   projects/{projectId}/documents_for_read/{documentId}   (factory)
//   projects/{projectId}/read_receipts/{documentId__workerUid}  (custom)

import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
} from '../firebase';
import { createProjectScopedStore } from '../firestore/createProjectScopedStore';
import type {
  DocumentForRead,
  ReadReceipt,
} from './readReceiptService';

// ─── DocumentForRead via factory ────────────────────────────────────────

const docsStore = createProjectScopedStore<DocumentForRead>('documents_for_read', {
  defaultLimit: 50,
  orderByField: 'publishedAt',
});

export async function saveDocumentForRead(
  projectId: string,
  document: DocumentForRead,
): Promise<void> {
  await docsStore.save(projectId, document);
}

export const subscribeDocumentsForRead = docsStore.subscribe;
export const listDocumentsForRead = docsStore.list;

// ─── ReadReceipt custom (composite id) ──────────────────────────────────

function receiptsPath(projectId: string): string {
  return `projects/${projectId}/read_receipts`;
}

function receiptDocId(documentId: string, workerUid: string): string {
  return `${documentId}__${workerUid}`;
}

export async function saveReceipt(
  projectId: string,
  receipt: ReadReceipt,
): Promise<void> {
  if (!projectId) throw new Error('saveReceipt: projectId vacío');
  if (!receipt?.documentId || !receipt?.workerUid) {
    throw new Error('saveReceipt: documentId/workerUid vacíos');
  }
  const id = receiptDocId(receipt.documentId, receipt.workerUid);
  const ref = doc(db, receiptsPath(projectId), id);
  await setDoc(ref, { ...receipt, updatedAt: Date.now() }, { merge: true });
}

export async function acknowledgeReceiptInFirestore(
  projectId: string,
  documentId: string,
  workerUid: string,
  acknowledgedAt: string = new Date().toISOString(),
): Promise<void> {
  const id = receiptDocId(documentId, workerUid);
  const ref = doc(db, receiptsPath(projectId), id);
  await updateDoc(ref, {
    acknowledgedAt,
    status: 'acknowledged',
    updatedAt: Date.now(),
  });
}

export function subscribeReceiptsForDocument(
  projectId: string,
  documentId: string,
  onSnap: (receipts: ReadReceipt[]) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!projectId || !documentId) {
    onSnap([]);
    return () => {};
  }
  // Sin where() para no requerir índice; filtramos cliente-side por
  // documentId. En proyectos con muchos receipts esto se optimiza con
  // un compound index.
  const col = collection(db, receiptsPath(projectId));
  return onSnapshot(
    col,
    (snap) => {
      const out: ReadReceipt[] = [];
      snap.forEach((d) => {
        try {
          const data = d.data() as ReadReceipt;
          if (data.documentId === documentId) out.push(data);
        } catch {
          /* skip */
        }
      });
      onSnap(out);
    },
    (err) => {
      onError?.(err as Error);
      onSnap([]);
    },
  );
}
