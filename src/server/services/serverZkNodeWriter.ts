// Praeventio Guard — server-side Zettelkasten node writer (Codex P1 on #650).
//
// The browser `writeNodes` (services/zettelkasten/persistence/writeNode.ts)
// POSTs to `/api/zettelkasten/nodes` and falls back to IndexedDB via
// `saveForSync`. Both paths break in the Node/Express runtime (relative
// `fetch` has no base URL; IndexedDB doesn't exist). So when a ZK flow runs
// INSIDE Express — eppFlow's inspection/sign-order/order-pdf and
// incidentFlow's report/open/conclude — injecting the browser writer means
// the nodes it reports as created are never persisted.
//
// `serverWriteNodes` persists directly via the Admin SDK, faithfully
// mirroring the canonical endpoint's tri-write (`zettelkasten.ts` POST
// `/nodes`, §2.15):
//   1. legacy  `zettelkasten_nodes/{id}`            — source of truth
//   2. canonical `nodes/{tenant}_{project}_{id}`     — best-effort dual-write
//      (via the SAME pure `materializeNode` + `canonicalNodePath`)
//   3. `audit_logs` row
//
// IDs use the SAME `nodeIdFor` SHA-256 idempotency hash the browser client
// uses, so server- and client-written nodes collapse onto identical doc ids
// (a flow that runs once on-device and once server-side won't duplicate).

import admin from 'firebase-admin';
import {
  materializeNode,
  canonicalNodePath,
} from '../../services/zettelkasten/canonical/materializer.js';
import type { RiskNodePayload } from '../../services/zettelkasten/types.js';
import type {
  WriteContext,
  WriteResult,
} from '../../services/zettelkasten/persistence/writeNode.js';
import { logger } from '../../utils/logger.js';

/**
 * The acting user, stamped server-side from the verified token by the calling
 * route — NEVER trusted from the client (audit-log invariant, CLAUDE.md #3).
 */
export interface ZkWriteActor {
  createdBy: string;
  createdByEmail?: string | null;
}

/**
 * Build a `writeNodes`-shaped function bound to the authenticated actor, for
 * injection into a flow's deps (`{ writeNodes, ... }`). Matches the browser
 * `writeNodes` signature `(nodes, ctx) => Promise<WriteResult>` so it drops in.
 *
 * @example
 *   const deps: EppFlowDeps = {
 *     writeNodes: makeServerWriteNodes({ createdBy: callerUid, createdByEmail }),
 *     ...
 *   };
 */
export function makeServerWriteNodes(
  actor: ZkWriteActor,
): (nodes: RiskNodePayload[], ctx: WriteContext) => Promise<WriteResult> {
  return (nodes, ctx) => serverWriteNodes(nodes, ctx, actor);
}

export async function serverWriteNodes(
  nodes: RiskNodePayload[],
  ctx: WriteContext,
  actor: ZkWriteActor,
): Promise<WriteResult> {
  if (nodes.length === 0) return { ok: true, ids: [] };

  // `nodeIdFor` lives in the browser persistence module (which statically
  // imports the PWA offline queue). Import it dynamically — the same pattern
  // the cron materializer uses (`admin.ts:persistNodes`) — so the browser-only
  // `saveForSync` dependency never loads into the server bundle.
  const { nodeIdFor } = await import(
    '../../services/zettelkasten/persistence/writeNode.js'
  );

  const db = admin.firestore();
  const { projectId } = ctx;

  // Resolve the project's tenantId ONCE for the whole batch (legacy projects
  // may lack it → the canonical path falls back to the no-tenant form). Matches
  // zettelkasten.ts:219-234.
  let tenantId: string | undefined;
  try {
    const snap = await db.collection('projects').doc(projectId).get();
    const data = snap.exists
      ? (snap.data() as { tenantId?: string } | undefined)
      : undefined;
    if (typeof data?.tenantId === 'string' && data.tenantId.length > 0) {
      tenantId = data.tenantId;
    }
  } catch (err) {
    logger.warn?.('serverWriteNodes.tenant_resolve_failed', {
      projectId,
      err: err instanceof Error ? err.message : String(err),
    });
    // Continue without tenantId — the canonical write handles the legacy case.
  }

  const ids: string[] = [];
  for (const node of nodes) {
    const id = await nodeIdFor(node, projectId);
    ids.push(id);

    // 1. Legacy write — the source of truth (mirrors zettelkasten.ts:242-259).
    await db
      .collection('zettelkasten_nodes')
      .doc(id)
      .set(
        {
          title: node.title,
          description: node.description,
          type: node.type,
          severity: node.severity,
          metadata: node.metadata,
          connections: node.connections,
          references: node.references,
          projectId,
          createdBy: actor.createdBy,
          createdByEmail: actor.createdByEmail ?? null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          idempotencyKey: id,
        },
        { merge: true },
      );

    // 2. Canonical dual-write — best-effort, NEVER blocks the flow (mirrors
    //    zettelkasten.ts:266-297). If the pure materializer or the write fails
    //    the legacy doc is already persisted, so we log + continue.
    try {
      const canonical = materializeNode({
        zkNodeId: id,
        payload: node,
        projectId,
        tenantId,
        extraTags: ['server-flow-write'],
      });
      await db
        .doc(canonicalNodePath({ tenantId, projectId, zkNodeId: id }))
        .set(canonical, { merge: true });
    } catch (err) {
      logger.warn?.('serverWriteNodes.canonical_dual_write_failed', {
        zkNodeId: id,
        projectId,
        tenantId: tenantId ?? null,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. Audit row (mirrors zettelkasten.ts:299-314).
    await db.collection('audit_logs').add({
      action: 'zettelkasten.node.write',
      module: 'zettelkasten',
      details: {
        nodeId: id,
        type: node.type,
        severity: node.severity,
        source: 'server-flow',
        tenantResolved: tenantId !== undefined,
      },
      userId: actor.createdBy,
      userEmail: actor.createdByEmail ?? null,
      projectId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { ok: true, ids };
}
