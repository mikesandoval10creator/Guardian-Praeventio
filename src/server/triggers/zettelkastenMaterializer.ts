// Praeventio Guard — Sprint 39 Fase D.8.c follow-up: materializer trigger.
//
// The canonical materializer is a pure mapper. This module is the I/O boundary:
// it observes both tenant-scoped and top-level legacy ZK sources, normalizes
// their historical document shapes, validates tenant/project identity, and
// writes the canonical `nodes/{tenant}_{project}_{zkId}` document.
//
// No work happens at import time. `setupMaterializerListener` is called by the
// productive server boot and returns a lifecycle handle for SIGTERM cleanup.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import {
  materializeNode,
  canonicalNodePath,
  type MaterializeInput,
  type CanonicalNode,
} from '../../services/zettelkasten/canonical/materializer.js';
import type {
  RiskNodePayload,
  RiskNodeSeverity,
  RiskNodeType,
} from '../../services/zettelkasten/types.js';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Historical Firestore shapes accepted at the source boundary.
 *
 * Newer writers use `{ payload, projectId }`; incidentPostmortem and older
 * wisdom/server writers use flat fields. Keeping this type permissive here
 * makes the normalizer the single enforcement point instead of spreading
 * `as` casts through every writer.
 */
export interface ZkNodeFirestoreDoc {
  payload?: unknown;
  tenantId?: unknown;
  projectId?: unknown;
  title?: unknown;
  description?: unknown;
  type?: unknown;
  severity?: unknown;
  metadata?: unknown;
  connections?: unknown;
  references?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
}

/** Snapshot doc shape — minimal abstraction over admin.DocumentSnapshot. */
export interface MinimalDocSnapshot {
  id: string;
  exists: boolean;
  data(): ZkNodeFirestoreDoc | undefined;
  ref: { path: string };
}

/** Minimal Firestore for canonical writes — abstraction over admin SDK. */
export interface MaterializerFirestore {
  doc(path: string): {
    set(data: CanonicalNode, opts?: { merge?: boolean }): Promise<unknown>;
  };
}

export interface MaterializeOneInput {
  tenantId: string;
  zkNodeId: string;
  payload: RiskNodePayload;
  projectId: string;
  createdAt?: string;
  updatedAt?: string;
  now?: Date;
}

export interface MaterializeOneResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface NormalizedZkNodeDocument {
  payload: RiskNodePayload;
  projectId: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type NormalizeZkNodeResult =
  | { ok: true; value: NormalizedZkNodeDocument }
  | { ok: false; error: string };

export type ResolveProjectTenant = (
  projectId: string,
) => Promise<string | null | undefined>;

// ────────────────────────────────────────────────────────────────────────
// Source-boundary normalization
// ────────────────────────────────────────────────────────────────────────

const VALID_SEVERITIES = new Set<RiskNodeSeverity>([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

const LEGACY_TYPE_ALIASES: Record<string, RiskNodeType> = {
  incident_postmortem: 'incident-reported',
};

const VALID_SOURCE_TYPES = new Set<RiskNodeType>([
  'hidrante-pressure',
  'misting-suppression',
  'scaffold-uplift',
  'confined-space-vent',
  'gas-leak-anomaly',
  'mining-extraction',
  'hazmat-pipe',
  'structural-wind',
  'respirator-fatigue',
  'pulmonary-altitude',
  'micro-wind-energy',
  'slope-stability',
  'slam-mesh',
  'dike-hydrostatic',
  'gas-dispersion',
  'safety-learning',
  'epp_inspection',
  'horometro-reading',
  'maintenance-threshold-reached',
  'maintenance-task-created',
  'maintenance-task-completed',
  'incident-reported',
  'investigation-opened',
  'root-cause-identified',
  'lesson-published',
  'microtraining-assigned',
  'microtraining-completed',
  'incident-investigation-closed',
]);


function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value: unknown): value is number | string | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return value;
}

function readStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    return { ok: false, error: `invalid ${field}` };
  }
  return { ok: true, value: [...value] };
}

function readMetadata(
  value: unknown,
): { ok: true; value: Record<string, number | string | boolean | null> } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} };
  if (!isRecord(value)) return { ok: false, error: 'invalid metadata' };

  const metadata: Record<string, number | string | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (!isScalar(item)) return { ok: false, error: `invalid metadata.${key}` };
    metadata[key] = item;
  }
  return { ok: true, value: metadata };
}

function timestampToIso(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (isRecord(value) && typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Normalize the two source contracts currently present in Firestore:
 * nested `{ payload }` docs and flat legacy/postmortem/wisdom docs.
 * Invalid or ambiguous data is rejected before any canonical write.
 */
export function normalizeZkNodeFirestoreDoc(data: unknown): NormalizeZkNodeResult {
  if (!isRecord(data)) return { ok: false, error: 'document is not an object' };

  const hasPayload = Object.prototype.hasOwnProperty.call(data, 'payload');
  if (hasPayload && !isRecord(data.payload)) {
    return { ok: false, error: 'invalid payload envelope' };
  }

  const source = hasPayload ? data.payload as Record<string, unknown> : data;
  const rawMetadata = source.metadata ?? data.metadata;
  const metadataResult = readMetadata(rawMetadata);
  if (!metadataResult.ok) return metadataResult;
  const metadata = metadataResult.value;

  const projectCandidate = data.projectId ?? source.projectId ?? metadata.projectId;
  const projectId = readRequiredString(projectCandidate);
  if (!projectId) return { ok: false, error: 'missing projectId' };

  const tenantCandidate = data.tenantId;
  if (tenantCandidate !== undefined && readRequiredString(tenantCandidate) === null) {
    return { ok: false, error: 'invalid tenantId' };
  }

  const titleCandidate = source.title ?? data.title;
  const title = readRequiredString(titleCandidate);
  if (!title) return { ok: false, error: 'invalid title' };

  const descriptionCandidate =
    source.description ?? data.description ?? metadata.rootCausePreview ?? title;
  const description = readRequiredString(descriptionCandidate);
  if (!description) return { ok: false, error: 'invalid description' };

  const rawType = source.type ?? data.type;
  const typeString = readRequiredString(rawType);
  if (!typeString) return { ok: false, error: 'invalid type' };
  const type = LEGACY_TYPE_ALIASES[typeString] ?? (typeString as RiskNodeType);
  if (!VALID_SOURCE_TYPES.has(type)) return { ok: false, error: 'unsupported type' };


  const rawSeverity = source.severity ?? data.severity ?? metadata.severity ?? 'info';
  if (typeof rawSeverity !== 'string' || !VALID_SEVERITIES.has(rawSeverity as RiskNodeSeverity)) {
    return { ok: false, error: 'invalid severity' };
  }
  const severity = rawSeverity as RiskNodeSeverity;

  const connectionsResult = readStringArray(
    source.connections ?? data.connections,
    'connections',
  );
  if (!connectionsResult.ok) return connectionsResult;

  const referencesResult = readStringArray(
    source.references ?? data.references,
    'references',
  );
  if (!referencesResult.ok) return referencesResult;

  const payload: RiskNodePayload = {
    title,
    description,
    type,
    severity,
    metadata,
    connections: connectionsResult.value,
    references: referencesResult.value,
  };

  return {
    ok: true,
    value: {
      payload,
      projectId,
      tenantId: typeof tenantCandidate === 'string' ? tenantCandidate : undefined,
      createdAt: timestampToIso(source.createdAt ?? data.createdAt),
      updatedAt: timestampToIso(source.updatedAt ?? data.updatedAt),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Handler — pure I/O dispatch
// ────────────────────────────────────────────────────────────────────────

/**
 * Materialize a single normalized document and write the canonical path.
 * Repeated calls with the same identity are idempotent because the target
 * path is deterministic and the write uses merge semantics.
 */
export async function materializeOne(
  firestore: MaterializerFirestore,
  input: MaterializeOneInput,
): Promise<MaterializeOneResult> {
  if (typeof input.tenantId !== 'string' || input.tenantId.length === 0) {
    return { ok: false, error: 'missing tenantId' };
  }
  if (typeof input.projectId !== 'string' || input.projectId.length === 0) {
    return { ok: false, error: 'missing projectId' };
  }
  if (!input.payload || typeof input.payload.title !== 'string') {
    return { ok: false, error: 'invalid payload' };
  }

  const matInput: MaterializeInput = {
    zkNodeId: input.zkNodeId,
    payload: input.payload,
    projectId: input.projectId,
    tenantId: input.tenantId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    extraTags: ['materializer-trigger'],
    now: input.now,
  };

  const node = materializeNode(matInput);
  const path = canonicalNodePath({
    tenantId: input.tenantId,
    projectId: input.projectId,
    zkNodeId: input.zkNodeId,
  });

  try {
    await firestore.doc(path).set(node, { merge: true });
    return { ok: true, path };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Process a Firestore snapshot from either:
 *   tenants/{tenantId}/zettelkasten_nodes/{zkId}
 *   zettelkasten_nodes/{zkId}
 *
 * Tenant-scoped paths provide the tenant from the path. Top-level legacy docs
 * must provide it in the document or through the project resolver. When a
 * resolver is supplied, it is authoritative and detects project/tenant drift.
 */
export async function processSnapshotDoc(
  firestore: MaterializerFirestore,
  snap: MinimalDocSnapshot,
  now: Date = new Date(),
  resolveProjectTenant?: ResolveProjectTenant,
): Promise<MaterializeOneResult | null> {
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;

  const normalized = normalizeZkNodeFirestoreDoc(data);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const pathParts = snap.ref.path.split('/');
  const tenantScoped =
    pathParts.length === 4 &&
    pathParts[0] === 'tenants' &&
    pathParts[2] === 'zettelkasten_nodes';
  const topLevel = pathParts.length === 2 && pathParts[0] === 'zettelkasten_nodes';
  if (!tenantScoped && !topLevel) {
    logger.warn?.('materializer.unexpected_path', { path: snap.ref.path });
    return null;
  }

  const pathTenantId = tenantScoped ? pathParts[1] : undefined;
  const documentTenantId = normalized.value.tenantId;
  if (pathTenantId && documentTenantId && pathTenantId !== documentTenantId) {
    return { ok: false, error: 'tenantId mismatch' };
  }

  let tenantId = pathTenantId ?? documentTenantId;
  if (resolveProjectTenant) {
    try {
      const resolvedTenantId = await resolveProjectTenant(normalized.value.projectId);
      if (!resolvedTenantId) return { ok: false, error: 'project tenant unresolved' };
      if (tenantId && tenantId !== resolvedTenantId) {
        return { ok: false, error: 'project/tenant mismatch' };
      }
      tenantId = resolvedTenantId;
    } catch (err) {
      return {
        ok: false,
        error: `project tenant resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!tenantId) return { ok: false, error: 'missing tenantId' };

  return materializeOne(firestore, {
    tenantId,
    zkNodeId: snap.id,
    payload: normalized.value.payload,
    projectId: normalized.value.projectId,
    createdAt: normalized.value.createdAt,
    updatedAt: normalized.value.updatedAt,
    now,
  });
}

// ────────────────────────────────────────────────────────────────────────
// onSnapshot setup
// ────────────────────────────────────────────────────────────────────────

export interface MaterializerListenerDeps {
  db: admin.firestore.Firestore;
  /** Optional single-tenant filter for isolated maintenance/testing. */
  tenantId?: string;
  /** Required by productive boot to verify project → tenant ownership. */
  resolveProjectTenant?: ResolveProjectTenant;
  /** Initial retry delay for transient canonical-write failures. */
  retryDelayMs?: number;
  /** Maximum number of retries after the initial attempt. */
  maxRetryAttempts?: number;
}

export interface MaterializerListenerHandle {
  unsubscribe: () => void;
}

interface SnapshotChange {
  type: string;
  doc: {
    id: string;
    exists: boolean;
    data(): unknown;
    ref: { path: string };
  };
}

interface SnapshotLike {
  docChanges(): SnapshotChange[];
}

interface ListenerSource {
  onSnapshot(
    onNext: (snapshot: SnapshotLike) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

/**
 * Wire all source collections. With no `tenantId`, one collection-group
 * listener handles tenant-scoped writers and one top-level listener handles
 * legacy wisdom/server writers. Both converge on the same canonical `nodes`
 * path and share the same tenant resolver.
 */
export function setupMaterializerListener(
  deps: MaterializerListenerDeps,
): MaterializerListenerHandle {
  const sources: Array<{ name: string; ref: ListenerSource }> = [];

  if (deps.tenantId) {
    const ref = deps.db
      .collection('tenants')
      .doc(deps.tenantId)
      .collection('zettelkasten_nodes') as unknown as ListenerSource;
    sources.push({ name: `tenant:${deps.tenantId}`, ref });
  } else {
    sources.push({
      name: 'tenant-scoped-group',
      ref: deps.db.collectionGroup('zettelkasten_nodes') as unknown as ListenerSource,
    });
    sources.push({
      name: 'top-level-legacy',
      ref: deps.db.collection('zettelkasten_nodes') as unknown as ListenerSource,
    });
  }

  const wrapper: MaterializerFirestore = {
    doc(path: string) {
      return {
        async set(data: CanonicalNode, opts?: { merge?: boolean }): Promise<unknown> {
          return deps.db.doc(path).set(data as any, opts ?? {});
        },
      };
    },
  };

  const unsubs: Array<() => void> = [];
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const retryAttempts = new Map<string, number>();
  const retryDelayMs = Math.max(1, deps.retryDelayMs ?? 250);
  const maxRetryAttempts = Math.max(0, Math.floor(deps.maxRetryAttempts ?? 3));

  const isRetryableError = (error: string | undefined): boolean => {
    if (!error) return false;
    return !/^(document is not|invalid |missing |tenantId mismatch|project\/tenant mismatch|project tenant unresolved)/i.test(error);
  };

  const scheduleRetry = (
    sourceName: string,
    snap: MinimalDocSnapshot,
    attempt: number,
  ): void => {
    const key = `${sourceName}:${snap.ref.path}`;
    if (attempt > maxRetryAttempts || retryTimers.has(key)) return;
    const delay = Math.min(retryDelayMs * 2 ** Math.max(0, attempt - 1), 30_000);
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      void processOne(sourceName, snap, attempt).catch((error) => {
        logger.error?.('materializer.retry_failed', { source: sourceName, id: snap.id, error });
      });
    }, delay);
    timer.unref?.();
    retryTimers.set(key, timer);
  };

  async function processOne(
    sourceName: string,
    snap: MinimalDocSnapshot,
    attempt: number,
  ): Promise<void> {
    const key = `${sourceName}:${snap.ref.path}`;
    try {
      const result = await processSnapshotDoc(
        wrapper,
        snap,
        new Date(),
        deps.resolveProjectTenant,
      );
      if (!result) return;
      if (result.ok) {
        const pendingTimer = retryTimers.get(key);
        if (pendingTimer) clearTimeout(pendingTimer);
        retryTimers.delete(key);
        retryAttempts.delete(key);
        return;
      }
      logger.warn?.('materializer.process_failed', {
        source: sourceName,
        id: snap.id,
        err: result.error,
        attempt,
      });
      if (isRetryableError(result.error) && attempt < maxRetryAttempts) {
        retryAttempts.set(key, attempt + 1);
        scheduleRetry(sourceName, snap, attempt + 1);
      }
    } catch (error) {
      logger.error?.('materializer.exception', { source: sourceName, id: snap.id, error, attempt });
      if (attempt < maxRetryAttempts) {
        retryAttempts.set(key, attempt + 1);
        scheduleRetry(sourceName, snap, attempt + 1);
      }
    }
  }

  const consume = async (sourceName: string, snapshot: SnapshotLike): Promise<void> => {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed') continue;
      const snap: MinimalDocSnapshot = {
        id: change.doc.id,
        exists: change.doc.exists,
        data: () => change.doc.data() as ZkNodeFirestoreDoc | undefined,
        ref: { path: change.doc.ref.path },
      };
      await processOne(sourceName, snap, retryAttempts.get(`${sourceName}:${snap.ref.path}`) ?? 0);
    }
  };

  for (const source of sources) {
    try {
      const unsubscribe = source.ref.onSnapshot(
        (snapshot) => {
          void consume(source.name, snapshot).catch((error) => {
            logger.error?.('materializer.snapshot_consume_failed', {
              source: source.name,
              error,
            });
          });
        },
        (error) => {
          logger.error?.('materializer.listener_error', { source: source.name, error });
        },
      );
      unsubs.push(unsubscribe);
    } catch (error) {
      logger.error?.('materializer.listener_setup_failed', { source: source.name, error });
    }
  }

  let closed = false;
  return {
    unsubscribe: () => {
      if (closed) return;
      closed = true;
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      retryAttempts.clear();
      for (const unsubscribe of unsubs) {
        try {
          unsubscribe();
        } catch (error) {
          logger.warn?.('materializer.unsubscribe_failed', { error });
        }
      }
    },
  };
}
