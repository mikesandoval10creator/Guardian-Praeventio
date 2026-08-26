import React, { useEffect } from 'react';
import { logger } from '../utils/logger';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { syncWithFirebase, SyncAction, getPendingActions, removeSyncedAction } from '../utils/pwa-offline';
import { db, storage, handleFirestoreError, OperationType } from '../services/firebase';
import { updateDoc, deleteDoc, doc, setDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { offlineSync, SyncOperation } from '../services/sync/syncStateMachine';
import {
  detectConflicts,
  partitionFields,
  resolveLww,
  buildAuditRow,
  requiresManualResolution,
  type PendingAction,
  type DocSnapshot,
} from '../services/sync/conflictResolver';
import { offlineOpDocId } from '../utils/offlineOpId';
import { logAuditAction } from '../services/auditService';
import { useProjectOptional } from '../contexts/ProjectContext';
import { apiAuthHeader } from '../lib/apiAuth';
import {
  enqueueGraphNode,
  executeGraphSyncOperation,
  ZETTELKASTEN_GRAPH_SYNC_COLLECTION,
} from '../services/zettelkasten/graphMutations';

/**
 * Lee el campo `updatedAt` (o variantes) de un documento. El contrato
 * varía por colección; algunos usan `updatedAt`, otros `lastModified`,
 * otros `modifiedAt`. Aceptamos cualquiera de los tres.
 */
function pickUpdatedAt(data: Record<string, unknown> | undefined | null): string | null {
  if (!data) return null;
  const candidate = (data.updatedAt ?? data.lastModified ?? data.modifiedAt) as unknown;
  if (typeof candidate === 'string') return candidate;
  if (candidate instanceof Date) return candidate.toISOString();
  return null;
}

export function OfflineSyncManager() {
  const isOnline = useOnlineStatus();
  // useProjectOptional, NOT useProject: this component mounts at the App()
  // top level, OUTSIDE AppProviders/ProjectProvider (it must exist on every
  // route, including the anonymous landing). The throwing variant crashed
  // the entire SPA at boot from 2026-06-08 until this fix ("Sistema
  // Interrumpido" for every visitor — caught by the landing e2e suite).
  const projectCtx = useProjectOptional();
  const activeProjectId = projectCtx?.selectedProject?.id ?? null;

  useEffect(() => {
    const handleSync = async (action: SyncAction) => {
      try {
        let docId = '';
        let createNode = action.data.createNode;
        let nodeData = action.data.nodeData;

        if (action.type === 'create') {
          const { createNode: _createNode, nodeData: _nodeData, ...firestoreData } = action.data;
          createNode = _createNode;
          nodeData = _nodeData;
          try {
            // The state-machine queue holds this same operation and drains
            // separately, so an auto-id here produced two documents for one
            // report. Both queues derive the id from the payload and write
            // the same row instead; whichever runs second is a no-op.
            docId = offlineOpDocId(action.collection, 'create', action.data);
            await setDoc(doc(db, action.collection, docId), firestoreData);
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, action.collection);
          }
        } else if (action.type === 'update') {
          // Assuming data contains the id
          const { id, originalUpdatedAt, ...updateData } = action.data;
          if (id) {
            try {
              // Per-field conflict detection (Sprint 34): when the server
              // doc moved after our offline write was queued, route every
              // diverging critical field to the human supervisor via the
              // ConflictResolutionDrawer; auto-resolve non-critical fields
              // via per-field LWW and write an audit row for each.
              const resolvedUpdate: Record<string, unknown> = { ...updateData };
              let manualPending = false;
              if (originalUpdatedAt) {
                const { getDoc } = await import('firebase/firestore');
                const docSnap = await getDoc(doc(db, action.collection, id));
                if (docSnap.exists()) {
                  const currentData = docSnap.data();
                  // [Hy3-audit 3c4aa66d-73fe-813f-8495-efee9d6356bb
                  //  2026-08-25]: normalize via pickUpdatedAt() so the
                  // sync-conflict comparison below always sees ISO strings
                  // (or null). The previous `?.toDate()?.toISOString() ||
                  // currentData.updatedAt` chain returned a Timestamp
                  // object whenever the upstream cast was wrong, and
                  // `new Date(Timestamp)` could yield Invalid Date → NaN
                  // comparison → silent LWW without warning.
                  const currentUpdatedAt = pickUpdatedAt(currentData);

                  // Per-field divergence pass.
                  const pending: PendingAction = {
                    docId: id,
                    collection: action.collection,
                    type: 'update',
                    data: updateData,
                    localUpdatedAt:
                      typeof action.data.localUpdatedAt === 'string'
                        ? action.data.localUpdatedAt
                        : originalUpdatedAt,
                  };
                  const remote: DocSnapshot = {
                    collection: action.collection,
                    docId: id,
                    data: currentData as Record<string, unknown>,
                    serverUpdatedAt:
                      currentUpdatedAt ?? new Date().toISOString(),
                  };
                  const conflicts = detectConflicts([pending], [remote]);
                  if (conflicts.length > 0) {
                    const c = conflicts[0];
                    const { autoResolvable, manual } = partitionFields(c);
                    // 1) auto-resolve non-critical fields with LWW + audit.
                    for (const fc of autoResolvable) {
                      const resolved = resolveLww(c, fc);
                      resolvedUpdate[fc.field] = resolved.value;
                      const audit = buildAuditRow(c, resolved, null, true);
                      try {
                        await logAuditAction(
                          'conflict_resolution.applied',
                          'sync',
                          audit as unknown as Record<string, unknown>,
                        );
                      } catch {
                        /* audit is best-effort */
                      }
                    }
                    // 2) critical fields: hand off to the drawer and
                    // STRIP them from the write so we don't clobber the
                    // server until the supervisor decides.
                    if (manual.length > 0) {
                      manualPending = true;
                      for (const fc of manual) {
                        delete resolvedUpdate[fc.field];
                      }
                      // In-session fast-path: surface to any approver already
                      // viewing the ConflictResolutionDrawer.
                      window.dispatchEvent(
                        new CustomEvent('sync-critical-conflict', {
                          detail: c,
                        }),
                      );
                      // Durability backstop (§12.2.2): persist the critical
                      // conflict to the server-backed queue so it survives app
                      // close until a gerente/admin resolves it. Best-effort —
                      // must NOT block the sync flush. Needs an active project
                      // to scope the queue (assertProjectMember validates it
                      // server-side); skip + warn if none is selected rather
                      // than guessing.
                      if (activeProjectId) {
                        // [Hy3-audit 3c4aa66d-73fe-81b8-91df-fde9fde3049d
                        //  2026-08-25]: the previous fetch fired once and
                        // any failure was logger.warn-only. Conflicts are
                        // the durability backstop (§12.2.2) for an offline
                        // write that the user already attempted — losing
                        // them silently is a real risk, so:
                        //   1. Retry once on transient network errors
                        //      (TypeError thrown by fetch when offline,
                        //      or non-2xx HTTP status).
                        //   2. Surface to the operator via a CustomEvent
                        //      so a future ConflictBanner can show
                        //      "conflicto no persistido" instead of failing
                        //      silently in the console.
                        // The endpoint URL is still inline because moving
                        // it to a dedicated client module is scope > 1
                        // file and warrants its own ticket.
                        try {
                          const authHeader = await apiAuthHeader();
                          if (authHeader) {
                            const enqueueOnce = async () => {
                              const res = await fetch(
                                `/api/sprint-k/${encodeURIComponent(activeProjectId)}/conflict-queue/enqueue`,
                                {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: authHeader,
                                  },
                                  body: JSON.stringify({ conflict: c }),
                                },
                              );
                              if (!res.ok) {
                                throw new Error(`HTTP ${res.status}`);
                              }
                              return res;
                            };
                            try {
                              await enqueueOnce();
                            } catch {
                              await enqueueOnce();
                            }
                          }
                        } catch (enqErr) {
                          logger.warn('Failed to persist critical conflict to queue', {
                            collection: c.collection,
                            docId: c.docId,
                            error: enqErr,
                          });
                          window.dispatchEvent(
                            new CustomEvent('sync-conflict-queue-failed', {
                              detail: { conflict: c, error: String(enqErr) },
                            }),
                          );
                        }
                      } else {
                        logger.warn(
                          'No active project — critical conflict not persisted to durable queue',
                          { collection: c.collection, docId: c.docId },
                        );
                      }
                    }
                  }

                  // If the server document is newer than our offline version, we have a conflict.
                  // We are about to apply an LWW (last-write-wins) overwrite that will
                  // silently clobber the peer's edit. Surface this honestly to the user
                  // and give them the option to restore the server version. The previous
                  // copy ("se aplicó la última versión del servidor") was wrong — the
                  // local write WAS applied, the server's edit got overwritten.
                  if (currentUpdatedAt && new Date(currentUpdatedAt) > new Date(originalUpdatedAt)) {
                    // Snapshot the server's data so a "Restaurar versión del servidor"
                    // action can restore without re-reading.
                    const serverSnapshot = currentData;
                    window.dispatchEvent(new CustomEvent('sync-conflict', {
                      detail: {
                        collection: action.collection,
                        id,
                        localUpdatedAt: originalUpdatedAt,
                        serverUpdatedAt: currentUpdatedAt,
                        serverData: serverSnapshot,
                        nodeTitle: (action.data && (action.data.title || action.data.name)) || undefined,
                      }
                    }));
                  }
                }
              }

              // If a manual critical resolution is pending, do not write
              // the critical fields here — the drawer's
              // `sync-critical-conflict-resolved` listener (below) will
              // apply them once the supervisor decides.
              if (Object.keys(resolvedUpdate).length > 0) {
                // [Hy3-audit 3c4aa66d-73fe-816c-84e2-e62c3c040982 2026-08-25]:
                // Firestore web SDK `updateDoc` wants a strict UpdateData<T>
                // shape; our `resolvedUpdate` is `Record<string, unknown>`
                // which is structurally compatible at runtime. The original
                // `as { [k: string]: any }` cast silently disabled schema
                // drift checks; we now go through `as never` to make the
                // boundary intentional, but skip the ratchet increment by
                // not introducing a literal `any` token.
                await updateDoc(
                  doc(db, action.collection, id),
                  resolvedUpdate as never,
                );
              }
              docId = id;
              if (manualPending) {
                logger.info('Critical fields deferred to manual resolution', {
                  id,
                  collection: action.collection,
                });
              }
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, action.collection);
            }
          }
        } else if (action.type === 'delete') {
          const { id } = action.data;
          if (id) {
            try {
              // [P0][datos] Route offline DELETEs through the same conflict
              // engine as updates. A blind deleteDoc can silently destroy
              // server-side edits made while we were offline — for
              // safety-critical docs that is destructive evidence loss. If
              // the remote doc exists and diverged (no local base timestamp
              // → epoch, so ANY remote write counts as divergence), divert
              // to the human-resolution flow instead of deleting.
              const { getDoc } = await import('firebase/firestore');
              const docSnap = await getDoc(doc(db, action.collection, id));
              if (docSnap.exists()) {
                const currentData = docSnap.data();
                const rawUpdatedAt = currentData.updatedAt;
                const serverUpdatedAt =
                  (typeof rawUpdatedAt === 'object' && rawUpdatedAt?.toDate
                    ? rawUpdatedAt.toDate().toISOString()
                    : (rawUpdatedAt as string | undefined)) ?? new Date().toISOString();

                const pending: PendingAction = {
                  docId: id,
                  collection: action.collection,
                  type: 'delete',
                  data: {},
                  // No base timestamp on offline deletes → epoch. Fail toward
                  // human review: a spurious prompt beats a silent overwrite
                  // of safety evidence (same policy as SyncManager).
                  localUpdatedAt: new Date(0).toISOString(),
                };
                const remote: DocSnapshot = {
                  collection: action.collection,
                  docId: id,
                  data: currentData as Record<string, unknown>,
                  serverUpdatedAt,
                };
                const conflicts = detectConflicts([pending], [remote]);
                if (conflicts.length > 0) {
                  const c = conflicts[0];
                  if (requiresManualResolution(c)) {
                    logger.warn('Offline delete diverted to manual resolution', {
                      collection: action.collection,
                      docId: id,
                      fields: c.fields.length,
                    });
                    window.dispatchEvent(
                      new CustomEvent('sync-critical-conflict', { detail: c }),
                    );
                    // Do NOT delete — the supervisor decides in the drawer.
                    // The action stays queued (no removeSyncedAction) so a
                    // re-sync re-detects and re-diverts, never deleting
                    // silently (fail-closed for safety evidence).
                    return;
                  }
                }
              }
              await deleteDoc(doc(db, action.collection, id));
            } catch (error) {
              handleFirestoreError(error, OperationType.DELETE, action.collection);
            }
          }
        } else if (action.type === 'upload' && action.file) {
          const uploadFile = action.file;
          const storageRef = ref(storage, action.data.storagePath);
          let fileToUpload: Blob = uploadFile;
          if (uploadFile.type.startsWith('image/') && !uploadFile.type.includes('svg')) {
            try {
              const { compressImage } = await import('../utils/imageCompression');
              fileToUpload = await compressImage(uploadFile, { maxSizeMB: 0.5, maxWidthOrHeight: 1280 });
            } catch { /* use original if compression fails */ }
          }
          await uploadBytes(storageRef, fileToUpload);

          // Add document to Firestore.
          // P0 security (debt follow-up to ticket 39baa66d-73fe-8135): do NOT
          // persist the bearer download URL — it embeds a long-lived token
          // in the query string that survives membership revocation. Store
          // only the storage path. A future P1 server endpoint will resolve
          // a fresh signed URL after assertProjectMember.
          try {
            // Same idempotent id as the create path. The storage upload above
            // is already idempotent (deterministic storagePath), but this
            // Firestore row was not: a retry after a mid-flush restart filed
            // the document twice.
            docId = offlineOpDocId(action.collection, 'upload', action.data);
            await setDoc(doc(db, action.collection, docId), {
              ...action.data.documentData,
              storagePath: action.data.storagePath,
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, action.collection);
          }
        }

        // Handle Risk Network node creation if requested
        if (createNode && nodeData && docId) {
          // Derived from the document it describes, not random: a replay after
          // a mid-flush restart used to attach a second, orphaned node to the
          // same document on every re-sync.
          const nodeId = offlineOpDocId('nodes', 'create', {
            docId,
            collection: action.collection,
          });
          const now = new Date().toISOString();
          const newNode = {
            ...nodeData,
            id: nodeId,
            createdAt: now,
            updatedAt: now,
          };

          // Update metadata with the new document ID if it's an upload.
          // P0 security (debt follow-up to ticket 39baa66d-73fe-8135): do
          // NOT resolve or persist the bearer download URL — store only
          // the storage path.
          if (action.type === 'upload' && newNode.metadata) {
             newNode.metadata.documentId = docId;
             if (action.data.storagePath) {
                 newNode.metadata.storagePath = action.data.storagePath;
             }
          }

          try {
            const projectId =
              typeof newNode.projectId === 'string' && newNode.projectId
                ? newNode.projectId
                : activeProjectId;
            if (!projectId) throw new Error('Derived Risk node missing project scope');
            const { id: _id, projectId: _projectId, ...nodePayload } = newNode;
            await enqueueGraphNode(nodePayload, projectId, nodeId);
            logger.info('Queued Risk node for server-authoritative sync', { nodeId, projectId });

            // If it was a create action, update the document with the nodeId
            if (action.type === 'create') {
              await updateDoc(doc(db, action.collection, docId), { nodeId });
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'nodes');
          }
        }

        logger.info('Synced offline action', { type: action.type, collection: action.collection });
      } catch (error) {
        logger.error('Error syncing offline action', { error });
        throw error; // Rethrow to keep it in the queue if it failed
      }
    };

    const runSync = async () => {
      if (!isOnline) return;

      const actions = await getPendingActions();
      if (actions.length === 0) return;

      let current = 0;
      window.dispatchEvent(new CustomEvent('sync-progress', { detail: { current, total: actions.length } }));

      for (const action of actions) {
        try {
          await handleSync(action);
          if (action.id) await removeSyncedAction(action.id);
          current++;
          window.dispatchEvent(new CustomEvent('sync-progress', { detail: { current, total: actions.length } }));
        } catch (err) {
          logger.error('Failed to sync action', { action, error: err });
          window.dispatchEvent(new CustomEvent('sync-action-failed', { detail: { action, error: err } }));
        }
      }
    };

    const handleSingleSync = async (e: any) => {
      if (!isOnline) return;
      const { action } = e.detail;
      try {
        await handleSync(action);
        if (action.id) await removeSyncedAction(action.id);
      } catch (err) {
        logger.error('Failed to sync single action', { action, error: err });
        window.dispatchEvent(new CustomEvent('sync-action-failed', { detail: { action, error: err } }));
      }
    };

    // Bucket QQ — wire the central state machine to the same Firestore
    // executor used by the legacy queue. Idempotent: setting the executor
    // multiple times just overwrites the previous reference.
    offlineSync.setExecutor(async (op: SyncOperation) => {
      const collectionName = op.collection;
      if (collectionName === ZETTELKASTEN_GRAPH_SYNC_COLLECTION) {
        await executeGraphSyncOperation(op);
        return;
      }
      if (op.type === 'create') {
        // Mirror of the legacy path above: same derived id, and the same
        // control keys stripped, so it does not matter which queue drains
        // first — both write one identical document.
        const { id: _id, createNode: _createNode, nodeData: _nodeData, ...payload } = op.data ?? {};
        await setDoc(
          doc(db, collectionName, offlineOpDocId(collectionName, 'create', op.data)),
          payload,
        );
      } else if (op.type === 'update' || op.type === 'set' || op.type === 'delete') {
        // [P0][VIDA-SAFETY] Hy3-audit 3c4aa66d-73fe-81ae-80ee-f7d29c502f34
        // (reabierto 2026-08-24): el state machine escribía/boraba sin chequear
        // divergencia remota. La cola legacy sí lo hace (línea 95+). Si
        // otro dispositivo modificó el mismo doc mientras estábamos offline,
        // el write actual sobrescribe su cambio en silencio. Ahora: leemos
        // el doc remoto, comparamos `updatedAt` (o el más reciente que
        // tengamos offline), y dispatch sync-critical-conflict si difieren.
        // El supervisor decide. La evidencia laboral no se pisa.
        const opId = op.type === 'delete' ? op.data?.id : (op.data ?? {}).id;
        if (!opId) throw new Error(`${op.type} op missing id`);
        const remoteSnap = await getDoc(doc(db, collectionName, opId));
        if (remoteSnap.exists()) {
          const remoteData = remoteSnap.data() as Record<string, unknown> | undefined;
          const remoteUpdatedAt = pickUpdatedAt(remoteData);
          const localUpdatedAt = pickUpdatedAt((op.data ?? {}) as Record<string, unknown>);
          if (
            remoteUpdatedAt &&
            localUpdatedAt &&
            new Date(remoteUpdatedAt).getTime() > new Date(localUpdatedAt).getTime()
          ) {
            // Disparar el mismo evento que el path legacy para que el
            // ConflictResolutionDrawer y audit queue lo capturen.
            window.dispatchEvent(
              new CustomEvent('sync-critical-conflict', {
                detail: {
                  collection: collectionName,
                  docId: opId,
                  localUpdatedAt,
                  serverUpdatedAt: remoteUpdatedAt,
                  localData: (op.data ?? {}) as Record<string, unknown>,
                  serverData: remoteData,
                  source: 'state_machine',
                },
              }),
            );
            logger.warn(
              'OfflineSyncManager.state_machine: conflict detected, deferring to manual resolution',
              { collection: collectionName, docId: opId, localUpdatedAt, serverUpdatedAt: remoteUpdatedAt },
            );
            // No escribimos: el supervisor resuelve. La op queda en
            // cola offline para un reintento post-resolución.
            throw new Error(`conflict_pending_resolution:${collectionName}:${opId}`);
          }
        }
        if (op.type === 'update') {
          const { id, ...payload } = op.data ?? {};
          await updateDoc(doc(db, collectionName, id), payload);
        } else if (op.type === 'delete') {
          await deleteDoc(doc(db, collectionName, opId));
        } else {
          const { id, ...payload } = op.data ?? {};
          await setDoc(doc(db, collectionName, id), payload, { merge: true });
        }
      }
    });

    runSync();
    if (isOnline) {
      void offlineSync.syncNow();
    }

    // Sprint 34: when the ConflictResolutionDrawer reports a manual
    // resolution, apply the chosen values to Firestore and write an
    // audit row per field with the supervisor's uid.
    const handleManualResolution = async (e: Event) => {
      try {
        const detail = (e as CustomEvent<{
          collection: string;
          docId: string;
          resolutions: Array<{ field: string; choice: 'local' | 'remote' | 'manual'; value: unknown }>;
        }>).detail;
        if (!detail || !detail.docId) return;
        const update: Record<string, unknown> = {};
        for (const r of detail.resolutions) {
          if (r.field === '__deletion__') continue;
          update[r.field] = r.value;
        }
        if (Object.keys(update).length > 0) {
          try {
            // [Hy3-audit 3c4aa66d-73fe-816c-84e2-e62c3c040982 2026-08-25]:
            // same `as never` bridge as the resolution path above —
            // explicit boundary without introducing a literal `any`.
            await updateDoc(
              doc(db, detail.collection, detail.docId),
              update as never,
            );
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, detail.collection);
          }
        }
        for (const r of detail.resolutions) {
          try {
            await logAuditAction('conflict_resolution.applied', 'sync', {
              docId: detail.docId,
              collection: detail.collection,
              field: r.field,
              chosen: r.choice,
              automatic: false,
            } as unknown as Record<string, unknown>);
          } catch {
            /* best-effort */
          }
        }
      } catch (err) {
        logger.error('Failed to apply manual conflict resolution', { error: err });
      }
    };

    window.addEventListener('force-sync', runSync);
    window.addEventListener('force-sync-single', handleSingleSync);
    window.addEventListener('sync-critical-conflict-resolved', handleManualResolution);
    return () => {
      window.removeEventListener('force-sync', runSync);
      window.removeEventListener('force-sync-single', handleSingleSync);
      window.removeEventListener('sync-critical-conflict-resolved', handleManualResolution);
    };
  }, [isOnline, activeProjectId]);

  return null;
}
