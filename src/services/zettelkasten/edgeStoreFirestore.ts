// Praeventio Guard — Firestore-backed EdgeStore adapter (shared).
//
// Extraído de `src/server/routes/horometro.ts` (2026-05-29) para que tanto
// ese router como el nuevo endpoint de backlinks (§ZK-1) compartan UNA
// materialización del `EdgeStore` (la interfaz DI de `edges.ts`) en vez de
// duplicarla. El store vive en `tenants/{tenantId}/zettelkasten_edges`.

import type admin from 'firebase-admin';
import type { EdgeStore, EdgeType, ZkEdge } from './edges.js';

/** Canonical Firestore collection path for a tenant's edges. */
export const EDGE_PATH = (tid: string): string =>
  `tenants/${tid}/zettelkasten_edges`;

/** Build a Firestore-backed `EdgeStore` (the DI shape `edges.ts` expects). */
export function buildEdgeStore(db: admin.firestore.Firestore): EdgeStore {
  return {
    async saveEdge(edge: ZkEdge) {
      await db
        .collection(EDGE_PATH(edge.tenantId))
        .doc(edge.id)
        .set(edge, { merge: true });
    },
    async deleteEdgeById(id: string, tenantId: string) {
      await db.collection(EDGE_PATH(tenantId)).doc(id).delete();
    },
    async findOutgoing(nodeId: string, tenantId: string, type?: EdgeType) {
      let q: admin.firestore.Query = db
        .collection(EDGE_PATH(tenantId))
        .where('fromNodeId', '==', nodeId);
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
    async findIncoming(nodeId: string, tenantId: string, type?: EdgeType) {
      let q: admin.firestore.Query = db
        .collection(EDGE_PATH(tenantId))
        .where('toNodeId', '==', nodeId);
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
    async listByTenant(tenantId: string, limit?: number) {
      let q: admin.firestore.Query = db.collection(EDGE_PATH(tenantId));
      if (typeof limit === 'number' && limit > 0) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
  };
}
