import type { Response, Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { zettelkastenWriteLimiter } from '../middleware/limiters.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  applyMigrations,
  needsUpgrade,
} from '../../services/migration/registry.js';
import { logger } from '../../utils/logger.js';
import { NodeType } from '../../types/index.js';

const GRAPH_ID = /^[A-Za-z0-9_-]{1,128}$/;

const graphNodeSchema = z.object({
  type: z.nativeEnum(NodeType),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(50_000),
  tags: z.array(z.string().max(200)).max(50),
  metadata: z.record(z.string(), z.unknown()),
  connections: z.array(z.string().max(256)).max(200),
  isPublic: z.boolean().optional(),
  isTemplate: z.boolean().optional(),
  block: z.enum(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']).optional(),
  embedding: z.array(z.number().finite()).max(4096).optional(),
});

const createGraphNodeSchema = z.object({
  projectId: z.string().regex(GRAPH_ID),
  nodeId: z.string().regex(GRAPH_ID),
  node: graphNodeSchema,
});

const migrateGraphNodesSchema = z.object({
  projectId: z.string().regex(GRAPH_ID),
  nodeIds: z.array(z.string().regex(GRAPH_ID)).min(1).max(32),
});

const connectGraphNodesSchema = z.object({
  projectId: z.string().regex(GRAPH_ID),
  fromId: z.string().regex(GRAPH_ID),
  toId: z.string().regex(GRAPH_ID),
}).refine((body) => body.fromId !== body.toId, {
  message: 'fromId and toId must differ',
  path: ['toId'],
});

class GraphNodeScopeError extends Error {}
class GraphNodeConflictError extends Error {}
class GraphConnectionLimitError extends Error {}

async function requireProjectMember(
  uid: string,
  projectId: string,
): Promise<void> {
  await assertProjectMember(uid, projectId, admin.firestore());
}

async function auditGraphMutation(
  req: Parameters<typeof auditServerEvent>[0],
  action: string,
  details: Record<string, unknown>,
  projectId: string,
): Promise<void> {
  try {
    await auditServerEvent(req, action, 'zettelkasten', details, { projectId });
  } catch (err) {
    // Defensive: auditServerEvent currently resolves false instead of throwing,
    // but the mutation must remain successful if observability changes later.
    logger.error('zettelkasten_graph_audit_failed', {
      action,
      projectId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function membershipFailure(err: unknown, res: Response): boolean {
  if (err instanceof ProjectMembershipError) {
    res.status(err.httpStatus).json({ error: 'forbidden' });
    return true;
  }
  return false;
}

export function registerZettelkastenGraphMutationRoutes(router: Router): void {
  router.post(
    '/graph/nodes',
    verifyAuth,
    zettelkastenWriteLimiter,
    validate(createGraphNodeSchema),
    async (req, res) => {
      const uid = req.user?.uid;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const { projectId, nodeId, node } = req.body as z.infer<typeof createGraphNodeSchema>;

      try {
        await requireProjectMember(uid, projectId);
      } catch (err) {
        if (membershipFailure(err, res)) return;
        throw err;
      }

      try {
        const db = admin.firestore();
        const ref = db.collection('nodes').doc(nodeId);
        const now = new Date().toISOString();
        const created = await db.runTransaction(async (txn) => {
          const existing = await txn.get(ref);
          if (existing.exists) {
            const data = existing.data() as Record<string, unknown> | undefined;
            const metadata = data?.metadata as Record<string, unknown> | undefined;
            if (data?.projectId !== projectId || metadata?.authorId !== uid) {
              throw new GraphNodeConflictError('node id belongs to another actor or project');
            }
            return false;
          }
          txn.create(ref, {
            ...node,
            projectId,
            metadata: { ...node.metadata, authorId: uid },
            createdAt: now,
            updatedAt: now,
          });
          return true;
        });

        if (created) {
          await auditGraphMutation(
            req,
            'zettelkasten.graph.node.create',
            { nodeId, type: node.type },
            projectId,
          );
        }
        return res.status(created ? 201 : 200).json({ id: nodeId, created });
      } catch (err) {
        if (err instanceof GraphNodeConflictError) {
          return res.status(409).json({ error: 'node_conflict' });
        }
        logger.error('zettelkasten_graph_node_create_failed', {
          projectId,
          uid,
          err: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({ error: 'internal_error' });
      }
    },
  );

  router.post(
    '/graph/migrations',
    verifyAuth,
    zettelkastenWriteLimiter,
    validate(migrateGraphNodesSchema),
    async (req, res) => {
      const uid = req.user?.uid;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const { projectId, nodeIds } = req.body as z.infer<typeof migrateGraphNodesSchema>;
      const uniqueIds = Array.from(new Set(nodeIds)).sort();

      try {
        await requireProjectMember(uid, projectId);
      } catch (err) {
        if (membershipFailure(err, res)) return;
        throw err;
      }

      try {
        const db = admin.firestore();
        const migrated = await db.runTransaction(async (txn) => {
          const refs = uniqueIds.map((id) => db.collection('nodes').doc(id));
          const snapshots = [];
          for (const ref of refs) snapshots.push(await txn.get(ref));

          for (const snap of snapshots) {
            const data = snap.data() as Record<string, unknown> | undefined;
            if (!snap.exists || data?.projectId !== projectId) {
              throw new GraphNodeScopeError('node absent or outside project');
            }
          }

          const changed: string[] = [];
          for (let i = 0; i < snapshots.length; i += 1) {
            const data = snapshots[i].data() as Record<string, unknown>;
            if (!needsUpgrade(data)) continue;
            const upgraded = applyMigrations(data) as Record<string, unknown>;
            txn.update(refs[i], {
              schemaVersion: upgraded.schemaVersion,
              tags: upgraded.tags,
              connections: upgraded.connections,
              metadata: upgraded.metadata,
              updatedAt: new Date().toISOString(),
            });
            changed.push(uniqueIds[i]);
          }
          return changed;
        });

        if (migrated.length > 0) {
          await auditGraphMutation(
            req,
            'zettelkasten.graph.nodes.migrate',
            { nodeIds: migrated, count: migrated.length },
            projectId,
          );
        }
        return res.json({ migrated });
      } catch (err) {
        if (err instanceof GraphNodeScopeError) {
          return res.status(404).json({ error: 'node_not_found' });
        }
        logger.error('zettelkasten_graph_migration_failed', {
          projectId,
          uid,
          err: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({ error: 'internal_error' });
      }
    },
  );

  router.post(
    '/graph/connections',
    verifyAuth,
    zettelkastenWriteLimiter,
    validate(connectGraphNodesSchema),
    async (req, res) => {
      const uid = req.user?.uid;
      if (!uid) return res.status(401).json({ error: 'unauthorized' });
      const { projectId, fromId, toId } = req.body as z.infer<typeof connectGraphNodesSchema>;

      try {
        await requireProjectMember(uid, projectId);
      } catch (err) {
        if (membershipFailure(err, res)) return;
        throw err;
      }

      try {
        const db = admin.firestore();
        const changed = await db.runTransaction(async (txn) => {
          const fromRef = db.collection('nodes').doc(fromId);
          const toRef = db.collection('nodes').doc(toId);
          const [fromSnap, toSnap] = await Promise.all([txn.get(fromRef), txn.get(toRef)]);
          const from = fromSnap.data() as Record<string, unknown> | undefined;
          const to = toSnap.data() as Record<string, unknown> | undefined;
          if (!fromSnap.exists || !toSnap.exists || from?.projectId !== projectId || to?.projectId !== projectId) {
            throw new GraphNodeScopeError('connection endpoint absent or outside project');
          }

          const fromConnections = Array.isArray(from.connections) ? [...from.connections] as string[] : [];
          const toConnections = Array.isArray(to.connections) ? [...to.connections] as string[] : [];
          const fromChanged = !fromConnections.includes(toId);
          const toChanged = !toConnections.includes(fromId);
          if (fromChanged) fromConnections.push(toId);
          if (toChanged) toConnections.push(fromId);
          if (fromConnections.length > 200 || toConnections.length > 200) {
            throw new GraphConnectionLimitError('connection limit exceeded');
          }
          const now = new Date().toISOString();
          if (fromChanged) txn.update(fromRef, { connections: fromConnections, updatedAt: now });
          if (toChanged) txn.update(toRef, { connections: toConnections, updatedAt: now });
          return fromChanged || toChanged;
        });

        if (changed) {
          await auditGraphMutation(
            req,
            'zettelkasten.graph.nodes.connect',
            { fromId, toId },
            projectId,
          );
        }
        return res.json({ connected: true });
      } catch (err) {
        if (err instanceof GraphNodeScopeError) {
          return res.status(404).json({ error: 'node_not_found' });
        }
        if (err instanceof GraphConnectionLimitError) {
          return res.status(409).json({ error: 'connection_limit' });
        }
        logger.error('zettelkasten_graph_connection_failed', {
          projectId,
          uid,
          err: err instanceof Error ? err.message : String(err),
        });
        return res.status(500).json({ error: 'internal_error' });
      }
    },
  );
}
