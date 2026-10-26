// Praeventio Guard — Firestore-backed EdgeStore adapter (shared).
//
// Extraído de `src/server/routes/horometro.ts` (2026-05-29) para que tanto
// ese router como el nuevo endpoint de backlinks (§ZK-1) compartan UNA
// materialización del `EdgeStore` (la interfaz DI de `edges.ts`) en vez de
// duplicarla. El store vive en `tenants/{tenantId}/zettelkasten_edges`.

import type { EdgeStore, EdgeType, ZkEdge } from './edges.js';

import type { Firestore, Query } from 'firebase-admin/firestore';

/** Canonical Firestore collection path for a tenant's edges. */
export const EDGE_PATH = (tid: string): string =>
  `tenants/${tid}/zettelkasten_edges`;

/** Build a Firestore-backed `EdgeStore` (the DI shape `edges.ts` expects). */
export function buildEdgeStore(db: Firestore): EdgeStore {
  return {
    async saveEdge(edge: ZkEdge) {
      // Replace the document instead of merging it. Optional edge fields are
      // mutable metadata (for example projectId and decay parameters) but are
      // deliberately excluded from the content-addressed id. A merge would
      // therefore preserve stale values when an idempotent upsert clears or
      // changes one of those fields, causing project leakage or wrong weights.
      const payload = Object.fromEntries(
        Object.entries(edge).filter(([, value]) => value !== undefined),
      );
      await db
        .collection(EDGE_PATH(edge.tenantId))
        .doc(edge.id)
        .set(payload);
    },
    async deleteEdgeById(id: string, tenantId: string) {
      await db.collection(EDGE_PATH(tenantId)).doc(id).delete();
    },
    async findOutgoing(nodeId: string, tenantId: string, type?: EdgeType) {
      let q: Query = db
        .collection(EDGE_PATH(tenantId))
        .where('fromNodeId', '==', nodeId);
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
    async findIncoming(nodeId: string, tenantId: string, type?: EdgeType) {
      let q: Query = db
        .collection(EDGE_PATH(tenantId))
        .where('toNodeId', '==', nodeId);
      if (type) q = q.where('type', '==', type);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
    async listByTenant(tenantId: string, limit?: number) {
      let q: Query = db.collection(EDGE_PATH(tenantId));
      if (typeof limit === 'number' && limit > 0) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
    async listByProject(tenantId: string, projectId: string, limit?: number) {
      let q: Query = db
        .collection(EDGE_PATH(tenantId))
        .where('projectId', '==', projectId);
      if (typeof limit === 'number' && limit > 0) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as ZkEdge);
    },
  };
}
