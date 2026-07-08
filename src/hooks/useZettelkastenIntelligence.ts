import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { RiskNode, Worker, TrainingSession, NodeType } from '../types';
import { collection, serverTimestamp, query, where, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { logger } from '../utils/logger';

export interface OrphanNotification {
  title: string;
  message: string;
  type: 'orphan_risk' | 'orphan_worker';
  relatedId: string;
  severity: 'high' | 'medium';
}

/**
 * Pure dedup: given the detected orphans and the relatedIds that ALREADY have a
 * notification (read ONCE per type, not per orphan), return only the
 * notifications that still need to be created. No I/O — unit-testable, and the
 * single source of truth for the "which orphans still need a notif" decision.
 */
export function buildOrphanNotifications(
  orphanRisks: ReadonlyArray<{ id: string; title?: string }>,
  orphanWorkers: ReadonlyArray<{ id: string; name?: string }>,
  existingRiskIds: ReadonlySet<string | undefined>,
  existingWorkerIds: ReadonlySet<string | undefined>,
): OrphanNotification[] {
  const out: OrphanNotification[] = [];
  for (const risk of orphanRisks) {
    if (existingRiskIds.has(risk.id)) continue;
    out.push({
      title: 'Riesgo Huérfano Detectado',
      message: `El riesgo "${risk.title ?? ''}" no tiene medidas de control definidas.`,
      type: 'orphan_risk',
      relatedId: risk.id,
      severity: 'high',
    });
  }
  for (const worker of orphanWorkers) {
    if (existingWorkerIds.has(worker.id)) continue;
    out.push({
      title: 'Trabajador sin Capacitación',
      message: `El trabajador ${worker.name ?? ''} no tiene capacitaciones registradas.`,
      type: 'orphan_worker',
      relatedId: worker.id,
      severity: 'medium',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy node-based action types (preserved for backward compatibility)
// ---------------------------------------------------------------------------

export type SmartActionType =
  | 'link_risk_to_control'
  | 'assign_training'
  | 'create_incident_node'
  | 'link_worker_to_epp'
  | 'escalate_to_supervisor';

/** Node-graph–derived smart action (legacy shape, kept intact). */
export interface NodeSmartAction {
  type: SmartActionType;
  label: string;
  description: string;
  relevantNodeIds: string[];
  priority: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// URL-context smart actions (new shape)
// ---------------------------------------------------------------------------

/** Context-aware smart action shown in the SmartConnectionsPanel. */
export interface SmartAction {
  id: string;
  label: string;
  description: string;
  /** URL contexts this action applies to. */
  context: string[];
  /** Lucide icon name as a string. */
  icon: string;
  priority: 'high' | 'medium' | 'low';
}

export type URLContext =
  | 'workers'
  | 'epp'
  | 'risks'
  | 'training'
  | 'ergonomics'
  | 'medicine'
  | 'audits'
  | 'general';

/** Maps a pathname to the matching URLContext. */
function detectContextFromURL(pathname: string): URLContext {
  if (pathname.includes('/workers') || pathname.includes('/worker')) return 'workers';
  if (pathname.includes('/epp')) return 'epp';
  if (pathname.includes('/risks') || pathname.includes('/risk')) return 'risks';
  if (pathname.includes('/training')) return 'training';
  if (pathname.includes('/ergonomics') || pathname.includes('/ergonomic')) return 'ergonomics';
  if (pathname.includes('/medicine') || pathname.includes('/medical')) return 'medicine';
  if (pathname.includes('/audits') || pathname.includes('/audit')) return 'audits';
  return 'general';
}

const SMART_ACTIONS: SmartAction[] = [
  {
    id: 'create-worker-epp-connection',
    label: 'Conectar EPP a Trabajador',
    description: 'Vincula los equipos de protección personal asignados al trabajador seleccionado.',
    context: ['workers', 'epp'],
    icon: 'Link',
    priority: 'high',
  },
  {
    id: 'suggest-normatives-for-project',
    label: 'Sugerir normativas del proyecto',
    description: 'Identifica normativas aplicables según los riesgos y contexto del proyecto.',
    context: ['risks', 'audits', 'general'],
    icon: 'BookOpen',
    priority: 'medium',
  },
  {
    id: 'link-industry-to-project',
    label: 'Vincular industria al proyecto',
    description: 'Asocia la industria correspondiente para afinar análisis y recomendaciones.',
    context: ['general', 'risks'],
    icon: 'Building2',
    priority: 'medium',
  },
  {
    id: 'suggest-epp-for-worker',
    label: 'Sugerir EPP para el trabajador',
    description: 'Recomienda equipos de protección personal según el perfil y los riesgos del trabajador.',
    context: ['workers', 'epp'],
    icon: 'Shield',
    priority: 'high',
  },
  {
    id: 'auto-link-training-to-worker',
    label: 'Asignar capacitación pendiente',
    description: 'Detecta y asigna automáticamente las capacitaciones pendientes para el trabajador.',
    context: ['training', 'workers'],
    icon: 'GraduationCap',
    priority: 'high',
  },
];

// ---------------------------------------------------------------------------
// Legacy module type (preserved)
// ---------------------------------------------------------------------------

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
  // Fase 5 D2 slice 1 — SafeDriving (incidentes) re-pathed from
  // /safe-driving to /driving-incidents; same knowledge-module context.
  if (pathname.startsWith('/driving-incidents')) return 'safe_driving';
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

  // --- Legacy URL-based module detection ---
  const currentModule = useMemo<ModuleType>(
    () => deriveModule(location.pathname),
    [location.pathname]
  );

  const currentEntityId = useMemo<string | undefined>(
    () => deriveEntityId(location.pathname),
    [location.pathname]
  );

  // --- New URL-based context detection ---
  const currentContext = useMemo<URLContext>(
    () => detectContextFromURL(location.pathname),
    [location.pathname]
  );

  // --- Context-filtered smart actions (new) ---
  const smartActions = useMemo<SmartAction[]>(
    () => SMART_ACTIONS.filter(action => action.context.includes(currentContext)),
    [currentContext]
  );

  // Auto-show panel when there are relevant actions for a non-general context
  const [smartPanelVisible, setSmartPanelVisible] = useState(false);

  useEffect(() => {
    if (smartActions.length > 0 && currentContext !== 'general') {
      setSmartPanelVisible(true);
    }
  }, [smartActions.length, currentContext]);

  // --- Node-graph–derived actions (legacy, renamed to nodeSmartActions) ---
  const nodeSmartActions = useMemo<NodeSmartAction[]>(() => {
    const actions: NodeSmartAction[] = [];

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

  // suggestedActions = nodeSmartActions filtered/sorted by currentModule relevance
  const suggestedActions = useMemo<NodeSmartAction[]>(() => {
    const moduleRelevance: Partial<Record<ModuleType, SmartActionType[]>> = {
      risk_network: ['link_risk_to_control', 'create_incident_node', 'escalate_to_supervisor'],
      workers: ['assign_training', 'link_worker_to_epp'],
      training: ['assign_training'],
      findings: ['escalate_to_supervisor', 'create_incident_node'],
      safe_driving: ['escalate_to_supervisor'],
      dashboard: ['link_risk_to_control', 'assign_training', 'create_incident_node'],
    };
    const relevant = moduleRelevance[currentModule] ?? [];
    const sorted = [...nodeSmartActions].sort((a, b) => {
      const aRelevant = relevant.includes(a.type) ? 0 : 1;
      const bRelevant = relevant.includes(b.type) ? 0 : 1;
      if (aRelevant !== bRelevant) return aRelevant - bRelevant;
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    return sorted;
  }, [nodeSmartActions, currentModule]);

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

        // 1. Find Risks without controls (Orphan Risks) — unified edge-based
        //    definition (matches nodeSmartActions). A risk is orphan only if it
        //    has NO connection edge to any CONTROL node.  Previously this
        //    checked metadata.controles (free-text), which produced false
        //    positives when a risk was properly mitigated via graph edges but
        //    the text field was empty.
        const controlNodeIds = new Set(
          fetchedNodes.filter(n => n.type === NodeType.CONTROL).map(n => n.id)
        );
        const detectedOrphanRisks = fetchedNodes.filter(node =>
          node.type === NodeType.RISK &&
          !node.connections.some(cid => controlNodeIds.has(cid))
        );
        setOrphanRisks(detectedOrphanRisks);

        // 2. Find Workers without any training (Orphan Workers)
        const trainedWorkerIds = new Set(trainings.flatMap(t => t.attendees || []));
        const detectedOrphanWorkers = workers.filter(w => !trainedWorkerIds.has(w.id));
        setOrphanWorkers(detectedOrphanWorkers);

        // Create orphan notifications — ONE query per type (not per orphan) +
        // a single writeBatch. Previously this fired a getDocs PER orphan
        // (N+1) and an addDoc per miss, on a hook mounted app-wide. Now we
        // read all existing orphan_risk / orphan_worker notifs once each,
        // diff via buildOrphanNotifications (pure), and commit the misses
        // in one atomic batch.
        const notifsCol = collection(db, `projects/${selectedProject.id}/notifications`);
        const [orphanRiskNotifs, orphanWorkerNotifs] = await Promise.all([
          getDocs(query(notifsCol, where('type', '==', 'orphan_risk'))),
          getDocs(query(notifsCol, where('type', '==', 'orphan_worker'))),
        ]);
        const existingRiskIds = new Set(
          orphanRiskNotifs.docs.map(d => (d.data() as { relatedId?: string }).relatedId),
        );
        const existingWorkerIds = new Set(
          orphanWorkerNotifs.docs.map(d => (d.data() as { relatedId?: string }).relatedId),
        );

        const toCreate = buildOrphanNotifications(
          detectedOrphanRisks,
          detectedOrphanWorkers,
          existingRiskIds,
          existingWorkerIds,
        );

        if (toCreate.length > 0) {
          const batch = writeBatch(db);
          for (const notif of toCreate) {
            batch.set(doc(notifsCol), {
              ...notif,
              read: false,
              createdAt: serverTimestamp(),
            });
          }
          await batch.commit();
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
    // Legacy / node-graph
    isAnalyzing,
    orphanRisks,
    orphanWorkers,
    nodeSmartActions,
    suggestedActions,
    currentModule,
    currentEntityId,
    // New / URL-context
    currentContext,
    smartActions,
    smartPanelVisible,
    setSmartPanelVisible,
  };
}
