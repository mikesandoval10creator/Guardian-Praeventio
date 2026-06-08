import React, { useEffect } from 'react';
import { logger } from '../utils/logger';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { syncWithFirebase, SyncAction, getPendingActions, removeSyncedAction } from '../utils/pwa-offline';
import { db, storage, handleFirestoreError, OperationType } from '../services/firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
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
import { logAuditAction } from '../services/auditService';
import { useProject } from '../contexts/ProjectContext';
import { apiAuthHeader } from '../lib/apiAuth';

export function OfflineSyncManager() {
  const isOnline = useOnlineStatus();
  const { selectedProject } = useProject();
  const activeProjectId = selectedProject?.id ?? null;

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
            const docRef = await addDoc(collection(db, action.collection), firestoreData);
            docId = docRef.id;
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
              let resolvedUpdate: Record<string, unknown> = { ...updateData };
              let manualPending = false;
              if (originalUpdatedAt) {
                const { getDoc } = await import('firebase/firestore');
                const docSnap = await getDoc(doc(db, action.collection, id));
                if (docSnap.exists()) {
                  const currentData = docSnap.data();
                  const currentUpdatedAt = currentData.updatedAt?.toDate()?.toISOString() || currentData.updatedAt;

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
                        try {
                          const authHeader = await apiAuthHeader();
                          if (authHeader) {
                            await fetch(
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
                          }
                        } catch (enqErr) {
                          logger.warn('Failed to persist critical conflict to queue', {
                            collection: c.collection,
                            docId: c.docId,
                            error: enqErr,
                          });
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
                // Firestore web SDK `updateDoc` wants a strict UpdateData<T>
                // shape; our `resolvedUpdate` is `Record<string, unknown>`
                // which is structurally compatible at runtime. Cast via
                // `unknown` first (TS refuses the direct cast because the
                // types don't sufficiently overlap).
                await updateDoc(doc(db, action.collection, id), resolvedUpdate as { [k: string]: any });
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
          const downloadUrl = await getDownloadURL(storageRef);
          
          // Add document to Firestore
          try {
            const docRef = await addDoc(collection(db, action.collection), {
              ...action.data.documentData,
              url: downloadUrl,
            });
            docId = docRef.id;
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, action.collection);
          }
        }

        // Handle Risk Network node creation if requested
        if (createNode && nodeData && docId) {
          const nodeId = crypto.randomUUID();
          const now = new Date().toISOString();
          const newNode = {
            ...nodeData,
            id: nodeId,
            createdAt: now,
            updatedAt: now,
          };

          // Update metadata with the new document ID if it's an upload
          if (action.type === 'upload' && newNode.metadata) {
             newNode.metadata.documentId = docId;
             // We need to get the download URL again if it was an upload
             if (action.data.storagePath) {
                 const storageRef = ref(storage, action.data.storagePath);
                 const downloadUrl = await getDownloadURL(storageRef);
                 newNode.metadata.url = downloadUrl;
             }
          }

          try {
            await setDoc(doc(db, 'nodes', nodeId), newNode);
            logger.info('Created Risk node for synced action', { nodeId });

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
      if (op.type === 'create') {
        const { id: _id, ...payload } = op.data ?? {};
        await addDoc(collection(db, collectionName), payload);
      } else if (op.type === 'update') {
        const { id, ...payload } = op.data ?? {};
        if (!id) throw new Error('update op missing id');
        await updateDoc(doc(db, collectionName, id), payload);
      } else if (op.type === 'delete') {
        const id = op.data?.id;
        if (!id) throw new Error('delete op missing id');
        await deleteDoc(doc(db, collectionName, id));
      } else if (op.type === 'set') {
        const { id, ...payload } = op.data ?? {};
        if (!id) throw new Error('set op missing id');
        await setDoc(doc(db, collectionName, id), payload, { merge: true });
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
            // Same cast pattern as above — strict UpdateData vs our Record.
            await updateDoc(doc(db, detail.collection, detail.docId), update as { [k: string]: any });
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
