import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { ZettelkastenNode } from '../types';
import { db, collection, onSnapshot, query, orderBy, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirebase } from './FirebaseContext';

interface UniversalKnowledgeContextType {
  nodes: ZettelkastenNode[];
  loading: boolean;
  projectClusters: Record<string, ZettelkastenNode[]>;
  stats: {
    totalNodes: number;
    totalConnections: number;
    nodesByType: Record<string, number>;
    highRiskNodes: number;
    projectCount: number;
    avgConnections: string;
  };
}

const UniversalKnowledgeContext = createContext<UniversalKnowledgeContextType | undefined>(undefined);

export function UniversalKnowledgeProvider({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes] = useState<ZettelkastenNode[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAuthReady, user } = useFirebase();

  useEffect(() => {
    if (!isAuthReady || !user) {
      setNodes([]);
      setLoading(false);
      return;
    }

    // Subscribe to ALL nodes the user has access to
    // The security rules will handle the filtering based on RBAC
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
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const projectClusters = useMemo(() => {
    return nodes.reduce((acc, node) => {
      const projectId = node.projectId || 'global';
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(node);
      return acc;
    }, {} as Record<string, ZettelkastenNode[]>);
  }, [nodes]);

  const stats = useMemo(() => {
    const nodesByType: Record<string, number> = {};
    let totalConnections = 0;
    let highRiskNodes = 0;
    const projectIds = new Set<string>();

    nodes.forEach(node => {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
      totalConnections += node.connections.length;
      if (node.projectId) projectIds.add(node.projectId);
      
      // Heuristic for high risk nodes (can be refined)
      if (node.type === 'Riesgo' && (node.tags.includes('Crítico') || node.tags.includes('Alto'))) {
        highRiskNodes++;
      }
    });

    return {
      totalNodes: nodes.length,
      totalConnections: totalConnections / 2, // Bi-directional
      nodesByType,
      highRiskNodes,
      projectCount: projectIds.size,
      avgConnections: nodes.length > 0 ? (totalConnections / nodes.length).toFixed(1) : '0'
    };
  }, [nodes]);

  return (
    <UniversalKnowledgeContext.Provider value={{ nodes, loading, projectClusters, stats }}>
      {children}
    </UniversalKnowledgeContext.Provider>
  );
}

export function useUniversalKnowledge() {
  const context = useContext(UniversalKnowledgeContext);
  if (context === undefined) {
    throw new Error('useUniversalKnowledge must be used within a UniversalKnowledgeProvider');
  }
  return context;
}
