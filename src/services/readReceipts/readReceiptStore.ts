// SPDX-License-Identifier: MIT
// Praeventio Guard — Sprint K wire UI (2026-05-23) read-receipt store.
//
// CRUD client-side para `DocumentForRead` + `ReadReceipt`.
// Schema:
//   projects/{projectId}/documents_for_read/{documentId}
//   projects/{projectId}/read_receipts/{documentId__workerUid}

import {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from '../firebase';
import type {
  DocumentForRead,
  ReadReceipt,
} from './readReceiptService';

function docsPath(projectId: string): string {
  return `projects/${projectId}/documents_for_read`;
}

function receiptsPath(projectId: string): string {
  return `projects/${projectId}/read_receipts`;
}

function receiptDocId(documentId: string, workerUid: string): string {
  return `${documentId}__${workerUid}`;
}

export async function saveDocumentForRead(
  projectId: string,
  document: DocumentForRead,
): Promise<void> {
  if (!projectId) throw new Error('saveDocumentForRead: projectId vacío');
  if (!document?.id) throw new Error('saveDocumentForRead: id vacío');
  const ref = doc(db, docsPath(projectId), document.id);
  await setDoc(ref, { ...document, updatedAt: Date.now() }, { merge: true });
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

export function subscribeDocumentsForRead(
  projectId: string,
  onSnap: (documents: DocumentForRead[]) => void,
  onError?: (err: Error) => void,
  limitCount: number = 50,
): () => void {
  if (!projectId) {
    onSnap([]);
    return () => {};
  }
  const col = collection(db, docsPath(projectId));
  const q = query(col, orderBy('publishedAt', 'desc'), limit(Math.max(1, Math.min(limitCount, 200))));
  return onSnapshot(
    q,
    (snap) => {
      const out: DocumentForRead[] = [];
      snap.forEach((d) => {
        try {
          out.push({ ...(d.data() as DocumentForRead), id: d.id });
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
