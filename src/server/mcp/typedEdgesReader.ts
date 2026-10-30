// Read-only projection over canonical tenant edge/node collections. No global
// fallback: omission is preferable to disclosing a dangling/foreign endpoint.
import type { AdminFirestoreLike } from './zkFirebaseReadAdapter.js';
import { storedEdgeSchema, typedEdgesInput, type TypedEdgesReader, type TypedEdgesResult } from '../../services/mcp/typedEdges.js';
import type { SamplingProject } from '../../services/mcp/projectAnalysis.js';

export function createTypedEdgesReader(config: {
  firestore: AdminFirestoreLike;
  accessibleTenants: readonly string[];
  allowedProjects: readonly SamplingProject[];
}): TypedEdgesReader {
  // Snapshot operator policy, not references a later caller can mutate.
  const tenants = new Set(config.accessibleTenants);
  const projects = config.allowedProjects.map(p => ({ ...p }));
  return async input => {
    const parsed = typedEdgesInput.safeParse(input);
    if (!parsed.success) throw new Error('mcp_edges_invalid_arguments');
    const { tenantId, projectId, limit } = parsed.data;
    if (!tenants.has(tenantId) || !projects.some(p => p.tenantId === tenantId && p.projectId === projectId)) {
      throw new Error('mcp_edges_scope_not_allowed');
    }
    try {
      const tenant = config.firestore.collection('tenants').doc(tenantId);
      // Never read a tenant-wide limited window and filter it after the fact.
      const snapshot = await tenant.collection('zettelkasten_edges')
        .where('projectId', '==', projectId).limit(limit + 1).get();
      const result: TypedEdgesResult = { source: 'stored-typed-edges', tenantId,
        projectId, bounded: true, scanLimited: snapshot.docs.length > limit,
        omitted: 0, edges: [] };
      const endpointCache = new Map<string, boolean>();
      const inProject = async (id: string) => {
        if (endpointCache.has(id)) return endpointCache.get(id) === true;
        const snap = await tenant.collection('zettelkasten_nodes').doc(id).get();
        const d = snap.exists ? snap.data() : undefined;
        // Legacy absent tenant stamp is scoped by its tenant collection; an
        // explicit contradictory stamp is always rejected. Project is required.
        const allowed = Boolean(d && d.projectId === projectId
          && (d.tenantId === undefined || d.tenantId === tenantId));
        endpointCache.set(id, allowed);
        return allowed;
      };
      for (const row of snapshot.docs.slice(0, limit)) {
        const checked = storedEdgeSchema.safeParse(row.data());
        if (!checked.success || checked.data.id !== row.id
          || checked.data.tenantId !== tenantId || checked.data.projectId !== projectId) {
          result.omitted++; continue;
        }
        const edge = checked.data;
        if (!await inProject(edge.fromNodeId) || !await inProject(edge.toNodeId)) {
          result.omitted++; continue;
        }
        // Schema strips creator, arbitrary metadata and any other private fields.
        const { tenantId: _tenant, projectId: _project, ...projection } = edge;
        result.edges.push(projection);
        if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024) {
          result.edges.pop(); result.scanLimited = true; break;
        }
      }
      return result;
    } catch {
      // No store path, rejected ID, payload or SDK credential can escape.
      throw new Error('mcp_edges_store_unavailable');
    }
  };
}
