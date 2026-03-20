import { useState, useCallback, useEffect } from 'react';
import { ZettelkastenNode } from '../types';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, updateDoc, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirebase } from '../contexts/FirebaseContext';
import { saveForSync, syncWithFirebase, isOnline, SyncAction } from '../utils/pwa-offline';

export const useZettelkasten = () => {
  const [nodes, setNodes] = useState<ZettelkastenNode[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAuthReady, user } = useFirebase();

  useEffect(() => {
    if (!isAuthReady || !user) {
      setNodes([]);
      setLoading(false);
      return;
    }

    const q = query(collection(db, 'nodes'), orderBy('updatedAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNodes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ZettelkastenNode[];
      
      setNodes(newNodes);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'nodes');
    });

    // 1. Sync pending actions when online
    const handleOnline = () => {
      syncWithFirebase(async (action: SyncAction) => {
        if (action.collection === 'nodes') {
          if (action.type === 'create') {
            await setDoc(doc(db, 'nodes', action.data.id), action.data);
          } else if (action.type === 'update') {
            await updateDoc(doc(db, 'nodes', action.data.id), action.data.updates);
          }
        }
      });
    };

    window.addEventListener('online', handleOnline);
    if (isOnline()) handleOnline();

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleOnline);
    };
  }, [isAuthReady, user]);

  const addNode = useCallback(async (nodeData: Omit<ZettelkastenNode, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return null;
    
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    
    const newNode: ZettelkastenNode = {
      ...nodeData,
      id,
      createdAt: now,
      updatedAt: now,
    };

    try {
      if (!isOnline()) {
        await saveForSync({
          type: 'create',
          collection: 'nodes',
          data: newNode
        });
        setNodes(prev => [newNode, ...prev]);
        return newNode;
      }
      await setDoc(doc(db, 'nodes', id), newNode);
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
      const updates: Promise<void>[] = [];
      const now = new Date().toISOString();
      
      if (!node1.connections.includes(id2)) {
        if (!isOnline()) {
          await saveForSync({
            type: 'update',
            collection: 'nodes',
            data: { id: id1, updates: { connections: [...node1.connections, id2], updatedAt: now } }
          });
        } else {
          updates.push(updateDoc(doc(db, 'nodes', id1), {
            connections: [...node1.connections, id2],
            updatedAt: now
          }));
        }
      }
      
      if (!node2.connections.includes(id1)) {
        if (!isOnline()) {
          await saveForSync({
            type: 'update',
            collection: 'nodes',
            data: { id: id2, updates: { connections: [...node2.connections, id1], updatedAt: now } }
          });
        } else {
          updates.push(updateDoc(doc(db, 'nodes', id2), {
            connections: [...node2.connections, id1],
            updatedAt: now
          }));
        }
      }

      if (updates.length > 0) {
        await Promise.all(updates);
      }
      
      // Update local state for immediate feedback
      setNodes(prev => prev.map(n => {
        if (n.id === id1) return { ...n, connections: [...n.connections, id2], updatedAt: now };
        if (n.id === id2) return { ...n, connections: [...n.connections, id1], updatedAt: now };
        return n;
      }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'nodes');
    }
  }, [user, nodes]);

  const getConnectedNodes = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return [];
    return nodes.filter(n => node.connections.includes(n.id));
  }, [nodes]);

  const searchNodes = useCallback((queryStr: string) => {
    const lowerQuery = queryStr.toLowerCase();
    return nodes.filter(n => 
      n.title.toLowerCase().includes(lowerQuery) || 
      n.description.toLowerCase().includes(lowerQuery) ||
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
    addConnection,
    connectNodes: addConnection, // Alias for backward compatibility
    getConnectedNodes,
    searchNodes,
    getGraphData,
  };
};
