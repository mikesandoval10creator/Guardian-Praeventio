import { useEffect, useState } from 'react';
import { useFirestoreCollection } from './useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { RiskNode, Worker, TrainingSession, NodeType } from '../types';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';

export function useZettelkastenIntelligence() {
  const { selectedProject } = useProject();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch all nodes for the current project
  const { data: nodes } = useFirestoreCollection<RiskNode>(
    selectedProject ? `projects/${selectedProject.id}/nodes` : null
  );

  // Fetch all workers
  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : null
  );

  // Fetch all trainings
  const { data: trainings } = useFirestoreCollection<TrainingSession>(
    selectedProject ? `projects/${selectedProject.id}/trainings` : null
  );

  useEffect(() => {
    if (!selectedProject || !nodes || !workers) return;

    const analyzeOrphans = async () => {
      setIsAnalyzing(true);
      try {
        // 1. Find Risks without controls (Orphan Risks)
        const orphanRisks = nodes.filter(node => 
          node.type === NodeType.RISK && 
          (!node.metadata?.controles || node.metadata.controles.trim() === '')
        );

        // 2. Find Workers without any training (Orphan Workers)
        const trainedWorkerIds = new Set(trainings?.flatMap(t => t.attendees) || []);
        const orphanWorkers = workers.filter(w => !trainedWorkerIds.has(w.id));

        // Create notifications for orphan risks
        for (const risk of orphanRisks) {
          // Check if notification already exists to avoid spam
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
        for (const worker of orphanWorkers) {
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
        console.error("Error analyzing Zettelkasten orphans:", error);
      } finally {
        setIsAnalyzing(false);
      }
    };

    // Run analysis periodically or when data changes significantly
    // For now, we'll run it once when the data loads
    analyzeOrphans();

  }, [selectedProject, nodes, workers, trainings]);

  return { isAnalyzing };
}
