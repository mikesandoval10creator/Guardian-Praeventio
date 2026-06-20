// Praeventio Guard — Evidence Chain-of-Custody (audit H8 · Sprint 39 Fase J.7).
//
// Productionizes the previously-inert custody subsystem
// (`src/services/evidenceChain/custodyChainService.ts` engine +
// `custodyChainFirestoreAdapter.ts` persistence). Before this route the engine
// + adapter had NO production caller (DEEP-EX-16 H8) and the
// `tenants/{tid}/evidence_artifacts` collection (+ `/events` subcollection) had
// NO Firestore rule → default-deny dead code.
//
// Founder directive — the app NEVER blocks; it RECORDS with legal traceability.
// These endpoints materialize the content-addressed evidence chain (photos,
// PDFs, declarations, measurement data) that an incident expediente promises:
//   - register an artifact (SHA-256 of the bytes is the doc id, content-addressed)
//   - replace it (the original is NEVER deleted — marked `replacedByHash`)
//   - record a read access (Ley 19.628 access trail)
//   - record an export (who pulled the evidence out, to where)
//
// Identity invariant (CLAUDE.md #3): the actor uid + the tenant come from the
// VERIFIED token / project doc, NEVER from the request body. The body carries
// only the payload + metadata; `uploadedByUid` / `actorUid` are server-stamped.
//
// Endpoints (mounted under `/api/sprint-k`):
//   GET  /:projectId/evidence/:hash                       → artifact + custody chain
//   POST /:projectId/evidence                             → register (bytes base64)
//   POST /:projectId/evidence/:hash/replace               → replace (chain-preserving)
//   POST /:projectId/evidence/:hash/access                → record an access event
//   POST /:projectId/evidence/:hash/export                → record an export event
//
// Every state-changing op writes ONE `audit_logs` row (CLAUDE.md #3/#14,
// awaited try/catch) in addition to the immutable custody `/events` subcoll.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  CustodyChainAdapter,
  type CustodyFirestoreDb,
} from '../../services/evidenceChain/custodyChainFirestoreAdapter.js';
import {
  registerArtifact,
  replaceArtifact,
  recordAccess,
  recordExport,
  summarizeChain,
  type EvidenceArtifact,
  type CustodyEvent,
  CustodyValidationError,
} from '../../services/evidenceChain/custodyChainService.js';

const router = Router();

async function resolveTenantId(
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

function adapterFor(tenantId: string): CustodyChainAdapter {
  // admin.firestore() is structurally compatible with CustodyFirestoreDb.
  return new CustodyChainAdapter(
    admin.firestore() as unknown as CustodyFirestoreDb,
    tenantId,
  );
}

/** Caller role from the verified token, used to enrich custody events. */
function callerRole(req: import('express').Request): string {
  const role = (req.user as { role?: string } | undefined)?.role;
  return typeof role === 'string' && role.length > 0 ? role : 'unknown';
}

// ── Schemas ──────────────────────────────────────────────────────────
const artifactKindEnum = z.enum([
  'photo',
  'video',
  'document_pdf',
  'audio',
  'declaration',
  'measurement_data',
]);

const capturedAtSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timestamp: z.string().min(10).max(40),
});

const registerSchema = z.object({
  kind: artifactKindEnum,
  mimeType: z.string().min(1).max(200),
  // Raw evidence payload, base64-encoded. Capped at ~6 MB of base64
  // (~4.5 MB binary) so a single request cannot exhaust memory — larger
  // media uploads through Storage are out of scope for this metadata route.
  contentBase64: z.string().min(1).max(8_000_000),
  capturedAt: capturedAtSchema.optional(),
  linkedNodeId: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const replaceSchema = z.object({
  // Hash of the NEW artifact that supersedes this one (already registered).
  newArtifactHash: z.string().min(16).max(128),
  reason: z.string().min(10).max(2000),
});

const accessSchema = z.object({
  notes: z.string().max(2000).optional(),
});

const exportSchema = z.object({
  exportTarget: z.string().min(1).max(500),
});

function decodeBase64(b64: string): Uint8Array | null {
  try {
    // Reject obviously non-base64 input before allocating a Buffer.
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Strip undefined keys — Firestore rejects `undefined` field values.
 * Constrained to `object` (not `Record<string, unknown>`) so the domain
 * interfaces `EvidenceArtifact` / `CustodyEvent` (which have no index
 * signature) satisfy it; the shape is preserved on the way out.
 */
function pruneUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// ── GET (all chains linked to a graph node, e.g. an incident) ─────────
// Materializes the custody chains promised by an incident expediente:
// every artifact whose `linkedNodeId` is the incident node, each with its
// full append-only custody event trail. Read-only; uses the already-tested
// adapter.listArtifactsForNode + listEvents (no fabrication — returns the
// real persisted artifacts, an empty array when none are linked yet).
// Path uses a distinct segment (`evidence-by-node`) so the node id can NEVER
// be mistaken for an artifact hash by the `/evidence/:hash` route above.
router.get('/:projectId/evidence-by-node/:nodeId', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, nodeId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = adapterFor(g.tenantId);
    const artifacts = await adapter.listArtifactsForNode(nodeId);
    const chains = await Promise.all(
      artifacts.map(async (artifact) => {
        const events = await adapter.listEvents(artifact.id);
        return { artifact, events, summary: summarizeChain(artifact, events) };
      }),
    );
    return res.json({ chains });
  } catch (err) {
    logger.error?.('custody.byNode.error', err);
    captureRouteError(err, 'custody.byNode', { callerUid, tenantId: g.tenantId, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── GET (artifact + chain) ───────────────────────────────────────────
router.get('/:projectId/evidence/:hash', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, hash } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = adapterFor(g.tenantId);
    const artifact = await adapter.getArtifact(hash);
    if (!artifact) return res.status(404).json({ error: 'artifact_not_found' });
    const events = await adapter.listEvents(hash);
    return res.json({
      artifact,
      events,
      summary: summarizeChain(artifact, events),
    });
  } catch (err) {
    logger.error?.('custody.get.error', err);
    captureRouteError(err, 'custody.get', { callerUid, tenantId: g.tenantId, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST register ────────────────────────────────────────────────────
router.post('/:projectId/evidence', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const body = parsed.data;
  const bytes = decodeBase64(body.contentBase64);
  if (!bytes) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  try {
    const adapter = adapterFor(g.tenantId);
    // Engine stamps the hash, byteSize and uploadedAt. uploadedByUid is the
    // VERIFIED caller — NEVER taken from the body (CLAUDE.md #3).
    const { artifact, event } = registerArtifact({
      kind: body.kind,
      mimeType: body.mimeType,
      bytes,
      uploadedByUid: callerUid,
      capturedAt: body.capturedAt,
      linkedNodeId: body.linkedNodeId,
      notes: body.notes,
    });
    // Enrich the engine's 'unknown' role with the real caller role.
    const enrichedEvent: CustodyEvent = { ...event, actorRole: callerRole(req) };
    const persisted: EvidenceArtifact = pruneUndefined(artifact);
    await adapter.saveArtifact(persisted);
    await adapter.appendEvent(enrichedEvent);
    try {
      await auditServerEvent(
        req,
        'custody.register',
        'evidenceChain',
        { artifactHash: artifact.id, kind: artifact.kind, byteSize: artifact.byteSize },
        { projectId },
      );
    } catch (auditErr) {
      logger.error('audit_event_failed', { action: 'custody.register', err: String(auditErr) });
      captureRouteError(auditErr, 'custody.register.audit', { callerUid, tenantId: g.tenantId, projectId });
    }
    return res.status(201).json({ artifact: persisted });
  } catch (err) {
    if (err instanceof CustodyValidationError) {
      return res.status(400).json({ error: 'custody_invalid', code: err.code });
    }
    logger.error?.('custody.register.error', err);
    captureRouteError(err, 'custody.register', { callerUid, tenantId: g.tenantId, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST replace (chain-preserving) ──────────────────────────────────
router.post('/:projectId/evidence/:hash/replace', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, hash } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = replaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const body = parsed.data;
  try {
    const adapter = adapterFor(g.tenantId);
    const original = await adapter.getArtifact(hash);
    if (!original) return res.status(404).json({ error: 'artifact_not_found' });
    // Engine enforces the invariants: not-already-replaced + reason ≥10 chars.
    const { artifact: updated, event } = replaceArtifact(
      original,
      body.newArtifactHash,
      callerUid,
      body.reason,
    );
    const enrichedEvent: CustodyEvent = { ...event, actorRole: callerRole(req) };
    await adapter.markReplaced(hash, body.newArtifactHash, updated.replacedAt!);
    await adapter.appendEvent(enrichedEvent);
    try {
      await auditServerEvent(
        req,
        'custody.replace',
        'evidenceChain',
        { artifactHash: hash, replacedByHash: body.newArtifactHash },
        { projectId },
      );
    } catch (auditErr) {
      logger.error('audit_event_failed', { action: 'custody.replace', err: String(auditErr) });
      captureRouteError(auditErr, 'custody.replace.audit', { callerUid, tenantId: g.tenantId, projectId });
    }
    return res.status(200).json({ artifact: pruneUndefined(updated) });
  } catch (err) {
    if (err instanceof CustodyValidationError) {
      return res.status(409).json({ error: 'custody_invalid', code: err.code });
    }
    logger.error?.('custody.replace.error', err);
    captureRouteError(err, 'custody.replace', { callerUid, tenantId: g.tenantId, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST access (read-access trail) ──────────────────────────────────
router.post('/:projectId/evidence/:hash/access', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, hash } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = accessSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  try {
    const adapter = adapterFor(g.tenantId);
    const artifact = await adapter.getArtifact(hash);
    if (!artifact) return res.status(404).json({ error: 'artifact_not_found' });
    const event = recordAccess(artifact, callerUid, callerRole(req), {
      ip: req.ip ?? undefined,
      userAgent: req.header('user-agent') ?? undefined,
    });
    const enriched: CustodyEvent = parsed.data.notes
      ? { ...event, notes: parsed.data.notes }
      : event;
    await adapter.appendEvent(pruneUndefined(enriched));
    try {
      await auditServerEvent(
        req,
        'custody.access',
        'evidenceChain',
        { artifactHash: hash },
        { projectId },
      );
    } catch (auditErr) {
      logger.error('audit_event_failed', { action: 'custody.access', err: String(auditErr) });
      captureRouteError(auditErr, 'custody.access.audit', { callerUid, tenantId: g.tenantId, projectId });
    }
    return res.status(200).json({ recorded: true });
  } catch (err) {
    logger.error?.('custody.access.error', err);
    captureRouteError(err, 'custody.access', { callerUid, tenantId: g.tenantId, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST export (export trail) ───────────────────────────────────────
router.post('/:projectId/evidence/:hash/export', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, hash } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  try {
    const adapter = adapterFor(g.tenantId);
    const artifact = await adapter.getArtifact(hash);
    if (!artifact) return res.status(404).json({ error: 'artifact_not_found' });
    const event = recordExport(artifact, callerUid, callerRole(req), parsed.data.exportTarget);
    await adapter.appendEvent(event);
    try {
      await auditServerEvent(
        req,
        'custody.export',
        'evidenceChain',
        { artifactHash: hash, exportTarget: parsed.data.exportTarget },
        { projectId },
      );
    } catch (auditErr) {
      logger.error('audit_event_failed', { action: 'custody.export', err: String(auditErr) });
      captureRouteError(auditErr, 'custody.export.audit', { callerUid, tenantId: g.tenantId, projectId });
    }
    return res.status(200).json({ recorded: true });
  } catch (err) {
    logger.error?.('custody.export.error', err);
    captureRouteError(err, 'custody.export', { callerUid, tenantId: g.tenantId, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
