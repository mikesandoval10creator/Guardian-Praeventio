import type { RiskNode } from '../../types';
import { apiAuthHeader } from '../../lib/apiAuth';
import { randomId } from '../../utils/randomId';
import { offlineSync, type SyncOperation } from '../sync/syncStateMachine';

export const ZETTELKASTEN_GRAPH_SYNC_COLLECTION = 'zettelkasten_graph';

const GRAPH_MUTATION_ENDPOINTS = new Set([
  '/api/zettelkasten/graph/nodes',
  '/api/zettelkasten/graph/migrations',
  '/api/zettelkasten/graph/connections',
]);

interface GraphMutationData {
  id: string;
  endpoint: string;
  body: Record<string, unknown>;
}

async function enqueueGraphMutation(data: GraphMutationData): Promise<void> {
  await offlineSync.enqueue({
    type: 'set',
    collection: ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
    data,
  });
}

/**
 * Queue a Universal Knowledge node for the authenticated server writer.
 * The id is allocated once before enqueue so offline retries are idempotent.
 */
export async function createGraphNode(
  node: Omit<RiskNode, 'id'>,
  projectId: string,
): Promise<string> {
  const nodeId = randomId();
  await enqueueGraphNode(node, projectId, nodeId);
  return nodeId;
}

/** Queue a node whose id was already allocated by a durable legacy action. */
export async function enqueueGraphNode(
  node: Omit<RiskNode, 'id'>,
  projectId: string,
  nodeId: string,
): Promise<void> {
  await enqueueGraphMutation({
    id: `node:${nodeId}`,
    endpoint: '/api/zettelkasten/graph/nodes',
    body: { projectId, nodeId, node },
  });
}

/**
 * Queue lazy migrations by id only. Migration contents are computed from the
 * authoritative Firestore documents on the server, never trusted from a client.
 */
export async function migrateGraphNodes(nodeIds: string[], projectId: string): Promise<void> {
  const uniqueIds = Array.from(new Set(nodeIds)).sort();
  if (uniqueIds.length === 0) return;
  await enqueueGraphMutation({
    id: `migration:${projectId}:${uniqueIds.join(',')}`,
    endpoint: '/api/zettelkasten/graph/migrations',
    body: { projectId, nodeIds: uniqueIds },
  });
}

/** Queue a reciprocal, project-bound graph connection. */
export async function connectGraphNodes(
  fromId: string,
  toId: string,
  projectId: string,
): Promise<void> {
  const pair = [fromId, toId].sort();
  await enqueueGraphMutation({
    id: `connection:${projectId}:${pair[0]}:${pair[1]}`,
    endpoint: '/api/zettelkasten/graph/connections',
    body: { projectId, fromId, toId },
  });
}

/**
 * Central offline-sync executor for graph mutations. Authentication is resolved
 * at drain time so a queued operation never persists a bearer token.
 */
export async function executeGraphSyncOperation(op: SyncOperation): Promise<void> {
  if (op.collection !== ZETTELKASTEN_GRAPH_SYNC_COLLECTION) {
    throw new Error('not a Zettelkasten graph mutation');
  }
  const data = op.data as Partial<GraphMutationData> | undefined;
  if (!data || typeof data.endpoint !== 'string' || !GRAPH_MUTATION_ENDPOINTS.has(data.endpoint)) {
    throw new Error('unsupported graph mutation endpoint');
  }
  if (!data.body || typeof data.body !== 'object' || Array.isArray(data.body)) {
    throw new Error('invalid graph mutation body');
  }

  const authorization = await apiAuthHeader();
  if (!authorization) throw new Error('graph mutation authentication unavailable');

  const response = await fetch(data.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify(data.body),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 512);
    throw new Error(`graph mutation failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}
