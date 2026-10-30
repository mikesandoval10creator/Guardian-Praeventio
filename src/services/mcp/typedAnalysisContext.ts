// Projection for the exact node subset already approved for client sampling.
// It never fetches more nodes or infers semantics from legacy connections.
import { z } from 'zod';
import { storedEdgeSchema, type TypedEdgesReader, type TypedEdgesResult } from './typedEdges.js';

const envelope = z.object({
  source: z.literal('stored-typed-edges'), tenantId: z.string(), projectId: z.string(),
  bounded: z.literal(true), scanLimited: z.boolean(),
  omitted: z.number().int().min(0).max(12), edges: z.array(z.unknown()).max(12),
}).refine(value => value.omitted + value.edges.length <= 12);
export async function readSamplingRelations(tenantId: string, projectId: string,
  nodeIds: ReadonlySet<string>, reader: TypedEdgesReader): Promise<TypedEdgesResult> {
  let raw: unknown;
  try { raw = await reader({ tenantId, projectId, limit: 12 }); }
  catch { throw new Error('mcp_sampling_edge_context_unavailable'); }
  const checked = envelope.safeParse(raw);
  if (!checked.success || checked.data.tenantId !== tenantId || checked.data.projectId !== projectId) {
    throw new Error('mcp_sampling_invalid_edge_context');
  }
  const result: TypedEdgesResult = { source: 'stored-typed-edges', tenantId, projectId,
    bounded: true, scanLimited: checked.data.scanLimited, omitted: checked.data.omitted, edges: [] };
  const seen = new Set<string>();
  for (const ref of checked.data.edges) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) { result.omitted++; continue; }
    // DTOs normally omit their scope fields; a conflicting explicit stamp must
    // override the injected envelope fields and fail, never be normalized away.
    const parsed = storedEdgeSchema.safeParse({ tenantId, projectId, ...ref });
    if (!parsed.success || parsed.data.tenantId !== tenantId || parsed.data.projectId !== projectId
      || !nodeIds.has(parsed.data.fromNodeId) || !nodeIds.has(parsed.data.toNodeId)
      || /[()\s]/.test(parsed.data.id)) { result.omitted++; continue; }
    if (seen.has(parsed.data.id)) throw new Error('mcp_sampling_invalid_edge_context');
    seen.add(parsed.data.id);
    const { tenantId: _tenant, projectId: _project, ...projection } = parsed.data;
    result.edges.push(projection);
  }
  return result;
}
