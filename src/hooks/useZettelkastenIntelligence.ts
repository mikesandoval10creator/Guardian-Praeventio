import { useEffect, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { RiskNode, Worker, TrainingSession, NodeType } from '../types';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';

export function useZettelkastenIntelligence() {
  const { selectedProject } = useProject();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (!selectedProject) return;

    const analyzeOrphans = async () => {
      setIsAnalyzing(true);
      try {
        // Nodes from root collection (correct path — not a subcollection)
        const nodesSnap = await getDocs(
          query(collection(db, 'nodes'), where('projectId', '==', selectedProject.id))
        );
        const nodes = nodesSnap.docs.map(d => ({ id: d.id, ...d.data() } as RiskNode));

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
        const orphanRisks = nodes.filter(node =>
          node.type === NodeType.RISK &&
          (!node.metadata?.controles || node.metadata.controles.trim() === '')
        );

        // 2. Find Workers without any training (Orphan Workers)
        const trainedWorkerIds = new Set(trainings.flatMap(t => t.attendees || []));
        const orphanWorkers = workers.filter(w => !trainedWorkerIds.has(w.id));

        // Create notifications for orphan risks
        for (const risk of orphanRisks) {
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

    analyzeOrphans();
  }, [selectedProject]);

  return { isAnalyzing };
}
