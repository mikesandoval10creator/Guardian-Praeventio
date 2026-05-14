/**
 * Firebase Admin SDK implementation of `ZkReadAdapter` for the MCP
 * stdio server entrypoint.
 *
 * Read-only by design — el server MCP NUNCA debe escribir al
 * Zettelkasten (la política está enforced upstream en `MCP_TOOLS` que
 * solo declara `zk.getNode` + `zk.listNodes` + `zk.expandSubgraph`).
 *
 * Schema asumido en Firestore (acordado con
 * `services/zettelkasten/canonical/materializer.ts`):
 *
 *   tenants/{tenantId}/zettelkasten_nodes/{nodeId}
 *     - id, type, title, description, tags[], connections[],
 *       severity?, projectId?, metadata{}
 *
 * Tenant scope:
 *   El caller del adapter (entrypoint) debe filtrar `listAccessibleTenants`
 *   contra una whitelist de tenants accesibles para el servicio MCP
 *   (claim del token de servicio o env var). Sin filtro upstream, este
 *   adapter NO debería usarse en prod — devuelve todos los tenants
 *   visibles para la cuenta del Admin SDK.
 */

import type { ZkNodeRef, ZkReadAdapter } from '../../services/mcp/zettelkastenServer';

/**
 * Tipo estructural minimalista de Firestore Admin que necesitamos.
 * NO importamos `firebase-admin` aquí — el entrypoint provee el
 * Firestore instance via constructor (lo cual permite testing con
 * mocks puros sin tocar el SDK real).
 */
export interface AdminFirestoreLike {
  collection(path: string): AdminCollectionLike;
}

export interface AdminCollectionLike {
  doc(id: string): AdminDocLike;
  where(field: string, op: string, value: unknown): AdminQueryLike;
  limit(n: number): AdminQueryLike;
  get(): Promise<AdminQuerySnapshot>;
  listDocuments?(): Promise<AdminDocLike[]>;
}

export interface AdminQueryLike {
  where(field: string, op: string, value: unknown): AdminQueryLike;
  limit(n: number): AdminQueryLike;
  get(): Promise<AdminQuerySnapshot>;
}

export interface AdminDocLike {
  id: string;
  get(): Promise<AdminDocSnapshot>;
  collection(path: string): AdminCollectionLike;
}

export interface AdminQuerySnapshot {
  docs: AdminDocSnapshot[];
}

export interface AdminDocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface ZkFirebaseAdapterConfig {
  firestore: AdminFirestoreLike;
  /** Tenants accesibles para este servidor MCP. Default: vacío
   *  (el caller DEBE poblar a través de claim o whitelist). */
  accessibleTenants: ReadonlyArray<string>;
  /** Hard cap del expandSubgraph BFS para evitar runaway. Default 200. */
  maxSubgraphNodes?: number;
  /** Hard cap del listNodes. Default 100. */
  maxListNodes?: number;
}

const DEFAULT_MAX_SUBGRAPH = 200;
const DEFAULT_MAX_LIST = 100;

/**
 * Construye el adapter read-only contra Firestore Admin.
 * NUNCA implementa write — el server MCP es por contrato read-only.
 */
export function createZkFirebaseReadAdapter(
  config: ZkFirebaseAdapterConfig,
): ZkReadAdapter {
  const tenants = Array.from(new Set(config.accessibleTenants ?? []));
  const maxSubgraph = config.maxSubgraphNodes ?? DEFAULT_MAX_SUBGRAPH;
  const maxList = config.maxListNodes ?? DEFAULT_MAX_LIST;

  function assertTenantAllowed(tenantId: string): void {
    if (!tenants.includes(tenantId)) {
      throw new Error(
        `zkFirebase: tenant '${tenantId}' not in accessible list. Caller must reject upstream.`,
      );
    }
  }

  function nodesCollection(tenantId: string): AdminCollectionLike {
    // tenants/{tid}/zettelkasten_nodes
    return config.firestore
      .collection('tenants')
      .doc(tenantId)
      .collection('zettelkasten_nodes');
  }

  function snapshotToNode(snap: AdminDocSnapshot): ZkNodeRef {
    const data = snap.data() ?? {};
    return {
      id: snap.id,
      type: String(data.type ?? 'UNKNOWN'),
      title: String(data.title ?? ''),
      description: String(data.description ?? ''),
      tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
      connections: Array.isArray(data.connections)
        ? (data.connections as string[])
        : [],
      severity:
        typeof data.severity === 'string'
          ? (data.severity as string)
          : undefined,
      projectId:
        typeof data.projectId === 'string'
          ? (data.projectId as string)
          : undefined,
      tenantId:
        typeof data.tenantId === 'string'
          ? (data.tenantId as string)
          : undefined,
      metadata:
        data.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : undefined,
    };
  }

  return {
    async listAccessibleTenants() {
      return tenants.slice();
    },

    async getNode(tenantId, nodeId) {
      assertTenantAllowed(tenantId);
      const ref = nodesCollection(tenantId).doc(nodeId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      return snapshotToNode(snap);
    },

    async listNodes(tenantId, filter) {
      assertTenantAllowed(tenantId);
      let q: AdminQueryLike | AdminCollectionLike = nodesCollection(tenantId);
      if (filter.projectId) q = q.where('projectId', '==', filter.projectId);
      if (filter.type) q = q.where('type', '==', filter.type);
      if (filter.severity) q = q.where('severity', '==', filter.severity);
      const lim = Math.min(filter.limit ?? maxList, maxList);
      q = q.limit(lim);
      const result = await q.get();
      return result.docs.map(snapshotToNode);
    },

    async expandSubgraph(tenantId, rootNodeId, depth) {
      assertTenantAllowed(tenantId);
      const cappedDepth = Math.max(0, Math.min(depth, 5));
      const visited = new Map<string, ZkNodeRef>();
      const queue: Array<{ id: string; depthLeft: number }> = [
        { id: rootNodeId, depthLeft: cappedDepth },
      ];

      while (queue.length > 0) {
        if (visited.size >= maxSubgraph) break;
        const { id, depthLeft } = queue.shift()!;
        if (visited.has(id)) continue;

        const ref = nodesCollection(tenantId).doc(id);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const node = snapshotToNode(snap);
        visited.set(id, node);

        if (depthLeft > 0) {
          for (const connId of node.connections) {
            if (!visited.has(connId)) {
              queue.push({ id: connId, depthLeft: depthLeft - 1 });
            }
          }
        }
      }

      return Array.from(visited.values());
    },
  };
}
