// Praeventio Guard — Sprint 39 Fase D.8.c follow-up: materializer trigger.
//
// Listener Firestore que escucha onSnapshot sobre
// /tenants/{tid}/zettelkasten_nodes/* y materializa cada doc en la
// colección canónica `nodes/{tid}_{pid}_{zkId}` usando el pure core
// de `src/services/zettelkasten/canonical/materializer.ts`.
//
// Diseño:
//   - Pure core (materializer.ts) hace TODA la transformación
//     determinística.
//   - Este módulo es el shim de I/O — onSnapshot + writeBatch + retry.
//   - Tests con FakeFirestore (no emulator) — el handler es exportable
//     y testeable directamente.
//
// IMPORTANT: este módulo no se importa en server.ts hasta que el
// usuario active el feature flag MATERIALIZER_ENABLED=true. Ship
// behind flag para no perturbar el comportamiento actual.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import {
  materializeNode,
  canonicalNodePath,
  type MaterializeInput,
  type CanonicalNode,
} from '../../services/zettelkasten/canonical/materializer.js';
import type { RiskNodePayload } from '../../services/zettelkasten/types.js';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/** Shape del doc en /tenants/{tid}/zettelkasten_nodes/{zkId}. */
export interface ZkNodeFirestoreDoc {
  payload: RiskNodePayload;
  projectId: string;
  /** Server timestamp ISO. */
  createdAt?: string;
  /** Server timestamp ISO. */
  updatedAt?: string;
}

/** Snapshot doc shape — abstracción minimal sobre admin.DocumentSnapshot. */
export interface MinimalDocSnapshot {
  id: string;
  exists: boolean;
  data(): ZkNodeFirestoreDoc | undefined;
  ref: { path: string };
}

/** Minimal Firestore para write — abstracción sobre admin SDK. */
export interface MaterializerFirestore {
  doc(path: string): {
    set(data: CanonicalNode, opts?: { merge?: boolean }): Promise<unknown>;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Handler — pure I/O dispatch
// ────────────────────────────────────────────────────────────────────────

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

/**
 * Materializa un único doc y lo escribe al canonical path. Idempotente:
 * llamadas repetidas con mismos inputs escriben el mismo doc.
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
 * Procesa un snapshot doc del onSnapshot listener. Devuelve resultado
 * o null si el doc no aplica (deleted / no tenant in path).
 *
 * Path expected: tenants/{tid}/zettelkasten_nodes/{zkId}
 */
export async function processSnapshotDoc(
  firestore: MaterializerFirestore,
  snap: MinimalDocSnapshot,
  now: Date = new Date(),
): Promise<MaterializeOneResult | null> {
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;

  // Extract tenantId from path: tenants/{tid}/zettelkasten_nodes/{zkId}
  const pathParts = snap.ref.path.split('/');
  if (pathParts.length < 4 || pathParts[0] !== 'tenants' || pathParts[2] !== 'zettelkasten_nodes') {
    logger.warn?.('materializer.unexpected_path', { path: snap.ref.path });
    return null;
  }
  const tenantId = pathParts[1];

  return materializeOne(firestore, {
    tenantId,
    zkNodeId: snap.id,
    payload: data.payload,
    projectId: data.projectId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    now,
  });
}

// ────────────────────────────────────────────────────────────────────────
// onSnapshot setup
// ────────────────────────────────────────────────────────────────────────

export interface MaterializerListenerDeps {
  db: admin.firestore.Firestore;
  /** Tenant filter — listener escucha solo este tenant a la vez. */
  tenantId: string;
}

export interface MaterializerListenerHandle {
  unsubscribe: () => void;
}

/**
 * Suscribe un listener sobre /tenants/{tid}/zettelkasten_nodes y materializa
 * cada cambio. Cada call crea un nuevo listener — usar con cuidado.
 *
 * Devuelve handle.unsubscribe() para shutdown limpio.
 */
export function setupMaterializerListener(
  deps: MaterializerListenerDeps,
): MaterializerListenerHandle {
  const collectionRef = deps.db
    .collection('tenants')
    .doc(deps.tenantId)
    .collection('zettelkasten_nodes');

  const wrapper: MaterializerFirestore = {
    doc(path: string) {
      return {
        async set(data: CanonicalNode, opts?: { merge?: boolean }): Promise<unknown> {
          return deps.db.doc(path).set(data as any, opts ?? {});
        },
      };
    },
  };

  const unsubscribe = collectionRef.onSnapshot(
    async (qs) => {
      for (const change of qs.docChanges()) {
        if (change.type === 'removed') continue;
        // Adapter de admin.DocumentSnapshot → MinimalDocSnapshot:
        const snap: MinimalDocSnapshot = {
          id: change.doc.id,
          exists: change.doc.exists,
          data: () => change.doc.data() as ZkNodeFirestoreDoc | undefined,
          ref: { path: change.doc.ref.path },
        };
        try {
          const r = await processSnapshotDoc(wrapper, snap);
          if (r && !r.ok) {
            logger.warn?.('materializer.process_failed', { id: snap.id, err: r.error });
          }
        } catch (e) {
          logger.error?.('materializer.exception', e);
        }
      }
    },
    (err) => {
      logger.error?.('materializer.listener_error', err);
    },
  );

  return { unsubscribe };
}
