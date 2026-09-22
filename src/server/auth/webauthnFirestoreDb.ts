
import type { MinimalChallengesDb } from '../../services/auth/webauthnChallenge.js';
import type { MinimalCredentialsDb } from '../../services/auth/webauthnCredentialStore.js';

import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentData, DocumentReference, UpdateData } from 'firebase-admin/firestore';

/** Firestore adapter for atomic, single-use WebAuthn challenges. */
export function createWebAuthnChallengesFirestoreDb(): MinimalChallengesDb {
  const firestore = getFirestore();
  return {
    now: () => Date.now(),
    collection(name: string) {
      const collection = firestore.collection(name);
      return {
        doc(id: string) {
          const ref = collection.doc(id);
          return {
            async get() {
              const snapshot = await ref.get();
              return {
                exists: snapshot.exists,
                id: snapshot.id,
                data: () =>
                  snapshot.exists
                    ? (snapshot.data() as Record<string, unknown>)
                    : undefined,
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data);
            },
            async updateIf(
              precondition: (current: Record<string, unknown> | undefined) => boolean,
              patch: Record<string, unknown>,
            ): Promise<boolean> {
              return firestore.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(ref);
                const current = snapshot.exists
                  ? (snapshot.data() as Record<string, unknown>)
                  : undefined;
                if (!precondition(current)) return false;
                transaction.update(
                  ref,
                  patch as unknown as { [key: string]: any },
                );
                return true;
              });
            },
            async delete() {
              await ref.delete();
            },
          };
        },
        // Equality-only where(). Forwards to Firestore's native query
        // API; the production read is index-bound on (uid, __name__)
        // so the anonymize sweep stays a single round-trip and avoids
        // a collection scan.
        where(field: string, op: '==', value: unknown) {
          const query = collection.where(field, op, value);
          return {
            async get() {
              const snapshot = await query.get();
              return {
                empty: snapshot.empty,
                docs: snapshot.docs.map((d) => ({
                  id: d.id,
                  data: () => d.data() as Record<string, unknown>,
                })),
              };
            },
          };
        },
      };
    },
  };
}

/** Firestore adapter for registered public WebAuthn credentials. */
export function createWebAuthnCredentialsFirestoreDb(): MinimalCredentialsDb {
  const firestore = getFirestore();
  return {
    now: () => Date.now(),
    collection(name: string) {
      const collection = firestore.collection(name);
      return {
        doc(id: string) {
          const ref = collection.doc(id);
          return {
            // [Hy3-audit] Expose the canonical doc path + __docId so consumers
            // that pass this ref through to transactional helpers
            // (e.g. `tx.update(ref)`) can recover the absolute path without
            // re-running the lookup. Required by MinimalCredentialsDb
            // .runTransaction adapters that only know about the ref's path
            // (e.g. the fakeFirestore global in __tests__/helpers).
            path: ref.path,
            __docId: id,
            async get() {
              const snapshot = await ref.get();
              return {
                exists: snapshot.exists,
                id: snapshot.id,
                data: () =>
                  snapshot.exists
                    ? (snapshot.data() as Record<string, unknown>)
                    : undefined,
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data);
            },
            async update(patch: Record<string, unknown>) {
              await ref.update(patch);
            },
            async delete() {
              await ref.delete();
            },
          };
        },
        where(field: string, op: '==', value: unknown) {
          const query = collection.where(field, op, value);
          return {
            async get() {
              const snapshot = await query.get();
              return {
                empty: snapshot.empty,
                docs: snapshot.docs.map((doc) => ({
                  id: doc.id,
                  data: () => doc.data() as Record<string, unknown>,
                })),
              };
            },
          };
        },
      };
    },
    // Real Firestore runTransaction: gives compareAndSwapCounter genuine
    // atomic CAS semantics. Reads inside the txn see a coherent snapshot;
    // writes are committed atomically. If the body throws, the txn aborts.
    async runTransaction<T>(
      updateFn: (tx: {
        get: (ref: unknown) => Promise<{
          exists: boolean;
          id: string;
          data: () => Record<string, unknown> | undefined;
        }>;
        update: (ref: unknown, patch: Record<string, unknown>) => Promise<void>;
      }) => Promise<T>,
    ): Promise<T> {
      return firestore.runTransaction(async (transaction) => {
        return updateFn({
          async get(ref: unknown) {
            const docRef = ref as DocumentReference;
            const snap = await transaction.get(docRef);
            return {
              exists: snap.exists,
              id: snap.id,
              data: () =>
                snap.exists
                  ? (snap.data() as Record<string, unknown>)
                  : undefined,
            };
          },
          async update(ref: unknown, patch: Record<string, unknown>) {
            const docRef = ref as DocumentReference;
            transaction.update(docRef, patch as UpdateData<DocumentData>);
          },
        });
      });
    },
  };
}
