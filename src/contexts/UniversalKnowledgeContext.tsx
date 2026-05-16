import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { RiskNode, EnvironmentContext } from '../types';
import { db, collection, onSnapshot, query, orderBy, where, handleFirestoreError, OperationType } from '../services/firebase';
import { addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useFirebase } from './FirebaseContext';
import { useProject } from './ProjectContext';
import { fetchEnvironmentContext } from '../services/orchestratorService';

import { get, set } from 'idb-keyval';
import { logger } from '../utils/logger';
import {
  applyMigrations,
  needsUpgrade,
  CURRENT_RISK_NODE_VERSION,
} from '../services/migration/registry';

export interface KnowledgeGraph {
  nodes: RiskNode[];
  edges: { from: string; to: string }[];
}

interface UniversalKnowledgeContextType {
  nodes: RiskNode[];
  loading: boolean;
  projectClusters: Record<string, RiskNode[]>;
  environment: EnvironmentContext | null;
  communityGlossary: any[];
  graph: KnowledgeGraph;
  stats: {
    totalNodes: number;
    totalConnections: number;
    nodesByType: Record<string, number>;
    highRiskNodes: number;
    projectCount: number;
    avgConnections: string;
  };
  createNode: (data: Omit<RiskNode, 'id'>) => Promise<string>;
  createEdge: (fromId: string, toId: string) => Promise<void>;
}

const UniversalKnowledgeContext = createContext<UniversalKnowledgeContextType | undefined>(undefined);

export function UniversalKnowledgeProvider({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes] = useState<RiskNode[]>([]);
  const [communityGlossary, setCommunityGlossary] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<EnvironmentContext | null>(null);
  const { isAuthReady, user, userIndustry } = useFirebase();
  const { selectedProject } = useProject();

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
        logger.error('Error loading environment context:', error);
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
      return undefined;
    }

    // No project selected â†’ don't subscribe yet. We surface an empty list
    // and `loading=false` so consumers can render their "select a project"
    // empty states. Without this guard we would issue a wide-open
    // collection query that the security rules would reject (and hammer
    // Firestore on every render).
    if (!selectedProject) {
      setNodes([]);
      setLoading(false);
      return undefined;
    }

    // Round 14 Task 4: scope the subscription to the active project.
    //
    // Previously this query loaded every node the user could read across
    // every project in their org, then `projectClusters` re-bucketed them
    // by `projectId` on the client. That worked for a few hundred nodes
    // but doesn't scale, and it leaked node titles from one project into
    // the global graph rendering for users who multitask across projects.
    //
    // The same `where('projectId','==',selectedProject.id)` filter is
    // already used by `useRiskEngine.ts:36` for the per-project graph
    // view, so the data shape is consistent across the two consumers.
    const q = query(
      collection(db, 'nodes'),
      where('projectId', '==', selectedProject.id),
      orderBy('updatedAt', 'desc'),
    );

    const unsubscribeNodes = onSnapshot(q, (snapshot) => {
      // Sprint 24 (Bucket MM.2): lazy schema upgrade on read.
      //
      // Older nodes pre-date `metadata.geo`, the tags-as-array invariant,
      // etc. We run them through `applyMigrations` BEFORE handing them to
      // React so consumers always see the current shape. If any node was
      // upgraded, we asynchronously persist the upgraded form so the next
      // reader gets a fast path. The persist runs in `requestIdleCallback`
      // (or a microtask fallback) â€” it MUST NOT block the UI.
      const upgradesPending: { id: string; node: any }[] = [];
      const newNodes = snapshot.docs.map(doc => {
        const data = doc.data();
        const raw = {
          id: doc.id,
          ...data,
          description: data.description || data.content || ''
        };
        if (needsUpgrade(raw)) {
          const upgraded = applyMigrations(raw);
          upgradesPending.push({ id: doc.id, node: upgraded });
          return upgraded as RiskNode;
        }
        return raw as RiskNode;
      });

      setNodes(newNodes);
      setLoading(false);

      // Fire-and-forget background persist of upgraded shapes.
      if (upgradesPending.length > 0) {
        const persist = () => {
          upgradesPending.forEach(({ id, node }) => {
            // Only write the fields that migrations may have touched, plus
            // the schemaVersion stamp. We deliberately avoid clobbering
            // server-managed timestamps.
            const patch: Record<string, any> = {
              schemaVersion: CURRENT_RISK_NODE_VERSION,
              tags: node.tags,
              connections: node.connections,
              metadata: node.metadata,
              updatedAt: serverTimestamp(),
            };
            updateDoc(doc(db, 'nodes', id), patch).catch((err) => {
              // Non-fatal: a permission error here just means we'll retry
              // next read. Don't surface to the user.
              logger.warn('Lazy schema upgrade persist failed', { nodeId: id, error: String(err) });
            });
          });
        };
        const ric = globalThis.requestIdleCallback;
        if (typeof ric === 'function') {
          ric(persist, { timeout: 2000 });
        } else {
          Promise.resolve().then(persist);
        }
      }
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
        logger.error("Error fetching community glossary:", error);
        // Try to load from IndexedDB if offline
        const cached = await get(`community_glossary_${userIndustry}`);
        if (cached) {
          setCommunityGlossary(cached as any[]);
        }
      });
    });

    return () => unsubscribeNodes();
  }, [isAuthReady, user, userIndustry, selectedProject?.id]);

  const projectClusters = useMemo(() => {
    return nodes.reduce((acc, node) => {
      const projectId = node.projectId || 'global';
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(node);
      return acc;
    }, {} as Record<string, RiskNode[]>);
  }, [nodes]);

  const graph = useMemo<KnowledgeGraph>(() => {
    const edgeSet = new Set<string>();
    const edges: { from: string; to: string }[] = [];
    nodes.forEach(node => {
      node.connections.forEach(toId => {
        const key = [node.id, toId].sort().join('--');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: node.id, to: toId });
        }
      });
    });
    return { nodes, edges };
  }, [nodes]);

  const createNode = useCallback(async (data: Omit<RiskNode, 'id'>): Promise<string> => {
    const ref = await addDoc(collection(db, 'nodes'), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }, []);

  const createEdge = useCallback(async (fromId: string, toId: string): Promise<void> => {
    const fromNode = nodes.find(n => n.id === fromId);
    const toNode = nodes.find(n => n.id === toId);
    if (!fromNode || !toNode) return;
    const fromConns = Array.from(new Set([...fromNode.connections, toId]));
    const toConns = Array.from(new Set([...toNode.connections, fromId]));
    await Promise.all([
      updateDoc(doc(db, 'nodes', fromId), { connections: fromConns, updatedAt: serverTimestamp() }),
      updateDoc(doc(db, 'nodes', toId), { connections: toConns, updatedAt: serverTimestamp() }),
    ]);
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
      if (node.type === 'Riesgo' && (node.tags.includes('CrÃ­tico') || node.tags.includes('Alto'))) {
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
    <UniversalKnowledgeContext.Provider value={{ nodes, loading, projectClusters, environment, communityGlossary, graph, stats, createNode, createEdge }}>
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
