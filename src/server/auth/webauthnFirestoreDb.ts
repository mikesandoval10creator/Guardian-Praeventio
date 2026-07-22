import admin from 'firebase-admin';

import type { MinimalChallengesDb } from '../../services/auth/webauthnChallenge.js';
import type { MinimalCredentialsDb } from '../../services/auth/webauthnCredentialStore.js';

/** Firestore adapter for atomic, single-use WebAuthn challenges. */
export function createWebAuthnChallengesFirestoreDb(): MinimalChallengesDb {
  const firestore = admin.firestore();
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
          };
        },
      };
    },
  };
}

/** Firestore adapter for registered public WebAuthn credentials. */
export function createWebAuthnCredentialsFirestoreDb(): MinimalCredentialsDb {
  const firestore = admin.firestore();
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
  };
}
