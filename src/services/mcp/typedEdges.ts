// Stored relations only: no inference from adjacency, no model or mutation API.
import { z } from 'zod';
import { EDGE_TYPES, EDGE_INVERSES } from '../zettelkasten/edges.js';

const encoder = new TextEncoder();
const documentId = z.string().min(1).refine(value => !value.includes('/')
  && value !== '.' && value !== '..' && !/^__.*__$/.test(value)
  && !/[\uD800-\uDFFF]/u.test(value) && encoder.encode(value).length <= 1500);
const scopeId = documentId.refine(value => value.trim().length > 0 && value.length <= 200);
export const typedEdgesInput = z.object({
  tenantId: scopeId, projectId: scopeId,
  limit: z.number().int().min(1).max(50).optional().default(25),
}).strict();
export type TypedEdgesInput = z.input<typeof typedEdgesInput>;
export const storedEdgeSchema = z.object({
  id: documentId, tenantId: scopeId, projectId: scopeId,
  fromNodeId: documentId, toNodeId: documentId, type: z.enum(EDGE_TYPES),
  inverseType: z.string().max(50),
  weight: z.number().finite().min(0).max(1).optional(),
  validFrom: z.string().max(40).datetime({ offset: true }).optional(),
  validUntil: z.string().max(40).datetime({ offset: true }).optional(),
  decayFn: z.enum(['none', 'linear', 'exp']).optional(),
  decayHalfLifeMs: z.number().finite().positive().optional(),
}).refine(edge => edge.fromNodeId !== edge.toNodeId
  && edge.inverseType === EDGE_INVERSES[edge.type]
  && (!edge.validFrom || !edge.validUntil || Date.parse(edge.validFrom) <= Date.parse(edge.validUntil)));
export type StoredEdge = z.infer<typeof storedEdgeSchema>;
export type TypedEdgeRef = Omit<StoredEdge, 'tenantId' | 'projectId'>;
export interface TypedEdgesResult {
  source: 'stored-typed-edges'; tenantId: string; projectId: string;
  bounded: true; scanLimited: boolean; omitted: number; edges: TypedEdgeRef[];
}
export type TypedEdgesReader = (input: TypedEdgesInput) => Promise<TypedEdgesResult>;
export const typedEdgesOptIn = (raw: string | undefined): boolean => raw === '1';
export const TYPED_EDGES_TOOL = {
  name: 'zk.listEdges',
  description: 'Lee relaciones tipadas almacenadas del proyecto autorizado, con dirección/peso/fechas originales. Lectura acotada e incompleta; no infiere relaciones, no certifica mitigación real ni modifica el grafo.',
  inputSchema: { type: 'object' as const, properties: {
    tenantId: { type: 'string', minLength: 1, maxLength: 200 },
    projectId: { type: 'string', minLength: 1, maxLength: 200 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  }, required: ['tenantId', 'projectId'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
