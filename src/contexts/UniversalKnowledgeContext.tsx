import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { RiskNode, EnvironmentContext } from '../types';
import { db, collection, onSnapshot, query, orderBy, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirebase } from './FirebaseContext';
import { fetchEnvironmentContext } from '../services/orchestratorService';

import { get, set } from 'idb-keyval';

interface UniversalKnowledgeContextType {
  nodes: RiskNode[];
  loading: boolean;
  projectClusters: Record<string, RiskNode[]>;
  environment: EnvironmentContext | null;
  communityGlossary: any[];
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
  const [nodes, setNodes] = useState<RiskNode[]>([]);
  const [communityGlossary, setCommunityGlossary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<EnvironmentContext | null>(null);
  const { isAuthReady, user, userIndustry } = useFirebase();

  // Fetch Environment Data (Orchestrator)
  useEffect(() => {
    let isMounted = true;
    
    const loadEnvironment = async () => {
      try {
        const envData = await fetchEnvironmentContext();
        if (isMounted) {
          setEnvironment(envData);
        }
      } catch (error) {
        console.error('Error loading environment context:', error);
      }
    };

    loadEnvironment();
    
    // Refresh environment data every 15 minutes
    const interval = setInterval(loadEnvironment, 15 * 60 * 1000);
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setNodes([]);
      setCommunityGlossary([]);
      setLoading(false);
      return;
    }

    // Subscribe to ALL nodes the user has access to
    // The security rules will handle the filtering based on RBAC
    const q = query(collection(db, 'nodes'), orderBy('updatedAt', 'desc'));
    
    const unsubscribeNodes = onSnapshot(q, (snapshot) => {
      const newNodes = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          description: data.description || data.content || ''
        };
      }) as RiskNode[];
      
      setNodes(newNodes);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'nodes');
      setLoading(false);
    });

    // Fetch Community Glossary for the user's industry
    // We don't need real-time updates for glossary, just fetch once per session
    import('../services/firebase').then(({ getDocs, where }) => {
      const glossaryQuery = query(
        collection(db, 'community_glossary'),
        where('industry', 'in', [userIndustry, 'General'])
      );
      getDocs(glossaryQuery).then(snapshot => {
        const glossary = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setCommunityGlossary(glossary);
        // Save to IndexedDB for offline access
        set(`community_glossary_${userIndustry}`, glossary);
      }).catch(async (error) => {
        console.error("Error fetching community glossary:", error);
        // Try to load from IndexedDB if offline
        const cached = await get(`community_glossary_${userIndustry}`);
        if (cached) {
          setCommunityGlossary(cached as any[]);
        }
      });
    });

    return () => unsubscribeNodes();
  }, [isAuthReady, user, userIndustry]);

  const projectClusters = useMemo(() => {
    return nodes.reduce((acc, node) => {
      const projectId = node.projectId || 'global';
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(node);
      return acc;
    }, {} as Record<string, RiskNode[]>);
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
    <UniversalKnowledgeContext.Provider value={{ nodes, loading, projectClusters, environment, communityGlossary, stats }}>
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
