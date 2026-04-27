import React, { useEffect } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { syncWithFirebase, SyncAction, getPendingActions, removeSyncedAction } from '../utils/pwa-offline';
import { db, storage, handleFirestoreError, OperationType } from '../services/firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export function OfflineSyncManager() {
  const isOnline = useOnlineStatus();

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
              // Basic conflict resolution: check if document was updated since we went offline
              if (originalUpdatedAt) {
                const { getDoc } = await import('firebase/firestore');
                const docSnap = await getDoc(doc(db, action.collection, id));
                if (docSnap.exists()) {
                  const currentData = docSnap.data();
                  const currentUpdatedAt = currentData.updatedAt?.toDate()?.toISOString() || currentData.updatedAt;
                  
                  // If the server document is newer than our offline version, we have a conflict
                  if (currentUpdatedAt && new Date(currentUpdatedAt) > new Date(originalUpdatedAt)) {
                    console.warn(`Conflict detected for ${action.collection}/${id}. Server version is newer. Overwriting anyway (Last-Write-Wins).`);
                    window.dispatchEvent(new CustomEvent('sync-conflict', {
                      detail: { collection: action.collection, id, localUpdatedAt: originalUpdatedAt, serverUpdatedAt: currentUpdatedAt }
                    }));
                  }
                }
              }
              
              await updateDoc(doc(db, action.collection, id), updateData);
              docId = id;
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
            console.log(`Created Risk node ${nodeId} for synced action`);

            // If it was a create action, update the document with the nodeId
            if (action.type === 'create') {
              await updateDoc(doc(db, action.collection, docId), { nodeId });
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'nodes');
          }
        }

        console.log(`Successfully synced offline action: ${action.type} on ${action.collection}`);
      } catch (error) {
        console.error('Error syncing offline action:', error);
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
          console.error('Failed to sync action:', action, err);
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
        console.error('Failed to sync single action:', action, err);
        window.dispatchEvent(new CustomEvent('sync-action-failed', { detail: { action, error: err } }));
      }
    };

    runSync();

    window.addEventListener('force-sync', runSync);
    window.addEventListener('force-sync-single', handleSingleSync);
    return () => {
      window.removeEventListener('force-sync', runSync);
      window.removeEventListener('force-sync-single', handleSingleSync);
    };
  }, [isOnline]);

  return null;
}
