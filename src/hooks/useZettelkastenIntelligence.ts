import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { RiskNode, Worker, TrainingSession, NodeType } from '../types';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { logger } from '../utils/logger';

export type SmartActionType =
  | 'link_risk_to_control'
  | 'assign_training'
  | 'create_incident_node'
  | 'link_worker_to_epp'
  | 'escalate_to_supervisor';

export interface SmartAction {
  type: SmartActionType;
  label: string;
  description: string;
  relevantNodeIds: string[];
  priority: 'high' | 'medium' | 'low';
}

type ModuleType =
  | 'risk_network'
  | 'workers'
  | 'training'
  | 'findings'
  | 'safe_driving'
  | 'dashboard';

function deriveModule(pathname: string): ModuleType {
  if (pathname.startsWith('/map')) return 'risk_network';
  if (pathname.startsWith('/workers')) return 'workers';
  if (pathname.startsWith('/training')) return 'training';
  if (pathname.startsWith('/findings')) return 'findings';
  if (pathname.startsWith('/safe-driving')) return 'safe_driving';
  return 'dashboard';
}

function deriveEntityId(pathname: string): string | undefined {
  // e.g. /workers/abc123  or /findings/xyz
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return undefined;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function useZettelkastenIntelligence() {
  const { selectedProject } = useProject();
  const { nodes } = useUniversalKnowledge();
  const location = useLocation();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- URL-based context detection ---
  const currentModule = useMemo<ModuleType>(
    () => deriveModule(location.pathname),
    [location.pathname]
  );

  const currentEntityId = useMemo<string | undefined>(
    () => deriveEntityId(location.pathname),
    [location.pathname]
  );

  // --- Smart actions derived from nodes ---
  const smartActions = useMemo<SmartAction[]>(() => {
    const actions: SmartAction[] = [];

    // 1. RISK nodes without any linked CONTROL node
    const riskNodes = nodes.filter(n => n.type === NodeType.RISK);
    const controlNodeIds = new Set(
      nodes.filter(n => n.type === NodeType.CONTROL).map(n => n.id)
    );
    const risksWithoutControls = riskNodes.filter(
      r => !r.connections.some(cid => controlNodeIds.has(cid))
    );
    if (risksWithoutControls.length > 0) {
      actions.push({
        type: 'link_risk_to_control',
        label: 'Vincular riesgos a controles',
        description: `${risksWithoutControls.length} riesgo${risksWithoutControls.length > 1 ? 's' : ''} sin medida de control definida.`,
        relevantNodeIds: risksWithoutControls.map(n => n.id),
        priority: 'high',
      });
    }

    // 2. WORKER nodes without any TRAINING linked
    const workerNodes = nodes.filter(n => n.type === NodeType.WORKER);
    const trainingNodeIds = new Set(
      nodes.filter(n => n.type === NodeType.TRAINING).map(n => n.id)
    );
    const workersWithoutTraining = workerNodes.filter(
      w => !w.connections.some(cid => trainingNodeIds.has(cid))
    );
    if (workersWithoutTraining.length > 0) {
      actions.push({
        type: 'assign_training',
        label: 'Asignar capacitación',
        description: `${workersWithoutTraining.length} trabajador${workersWithoutTraining.length > 1 ? 'es' : ''} sin capacitaciones registradas.`,
        relevantNodeIds: workersWithoutTraining.map(n => n.id),
        priority: 'high',
      });
    }

    // 3. INCIDENT nodes created in the last 7 days
    const now = Date.now();
    const recentIncidents = nodes.filter(n => {
      if (n.type !== NodeType.INCIDENT) return false;
      const createdAt =
        n.metadata?.createdAt
          ? new Date(n.metadata.createdAt).getTime()
          : new Date(n.createdAt).getTime();
      return now - createdAt < SEVEN_DAYS_MS;
    });
    if (recentIncidents.length > 0) {
      actions.push({
        type: 'create_incident_node',
        label: 'Revisar incidentes recientes',
        description: `${recentIncidents.length} incidente${recentIncidents.length > 1 ? 's' : ''} registrado${recentIncidents.length > 1 ? 's' : ''} en los últimos 7 días.`,
        relevantNodeIds: recentIncidents.map(n => n.id),
        priority: 'medium',
      });
    }

    return actions;
  }, [nodes]);

  // suggestedActions = smartActions filtered/sorted by currentModule relevance
  const suggestedActions = useMemo<SmartAction[]>(() => {
    const moduleRelevance: Partial<Record<ModuleType, SmartActionType[]>> = {
      risk_network: ['link_risk_to_control', 'create_incident_node', 'escalate_to_supervisor'],
      workers: ['assign_training', 'link_worker_to_epp'],
      training: ['assign_training'],
      findings: ['escalate_to_supervisor', 'create_incident_node'],
      safe_driving: ['escalate_to_supervisor'],
      dashboard: ['link_risk_to_control', 'assign_training', 'create_incident_node'],
    };
    const relevant = moduleRelevance[currentModule] ?? [];
    const sorted = [...smartActions].sort((a, b) => {
      const aRelevant = relevant.includes(a.type) ? 0 : 1;
      const bRelevant = relevant.includes(b.type) ? 0 : 1;
      if (aRelevant !== bRelevant) return aRelevant - bRelevant;
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    return sorted;
  }, [smartActions, currentModule]);

  // --- Orphan detection (legacy logic kept intact) ---
  const [orphanRisks, setOrphanRisks] = useState<RiskNode[]>([]);
  const [orphanWorkers, setOrphanWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    if (!selectedProject) return;

    const analyzeOrphans = async () => {
      setIsAnalyzing(true);
      try {
        // Nodes from root collection (correct path — not a subcollection)
        const nodesSnap = await getDocs(
          query(collection(db, 'nodes'), where('projectId', '==', selectedProject.id))
        );
        const fetchedNodes = nodesSnap.docs.map(d => ({ id: d.id, ...d.data() } as RiskNode));

        // Workers from project subcollection (correct path)
        const workersSnap = await getDocs(
          collection(db, `projects/${selectedProject.id}/workers`)
        );
        const workers = workersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Worker));

        // Trainings from root collection, no trailing 's'
        const trainingsSnap = await getDocs(
          query(collection(db, 'training'), where('projectId', '==', selectedProject.id))
        );
        const trainings = trainingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as TrainingSession));

        // 1. Find Risks without controls (Orphan Risks)
        const detectedOrphanRisks = fetchedNodes.filter(node =>
          node.type === NodeType.RISK &&
          (!node.metadata?.controles || node.metadata.controles.trim() === '')
        );
        setOrphanRisks(detectedOrphanRisks);

        // 2. Find Workers without any training (Orphan Workers)
        const trainedWorkerIds = new Set(trainings.flatMap(t => t.attendees || []));
        const detectedOrphanWorkers = workers.filter(w => !trainedWorkerIds.has(w.id));
        setOrphanWorkers(detectedOrphanWorkers);

        // Create notifications for orphan risks
        for (const risk of detectedOrphanRisks) {
          const notifQuery = query(
            collection(db, `projects/${selectedProject.id}/notifications`),
            where('relatedId', '==', risk.id),
            where('type', '==', 'orphan_risk')
          );
          const existing = await getDocs(notifQuery);

          if (existing.empty) {
            await addDoc(collection(db, `projects/${selectedProject.id}/notifications`), {
              title: 'Riesgo Huérfano Detectado',
              message: `El riesgo "${risk.title}" no tiene medidas de control definidas.`,
              type: 'orphan_risk',
              relatedId: risk.id,
              read: false,
              createdAt: serverTimestamp(),
              severity: 'high'
            });
          }
        }

        // Create notifications for orphan workers
        for (const worker of detectedOrphanWorkers) {
          const notifQuery = query(
            collection(db, `projects/${selectedProject.id}/notifications`),
            where('relatedId', '==', worker.id),
            where('type', '==', 'orphan_worker')
          );
          const existing = await getDocs(notifQuery);

          if (existing.empty) {
            await addDoc(collection(db, `projects/${selectedProject.id}/notifications`), {
              title: 'Trabajador sin Capacitación',
              message: `El trabajador ${worker.name} no tiene capacitaciones registradas.`,
              type: 'orphan_worker',
              relatedId: worker.id,
              read: false,
              createdAt: serverTimestamp(),
              severity: 'medium'
            });
          }
        }

      } catch (error) {
        logger.error("Error analyzing Zettelkasten orphans:", error);
      } finally {
        setIsAnalyzing(false);
      }
    };

    analyzeOrphans();
  }, [selectedProject]);

  return {
    isAnalyzing,
    orphanRisks,
    orphanWorkers,
    smartActions,
    suggestedActions,
    currentModule,
    currentEntityId,
  };
}
