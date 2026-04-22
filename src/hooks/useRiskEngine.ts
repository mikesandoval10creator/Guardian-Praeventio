import { useState, useCallback, useEffect, useMemo } from 'react';
import { RiskNode, NodeType } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, updateDoc, deleteDoc, handleFirestoreError, OperationType, where } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { autoConnectNodes, enrichNodeData } from '../services/geminiService';
import { useOnlineStatus } from './useOnlineStatus';
import { usePendingActions } from './usePendingActions';
import { matrixSyncManager } from '../services/syncManager';
import { useProject } from '../contexts/ProjectContext';

export const useRiskEngine = () => {
  const [fetchedNodes, setFetchedNodes] = useState<RiskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAuthReady, user } = useFirebase();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const pendingActions = usePendingActions();
  const [syncOperations, setSyncOperations] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = matrixSyncManager.subscribe(() => {
      setSyncOperations(matrixSyncManager.getPendingOperations());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user || !selectedProject) {
      setFetchedNodes([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'nodes'), 
      where('projectId', '==', selectedProject.id),
      orderBy('updatedAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNodes = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          description: data.description || data.content || ''
        };
      }) as RiskNode[];
      
      setFetchedNodes(newNodes);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'nodes');
    });

    return () => {
      unsubscribe();
    };
  }, [isAuthReady, user, selectedProject]);

  const nodes = useMemo(() => {
    const pendingNodes = pendingActions
      .filter(action => action.data?.createNode && action.data?.nodeData)
      .map(action => ({
        ...action.data.nodeData,
        id: `pending-${action.timestamp}`, // Temporary ID
        createdAt: new Date(action.timestamp).toISOString(),
        updatedAt: new Date(action.timestamp).toISOString(),
        isPendingSync: true
      } as RiskNode));

    // We also need to handle updates to nodes if any
    const pendingUpdates = pendingActions
      .filter(action => action.type === 'update' && action.collection === 'nodes')
      .reduce((acc, action) => {
        if (action.data?.id) {
          acc[action.data.id] = action.data;
        }
        return acc;
      }, {} as Record<string, any>);

    const pendingDeletes = new Set(
      pendingActions
        .filter(action => action.type === 'delete' && action.collection === 'nodes')
        .map(action => action.data?.id)
    );

    const syncUpdates = syncOperations.reduce((acc, op) => {
      if (op.type === 'update') acc[op.id] = op.data;
      return acc;
    }, {} as Record<string, any>);

    const syncDeletes = new Set(
      syncOperations.filter(op => op.type === 'delete').map(op => op.id)
    );

    const syncNewNodes = syncOperations
      .filter(op => op.type === 'set')
      .map(op => ({ ...op.data, isPendingSync: true } as RiskNode));

    const mergedNodes = fetchedNodes
      .filter(node => !pendingDeletes.has(node.id) && !syncDeletes.has(node.id))
      .map(node => {
        let updatedNode = { ...node };
        if (pendingUpdates[node.id]) {
          updatedNode = { ...updatedNode, ...pendingUpdates[node.id], isPendingSync: true };
        }
        if (syncUpdates[node.id]) {
          updatedNode = { ...updatedNode, ...syncUpdates[node.id], isPendingSync: true };
        }
        return updatedNode;
      });

    return [...pendingNodes, ...syncNewNodes, ...mergedNodes].sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [fetchedNodes, pendingActions, syncOperations]);

  useEffect(() => {
    matrixSyncManager.setNodesProvider(() => nodes);
  }, [nodes]);

  // Background Auto-Healer: Detects and fixes incomplete nodes automatically using AI
  useEffect(() => {
    if (!user || fetchedNodes.length === 0) return;

    const healIncompleteNodes = async () => {
      const incompleteNodes = fetchedNodes.filter(node => 
        !node.title || 
        !node.description || 
        node.title === 'Sin título' || 
        node.description === 'Sin descripción' ||
        (node.type === NodeType.RISK && (!node.metadata || !node.metadata.criticidad))
      );

      // Process one by one to avoid rate limits
      for (const node of incompleteNodes.slice(0, 5)) { // Limit to 5 per session to avoid overwhelming the API
        try {
          console.log(`Auto-healing node ${node.id}...`);
          const enrichedData = await enrichNodeData(node);
          
          if (enrichedData.title !== node.title || enrichedData.description !== node.description) {
            await updateDoc(doc(db, 'nodes', node.id), {
              title: enrichedData.title,
              description: enrichedData.description,
              metadata: enrichedData.metadata,
              updatedAt: new Date().toISOString()
            });
            console.log(`Node ${node.id} healed successfully.`);
          }
        } catch (error) {
          console.error(`Failed to heal node ${node.id}:`, error);
        }
      }
    };

    // Run healer after a short delay to not block initial render
    const timeoutId = setTimeout(() => {
      healIncompleteNodes();
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [fetchedNodes, user]);

  const addNode = useCallback(async (nodeData: Omit<RiskNode, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return null;
    
    let enrichedData = { ...nodeData };
    
    // If critical information is missing, ask AI to generate the real, accurate data
    if (!enrichedData.title || !enrichedData.description || enrichedData.title === 'Sin título' || enrichedData.description === 'Sin descripción') {
      try {
        enrichedData = await enrichNodeData(enrichedData);
      } catch (enrichError) {
        console.error('Failed to enrich node data via AI, using original data:', enrichError);
      }
    }
    
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    const newNode: RiskNode = {
      ...enrichedData,
      tags: Array.isArray(enrichedData.tags) ? enrichedData.tags : [],
      connections: Array.isArray(enrichedData.connections) ? enrichedData.connections : [],
      id,
      createdAt: now,
      updatedAt: now,
    };

    try {
      matrixSyncManager.enqueueSet(newNode);
      return newNode;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `nodes/${id}`);
      return null;
    }
  }, [user]);

  const addConnection = useCallback(async (id1: string, id2: string) => {
    if (!user) return;
    
    const node1 = nodes.find(n => n.id === id1);
    const node2 = nodes.find(n => n.id === id2);
    
    if (!node1 || !node2) return;

    const now = new Date().toISOString();

    try {
      const conn1 = node1.connections ?? [];
      if (!conn1.includes(id2)) {
        matrixSyncManager.enqueueUpdate(id1, {
          connections: [...conn1, id2],
          updatedAt: now
        });
      }

      const conn2 = node2.connections ?? [];
      if (!conn2.includes(id1)) {
        matrixSyncManager.enqueueUpdate(id2, {
          connections: [...conn2, id1],
          updatedAt: now
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'nodes');
    }
  }, [user, nodes]);

  const updateNode = useCallback(async (id: string, updates: Partial<RiskNode>) => {
    if (!user) return;
    const now = new Date().toISOString();
    const finalUpdates = { ...updates, updatedAt: now };
    
    try {
      matrixSyncManager.enqueueUpdate(id, finalUpdates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `nodes/${id}`);
    }
  }, [user]);

  const deleteNode = useCallback(async (id: string) => {
    if (!user) return;
    try {
      matrixSyncManager.enqueueDelete(id);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `nodes/${id}`);
    }
  }, [user]);

  const getConnectedNodes = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return [];
    return nodes.filter(n => node.connections.includes(n.id));
  }, [nodes]);

  const searchNodes = useCallback((queryStr: string) => {
    const lowerQuery = String(queryStr || '').toLowerCase();
    return nodes.filter(n => 
      n.title.toLowerCase().includes(lowerQuery) || 
      (n.description || '').toLowerCase().includes(lowerQuery) ||
      n.tags.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }, [nodes]);

  const getGraphData = useCallback(() => {
    const links: { source: string; target: string }[] = [];
    const processed = new Set<string>();

    nodes.forEach(node => {
      node.connections.forEach(targetId => {
        const linkId = [node.id, targetId].sort().join('-');
        if (!processed.has(linkId)) {
          links.push({ source: node.id, target: targetId });
          processed.add(linkId);
        }
      });
    });

    return {
      nodes: nodes.map(n => ({
        ...n,
        // For react-force-graph
        name: n.title,
        val: 1
      })),
      links
    };
  }, [nodes]);

  return {
    nodes,
    loading,
    addNode,
    updateNode,
    deleteNode,
    addConnection,
    connectNodes: addConnection, // Alias for backward compatibility
    getConnectedNodes,
    searchNodes,
    getGraphData,
  };
};
