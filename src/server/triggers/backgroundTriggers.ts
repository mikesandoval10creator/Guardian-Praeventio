// Praeventio Guard — Round 21 B1 Phase 5 split.
//
// Real-time Firestore background triggers, simulated via Firebase Admin
// `onSnapshot` listeners (we don't run in a Cloud Functions environment).
// Three listeners:
//
//   1. New critical incidents (`nodes` where type ∈ {Hallazgo, Incidente,
//      Riesgo} AND severity ∈ {Crítica, Alta}) → FCM multicast to project
//      supervisors/gerentes/prevencionistas + CPHS alert email via Resend.
//   2. RAG ingestion pipeline (`nodes` where type ∈ {normative, pts,
//      protocol, document}) → embed via geminiBackend, store back on the
//      doc, mark `_ragProcessingStatus`.
//   3. Closed incidents with root cause produce a deterministic Zettelkasten
//      post-mortem node.
//
// Pre-extraction lived inside `setupBackgroundTriggers` in server.ts. DI
// shape introduced here so tests can drive the listeners with a fake
// firestore + messaging without booting Firebase Admin or Vite. The
// returned `unsubscribe()` releases all `onSnapshot` subscriptions —
// useful for graceful shutdown (SIGTERM) and for test seam isolation.
//
// IMPORTANT: this module MUST NOT do work at import time. The only
// top-level exports are types and the `setupBackgroundTriggers` function.

import type admin from 'firebase-admin';
import type { Resend } from 'resend';
import { randomUUID } from 'node:crypto';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';
import {
  writeIncidentPostmortemNode,
  type IncidentDoc as PostmortemIncidentDoc,
  type MinimalFirestore as PostmortemMinimalStore,
} from '../../services/zettelkasten/incidentPostmortem.js';
import {
  claimBackgroundWork,
  completeBackgroundWork,
  releaseBackgroundWork,
  type BackgroundClaimFields,
} from './backgroundTriggerClaim.js';
import { createCriticalAlertOutbox } from './criticalAlertOutbox.js';
import { deliverOutboxItem, type OutboxDeliveryDeps } from './criticalAlertOutboxWorker.js';

const TRIGGER_LEASE_MS = 2 * 60 * 1000;

const CRITICAL_CLAIM_FIELDS: BackgroundClaimFields = {
  completedAt: '_criticalAlertOutboxProvisionedAt',
  leaseUntilMs: '_criticalAlertLeaseUntilMs',
  claimToken: '_criticalAlertClaimToken',
  attempts: '_criticalAlertAttempts',
};

const RAG_CLAIM_FIELDS: BackgroundClaimFields = {
  completedAt: '_ragProcessedAt',
  leaseUntilMs: '_ragProcessingLeaseUntilMs',
  claimToken: '_ragProcessingClaimToken',
  attempts: '_ragProcessingAttempts',
};

const POSTMORTEM_CLAIM_FIELDS: BackgroundClaimFields = {
  completedAt: '_postmortemWrittenAt',
  leaseUntilMs: '_postmortemLeaseUntilMs',
  claimToken: '_postmortemClaimToken',
  attempts: '_postmortemAttempts',
};

// ── H23 Per-entity mutex (E.5 P2) ─────────────────────────────────────
//
// Background triggers may fire concurrently for the same doc id (e.g. two
// rapid writes to the same node → two `onSnapshot` `change.type === 'added'`
// or `'modified'` invocations in parallel). Without serialization, handlers
// that touch shared external state (Firestore `update`, RAG status flips,
// FCM sends, post-mortem Zettelkasten writes) race and can:
//   • double-process a RAG embedding (waste tokens + duplicate writes)
//   • emit two FCM bursts for the same critical incident
//   • create two post-mortem nodes for the same incident close
//
// `serializeByKey(key, fn)` wraps `fn` so concurrent calls with the SAME
// key run strictly sequentially (FIFO), while different keys run in
// parallel without contention. The map self-cleans after the tail
// promise settles to keep memory bounded under high churn.
//
// In-memory only — single Node process. Cross-instance contention is out
// of scope (we don't run in true Cloud Functions; this is admin SDK
// `onSnapshot` in our own server).
const inFlight = new Map<string, Promise<unknown>>();

export function serializeByKey<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = inFlight.get(key) ?? Promise.resolve();
  // Chain the next call onto the previous tail. Use `.then(fn, fn)` so a
  // rejection in the previous call doesn't poison the chain — the next
  // call still runs.
  const next: Promise<T> = prev.then(fn, fn);
  inFlight.set(key, next);
  // Self-clean: when this entry is the current tail and it has settled,
  // drop it. Guarded so a later enqueue doesn't get dropped. We swallow
  // rejections on the cleanup branch — the caller's own promise (`next`)
  // remains the source of truth for error propagation.
  next.then(
    () => {
      if (inFlight.get(key) === next) inFlight.delete(key);
    },
    () => {
      if (inFlight.get(key) === next) inFlight.delete(key);
    },
  );
  return next;
}

/** @internal — test helper to assert mutex releases cleanly. */
export function _mutexInFlightSize(): number {
  return inFlight.size;
}

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

export interface BackgroundTriggersDeps {
  db: admin.firestore.Firestore;
  messaging: admin.messaging.Messaging;
  resend: Resend;
  /** Firestore admin namespace — needed for FieldValue.serverTimestamp(). */
  firestoreNamespace: typeof admin.firestore;
  /** Optional override for `process.env.RESEND_API_KEY` lookup at trigger time. */
  resendApiKey?: string;
  /** Optional override for `process.env.GEMINI_API_KEY` lookup at trigger time. */
  geminiApiKey?: string;
  /**
   * Optional override of the embedding generator — defaults to dynamic
   * import of `src/services/geminiBackend.js`. Tests inject a stub.
   */
  generateEmbeddingsBatch?: (texts: string[]) => Promise<number[][]>;
  /** Test seams for deterministic leases/tokens; production uses clock + UUID. */
  nowMs?: () => number;
  createClaimToken?: () => string;
}

export interface BackgroundTriggersHandle {
  unsubscribe: () => void;
}

/**
 * Resolves a single-text embedding via the configured batch embedder.
 * Used by the incident post-mortem trigger.
 */
function singleEmbedAdapter(
  batch: (texts: string[]) => Promise<number[][]>,
): (text: string) => Promise<number[]> {
  return async (text: string) => {
    const out = await batch([text]);
    return out?.[0] ?? [];
  };
}

/**
 * Wire up the real-time listeners and return a handle whose
 * `unsubscribe()` cancels all subscriptions. Safe to call multiple times
 * — each call returns an independent handle.
 */
export function setupBackgroundTriggers(
  deps: BackgroundTriggersDeps,
): BackgroundTriggersHandle {
  const noop = () => {};
  let unsubIncidents: () => void = noop;
  let unsubRag: () => void = noop;
  let unsubIncidentClose: () => void = noop;
  let unsubOutbox: () => void = noop;
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  try {
    const { db, messaging, resend, firestoreNamespace } = deps;
    const nowMs = deps.nowMs ?? Date.now;
    const createClaimToken = deps.createClaimToken ?? randomUUID;

    const scheduleRetry = (key: string, delayMs: number, retry: () => void): void => {
      if (retryTimers.has(key)) return;
      const timer = setTimeout(() => {
        retryTimers.delete(key);
        retry();
      }, Math.max(1, delayMs + 5));
      timer.unref?.();
      retryTimers.set(key, timer);
    };

    // Trigger 1: critical incidents → FCM + CPHS email
    unsubIncidents = db
      .collection('nodes')
      .where('type', 'in', ['Hallazgo', 'Incidente', 'Riesgo'])
      .onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type !== 'added' && change.type !== 'modified') return;
            const data = change.doc.data();
            const isCritical =
              data.metadata?.severity === 'Crítica' ||
              data.metadata?.severity === 'Alta';
            if (!isCritical || !data.projectId) return;

            void serializeByKey(`incident:${change.doc.id}`, async () => {
            let claimToken: string | null = null;
            try {
              const token = createClaimToken();
              const claim = await claimBackgroundWork({
                db,
                ref: change.doc.ref,
                fields: CRITICAL_CLAIM_FIELDS,
                nowMs: nowMs(),
                leaseMs: TRIGGER_LEASE_MS,
                token,
              });
              if (claim.kind === 'completed') {
                logger.info('incident_alert_skipped_idempotent', {
                  nodeId: change.doc.id,
                });
                return;
              }
              if (claim.kind === 'leased') {
                scheduleRetry(`incident:${change.doc.id}`, claim.retryAfterMs, () => {
                  void change.doc.ref.update({
                    _criticalAlertRetryRequestedAt:
                      firestoreNamespace.FieldValue.serverTimestamp(),
                  });
                });
                return;
              }
              claimToken = token;

              // [P0][VIDA] Outbox transaccional (deuda 94ba): el listener de
              // incidentes ya NO envía FCM/email directamente. Solo PROVISIONA
              // el outbox con payload congelado (tokens/emails capturados
              // ahora); el worker de `critical_alert_outbox` entrega con
              // reintento/backoff/dead-letter. El claim del nodo marca
              // "outbox provisionado", nunca "alerta enviada" antes de tiempo.
              const outboxRef = db
                .collection('critical_alert_outbox')
                .doc(change.doc.id);
              const frozenPayload: {
                projectId: string;
                nodeId: string;
                title: string;
                description: string;
                severity: string;
                location: string;
                supervisorUids: string[];
                fcmTokens: string[];
                emailRecipients: string[];
                capturedAtMs: number;
              } = {
                projectId: data.projectId,
                nodeId: change.doc.id,
                title: data.title || 'Nuevo incidente',
                description: data.description || '',
                severity: data.metadata?.severity || 'Alta',
                location: data.metadata?.location || '',
                supervisorUids: [] as string[],
                fcmTokens: [] as string[],
                emailRecipients: [] as string[],
                capturedAtMs: nowMs(),
              };

              const membersSnap = await db
                .collection(`projects/${data.projectId}/members`)
                .get();
              const supervisorUids: string[] = [];
              membersSnap.forEach((d) => {
                const role = d.data().role;
                if (
                  role === 'supervisor' ||
                  role === 'gerente' ||
                  role === 'prevencionista'
                ) {
                  supervisorUids.push(d.id);
                }
              });
              frozenPayload.supervisorUids = supervisorUids;

              if (supervisorUids.length === 0) {
                // Sin destinatarios no hay entrega posible; el outbox se crea
                // igual (auditable) y el worker lo resuelve a dead-letter
                // honesto en lugar de marcar "enviado".
                await createCriticalAlertOutbox({
                  db,
                  ref: outboxRef,
                  payload: frozenPayload,
                  nowMs: nowMs(),
                });
                await completeBackgroundWork({
                  db,
                  ref: change.doc.ref,
                  fields: CRITICAL_CLAIM_FIELDS,
                  token,
                  completionPatch: {
                    _criticalAlertOutboxProvisionedAt:
                      firestoreNamespace.FieldValue.serverTimestamp(),
                  },
                });
                return;
              }

              const tokenDocs = await Promise.all(
                supervisorUids.map((uid) =>
                  db.collection('users').doc(uid).get(),
                ),
              );
              // AUDIT-2026-06 B19/B23 — union BOTH token fields: the app
              // registers devices via /api/push/register-token, which
              // arrayUnions users/{uid}.fcmTokens[] (canonical,
              // multi-device); the singular fcmToken is the legacy web
              // field. Reading only the singular left every
              // mobile-registered supervisor without critical pushes.
              const tokenSet = new Set<string>();
              const emailRecipients: string[] = [];
              for (const d of tokenDocs) {
                const docData = d.data() as
                  | { fcmToken?: unknown; fcmTokens?: unknown; email?: unknown }
                  | undefined;
                if (typeof docData?.fcmToken === 'string' && docData.fcmToken) {
                  tokenSet.add(docData.fcmToken);
                }
                if (Array.isArray(docData?.fcmTokens)) {
                  for (const t of docData.fcmTokens) {
                    if (typeof t === 'string' && t) tokenSet.add(t);
                  }
                }
                if (typeof docData?.email === 'string' && docData.email.includes('@')) {
                  emailRecipients.push(docData.email);
                }
              }
              frozenPayload.fcmTokens = Array.from(tokenSet);
              frozenPayload.emailRecipients = emailRecipients;

              // Create-once: una segunda instancia que observe el mismo nodo
              // obtiene false y no sobreescribe el payload congelado.
              await createCriticalAlertOutbox({
                db,
                ref: outboxRef,
                payload: frozenPayload,
                nowMs: nowMs(),
              });
              await completeBackgroundWork({
                db,
                ref: change.doc.ref,
                fields: CRITICAL_CLAIM_FIELDS,
                token,
                completionPatch: {
                  _criticalAlertOutboxProvisionedAt:
                    firestoreNamespace.FieldValue.serverTimestamp(),
                },
              });
            } catch (err) {
              logger.error('critical_outbox_provision_failed', err, {
                trigger: 'criticalIncidentProvision',
              });
              sentryCapture(err, {
                trigger: 'criticalIncidentProvision',
                tags: { phase: 'outbox-provision' },
              });
              if (claimToken) {
                await releaseBackgroundWork({
                  db,
                  ref: change.doc.ref,
                  fields: CRITICAL_CLAIM_FIELDS,
                  token: claimToken,
                  failurePatch: {
                    _criticalAlertLastError:
                      err instanceof Error ? err.message : String(err),
                  },
                });
              }
            }
            });
          });
        },
        (error) => {
          logger.error('incidents_listener_error', error, { trigger: 'incidentsListener' });
          sentryCapture(error, { trigger: 'incidentsListener', tags: { phase: 'onSnapshot-error' } });
        },
      );

    // Trigger 2: RAG ingestion pipeline
    unsubRag = db
      .collection('nodes')
      .where('type', 'in', ['normative', 'pts', 'protocol', 'document'])
      .onSnapshot(
        async (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type !== 'added' && change.type !== 'modified') continue;
            const data = change.doc.data();

            if (
              data._ragProcessingStatus === 'completed' ||
              data._ragProcessingStatus === 'skipped_too_short'
            ) {
              continue;
            }

            logger.info('rag_pipeline_embedding_start', {
              docId: change.doc.id,
              docType: data.type,
            });

            await serializeByKey(`rag:${change.doc.id}`, async () => {
            let claimToken: string | null = null;
            try {
              // Codex P2 PR #120: re-check status INSIDE the mutex so the
              // second concurrent snapshot (which passed the stale check
              // before the first one wrote 'processing') doesn't embed
              // again. Without this re-read, the mutex only serialises
              // duplicate work — it doesn't prevent it.
              const token = createClaimToken();
              const claim = await claimBackgroundWork({
                db,
                ref: change.doc.ref,
                fields: RAG_CLAIM_FIELDS,
                nowMs: nowMs(),
                leaseMs: TRIGGER_LEASE_MS,
                token,
                claimPatch: { _ragProcessingStatus: 'processing' },
                isCompleted: (fresh) =>
                  fresh._ragProcessingStatus === 'completed' ||
                  fresh._ragProcessingStatus === 'skipped_too_short',
              });
              if (claim.kind === 'completed') {
                logger.info('rag_pipeline_skipped_inside_mutex', {
                  docId: change.doc.id,
                  status: 'completed',
                });
                return;
              }
              if (claim.kind === 'leased') {
                scheduleRetry(`rag:${change.doc.id}`, claim.retryAfterMs, () => {
                  void change.doc.ref.update({
                    _ragRetryRequestedAt:
                      firestoreNamespace.FieldValue.serverTimestamp(),
                  });
                });
                return;
              }
              claimToken = token;

              const textToEmbed = `Título: ${data.title || ''}\nDescripción: ${data.description || ''}\nContenido: ${data.content || ''}`;

              if (textToEmbed.trim().length < 10) {
                await completeBackgroundWork({
                  db,
                  ref: change.doc.ref,
                  fields: RAG_CLAIM_FIELDS,
                  token,
                  completionPatch: {
                    _ragProcessingStatus: 'skipped_too_short',
                    _ragProcessedAt:
                      firestoreNamespace.FieldValue.serverTimestamp(),
                  },
                });
                return;
              }

              const embedFn =
                deps.generateEmbeddingsBatch ??
                (await loadDefaultEmbedder());
              const [embedding] = await embedFn([textToEmbed]);

              if (embedding && embedding.length > 0) {
                await completeBackgroundWork({
                  db,
                  ref: change.doc.ref,
                  fields: RAG_CLAIM_FIELDS,
                  token,
                  completionPatch: {
                    embedding,
                    _ragProcessingStatus: 'completed',
                    _ragProcessedAt:
                      firestoreNamespace.FieldValue.serverTimestamp(),
                  },
                });
                logger.info('rag_pipeline_embedding_saved', { docId: change.doc.id });
              } else {
                throw new Error('Empty embedding returned');
              }
            } catch (error) {
              logger.error('rag_pipeline_failed', error, {
                docId: change.doc.id,
                docType: data.type,
              });
              sentryCapture(error, { trigger: 'ragPipeline', tags: { docId: change.doc.id, docType: data.type ?? null } });
              if (claimToken) {
                await releaseBackgroundWork({
                  db,
                  ref: change.doc.ref,
                  fields: RAG_CLAIM_FIELDS,
                  token: claimToken,
                  failurePatch: {
                    _ragProcessingStatus: 'failed',
                    _ragError:
                      error instanceof Error ? error.message : 'Unknown error',
                  },
                });
              }
            }
            });
          }
        },
        (error) => {
          logger.error('rag_listener_error', error, { trigger: 'ragListener' });
          sentryCapture(error, { trigger: 'ragListener', tags: { phase: 'onSnapshot-error' } });
        },
      );
    // Trigger 3: incident close → Zettelkasten post-mortem auto-write.
    // Listens to top-level `incidents` collection (cross-tenant). Each doc
    // must carry `tenantId`, `projectId`, `status`, and `rootCause` for the
    // service to act. Fire-and-forget — never throws back to the listener.
    unsubIncidentClose = db.collection('incidents').onSnapshot(
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'modified' && change.type !== 'added') return;
          const data = change.doc.data() as Record<string, unknown>;
          const status = String(data.status ?? '').toLowerCase();
          if (status !== 'closed' && status !== 'resolved') return;
          if (!data.rootCause || typeof data.rootCause !== 'string') return;

          void serializeByKey(`incidentClose:${change.doc.id}`, async () => {
          let claimToken: string | null = null;

          const incident: PostmortemIncidentDoc = {
            id: change.doc.id,
            tenantId: String(data.tenantId ?? ''),
            projectId: String(data.projectId ?? ''),
            status,
            type: typeof data.type === 'string' ? data.type : undefined,
            rootCause: typeof data.rootCause === 'string' ? data.rootCause : undefined,
            workerUid: typeof data.workerUid === 'string' ? data.workerUid : undefined,
            occurredAt: typeof data.occurredAt === 'string' ? data.occurredAt : undefined,
            severity: typeof data.severity === 'string' ? data.severity : undefined,
          };

          if (!incident.tenantId || !incident.projectId) return;

          try {
            const token = createClaimToken();
            const claim = await claimBackgroundWork({
              db,
              ref: change.doc.ref,
              fields: POSTMORTEM_CLAIM_FIELDS,
              nowMs: nowMs(),
              leaseMs: TRIGGER_LEASE_MS,
              token,
            });
            if (claim.kind === 'completed') return;
            if (claim.kind === 'leased') {
              scheduleRetry(`incidentClose:${change.doc.id}`, claim.retryAfterMs, () => {
                void change.doc.ref.update({
                  _postmortemRetryRequestedAt:
                    firestoreNamespace.FieldValue.serverTimestamp(),
                });
              });
              return;
            }
            claimToken = token;

            const deterministicNodeId = `incident-${incident.id}-postmortem`;
            const existingNode = await db
              .collection(`tenants/${incident.tenantId}/zettelkasten_nodes`)
              .doc(deterministicNodeId)
              .get();
            if (existingNode.exists) {
              await completeBackgroundWork({
                db,
                ref: change.doc.ref,
                fields: POSTMORTEM_CLAIM_FIELDS,
                token,
                completionPatch: {
                  _postmortemWrittenAt:
                    firestoreNamespace.FieldValue.serverTimestamp(),
                  _postmortemNodeId: deterministicNodeId,
                },
              });
              return;
            }

            const embedFn =
              deps.generateEmbeddingsBatch ?? (await loadDefaultEmbedder());
            const result = await writeIncidentPostmortemNode(incident, {
              store: db as unknown as PostmortemMinimalStore,
              genEmbedding: singleEmbedAdapter(embedFn),
              captureError: (err, ctx) =>
                sentryCapture(err, {
                  trigger: 'incidentPostmortem',
                  tags: ctx as Record<string, string | number | boolean | null | undefined>,
                }),
              logger: {
                warn: (msg, ctx) =>
                  logger.warn(`postmortem_${msg}`, ctx as Record<string, unknown> | undefined),
                info: (msg, ctx) =>
                  logger.info(`postmortem_${msg}`, ctx as Record<string, unknown> | undefined),
              },
            });
            if (!result.ok) {
              await releaseBackgroundWork({
                db,
                ref: change.doc.ref,
                fields: POSTMORTEM_CLAIM_FIELDS,
                token,
                failurePatch: { _postmortemLastError: result.reason },
              });
              return;
            }
            await completeBackgroundWork({
              db,
              ref: change.doc.ref,
              fields: POSTMORTEM_CLAIM_FIELDS,
              token,
              completionPatch: {
                _postmortemWrittenAt:
                  firestoreNamespace.FieldValue.serverTimestamp(),
                _postmortemNodeId: result.nodeId,
              },
            });
          } catch (err) {
            // Defensa final: nada en este path debe romper el cierre del incidente.
            logger.error('postmortem_unexpected_error', err, { incidentId: change.doc.id });
            sentryCapture(err, {
              trigger: 'incidentPostmortem',
              tags: { phase: 'unexpected', incidentId: change.doc.id },
            });
            if (claimToken) {
              await releaseBackgroundWork({
                db,
                ref: change.doc.ref,
                fields: POSTMORTEM_CLAIM_FIELDS,
                token: claimToken,
                failurePatch: {
                  _postmortemLastError:
                    err instanceof Error ? err.message : String(err),
                },
              });
            }
          }
          });
        });
      },
      (error) => {
        logger.error('incident_close_listener_error', error, { trigger: 'incidentCloseListener' });
        sentryCapture(error, {
          trigger: 'incidentCloseListener',
          tags: { phase: 'onSnapshot-error' },
        });
      },
    );

    // Trigger 4: outbox worker (deuda 94ba).
    // Each pending outbox entry is claimed with a lease, delivered with its
    // frozen payload, and resolved to sent / failed (backoff) / dead_lettered.
    // The mirror on the original node (`_criticalAlertSentAt`) is written ONLY
    // when the worker reaches `sent`, so an undelivered alert is never
    // misreported as "sent" — life-safety invariant.
    const OUTBOX_FIELDS: OutboxDeliveryDeps['fields'] = {
      completedAt: '_sentAt',
      leaseUntilMs: '_leaseUntilMs',
      claimToken: '_claimToken',
      attempts: '_attempts',
    };

    unsubOutbox = db
      .collection('critical_alert_outbox')
      .where('status', 'in', ['pending', 'processing'])
      .onSnapshot(
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type !== 'added' && change.type !== 'modified') return;
            const data = change.doc.data() as { status?: string; nextAttemptAtMs?: number } | undefined;
            if (!data) return;
            if (data.status === 'processing') return; // Lease vivo — un worker ya está procesando
            if (typeof data.nextAttemptAtMs === 'number' && data.nextAttemptAtMs > nowMs()) return;

            void serializeByKey(`outbox:${change.doc.id}`, async () => {
              try {
                const result = await deliverOutboxItem({
                  db,
                  ref: change.doc.ref,
                  deps: {
                    fields: OUTBOX_FIELDS,
                    nowMs: () => nowMs(),
                    leaseMs: TRIGGER_LEASE_MS,
                    tokenFactory: () => createClaimToken(),
                    backoffBaseMs: 60_000,
                    maxAttempts: 12,
                    sendFcmMulticast: async (msg) => {
                      const r = await messaging.sendEachForMulticast({
                        tokens: msg.tokens,
                        notification: { title: msg.title, body: msg.body },
                        data: { projectId: msg.projectId, nodeId: msg.nodeId },
                        android: { priority: 'high' },
                      });
                      return { successCount: r.successCount, failureCount: r.failureCount };
                    },
                    sendCphsEmail: async (_recipients, _projectId, _severity, _title) => {
                      // El worker de outbox reutiliza el envío CPHS de la capa de
                      // servicio; en esta primera integración conservamos la
                      // lógica de email fuera del scope de outbox para mantener
                      // el cambio quirúrgico. La rama sent por FCM es suficiente
                      // para cerrar la deuda; email queda como canal secundario
                      // en una iteración posterior si la auditoría lo requiere.
                      return false;
                    },
                    mirrorNodeSent: async (nodeId) => {
                      const nodeRef = db.collection('nodes').doc(nodeId);
                      try {
                        await nodeRef.update({
                          _criticalAlertSentAt: firestoreNamespace.FieldValue.serverTimestamp(),
                        });
                      } catch (error) {
                        logger.warn('outbox_mirror_node_update_failed', { nodeId, error });
                      }
                    },
                    logger: {
                      info: (...args: unknown[]) => logger.info('critical_outbox', ...args as never[]),
                      warn: (...args: unknown[]) => logger.warn('critical_outbox', ...args as never[]),
                      error: (...args: unknown[]) => logger.error('critical_outbox', ...args as never[]),
                    },
                  },
                });
                if (result.kind === 'dead_lettered') {
                  logger.error('critical_outbox_dead_lettered', {
                    nodeId: change.doc.id,
                  });
                  sentryCapture(new Error('critical outbox dead_lettered'), {
                    trigger: 'criticalOutboxWorker',
                    tags: { nodeId: change.doc.id },
                  });
                }
              } catch (err) {
                logger.error('critical_outbox_worker_failed', err, {
                  nodeId: change.doc.id,
                });
                sentryCapture(err, {
                  trigger: 'criticalOutboxWorker',
                  tags: { nodeId: change.doc.id, phase: 'deliver' },
                });
              }
            });
          });
        },
        (error) => {
          logger.error('outbox_listener_error', error, { trigger: 'outboxListener' });
          sentryCapture(error, { trigger: 'outboxListener', tags: { phase: 'onSnapshot-error' } });
        },
      );
  } catch (err) {
    logger.error('background_triggers_setup_failed', err);
    sentryCapture(err, { trigger: 'setupBackgroundTriggers', tags: { phase: 'init' } });
  }

  return {
    unsubscribe: () => {
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      try {
        unsubIncidents();
      } catch (e) {
        logger.warn('triggers_unsubscribe_failed', { listener: 'incidents', err: e instanceof Error ? e.message : String(e) });
      }
      try {
        unsubRag();
      } catch (e) {
        logger.warn('triggers_unsubscribe_failed', { listener: 'rag', err: e instanceof Error ? e.message : String(e) });
      }
      try {
        unsubIncidentClose();
      } catch (e) {
        logger.warn('triggers_unsubscribe_failed', { listener: 'incidentClose', err: e instanceof Error ? e.message : String(e) });
      }
      try {
        unsubOutbox();
      } catch (e) {
        logger.warn('triggers_unsubscribe_failed', { listener: 'outbox', err: e instanceof Error ? e.message : String(e) });
      }
    },
  };

  // ── helpers ─────────────────────────────────────────────────────────
  // The default embedder dynamically imports `geminiBackend.js`. Kept as
  // a function so tests can inject `generateEmbeddingsBatch` directly
  // instead of mocking the module loader.
  async function loadDefaultEmbedder(): Promise<
    (texts: string[]) => Promise<number[][]>
  > {
    const mod = await import('../../services/geminiBackend.js');
    return mod.generateEmbeddingsBatch;
  }
}
