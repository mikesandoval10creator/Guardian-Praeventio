import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, 
  UserCheck, 
  UserX, 
  Calendar, 
  Search, 
  Filter, 
  ArrowRight, 
  CheckCircle2, 
  XCircle,
  QrCode,
  Loader2,
  BrainCircuit,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  Unlock,
  Lock,
  Activity,
  HeartPulse,
  Fingerprint
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useProject } from '../contexts/ProjectContext';
import { Worker, NodeType, RiskNode } from '../types';
import { where } from 'firebase/firestore';
import { analyzeAttendancePatterns } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { QRScannerModal } from '../components/QRScannerModal';

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function Attendance() {
  const { selectedProject } = useProject();
  const { addNode, addConnection, getConnectedNodes } = useRiskEngine();
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [accessResult, setAccessResult] = useState<{ worker: Worker, passed: boolean, reasons: string[] } | null>(null);
  const [accessState, setAccessState] = useState<'idle' | 'scanning' | 'granted' | 'missing_skill'>('idle');
  const [activeWorker, setActiveWorker] = useState<Worker | null>(null);
  const isOnline = useOnlineStatus();

  // Fetch workers for the current project
  const { data: workers, loading: loadingWorkers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : 'workers'
  );

  // Fetch attendance nodes (Registro de Tiempo)
  const { data: attendanceNodes } = useFirestoreCollection<RiskNode>(
    'nodes',
    selectedProject ? [
      where('projectId', '==', selectedProject.id),
      where('type', '==', NodeType.ATTENDANCE)
    ] : []
  );

  const handleAnalyzeAttendance = async () => {
    if (!selectedProject || attendanceNodes.length === 0) return;
    setAnalyzing(true);
    try {
      const context = attendanceNodes
        .slice(0, 50)
        .map(n => `- [${n.metadata?.type}] ${n.title} en ${n.metadata?.timestamp}`)
        .join('\n');
      
      const result = await analyzeAttendancePatterns(selectedProject.name, context);
      setAnalysis(result);
    } catch (error) {
      console.error('Error analyzing attendance:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredWorkers = workers.filter(w => 
    (w.name || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
    (w.role || '').toLowerCase().includes(String(searchTerm || '').toLowerCase())
  );

  const evaluateWorkerAccess = (worker: Worker) => {
    const reasons: string[] = [];
    
    if (!worker.nodeId) {
      reasons.push('Trabajador no está vinculado a la red neuronal (Sin Node ID)');
      return { passed: false, reasons };
    }

    const connectedNodes = getConnectedNodes(worker.nodeId);
    
    // 1. Check Medical Clearance (MEDICINE nodes)
    const medicineNodes = connectedNodes.filter(n => n.type === NodeType.MEDICINE);
    if (medicineNodes.length === 0) {
      reasons.push('No registra exámenes médicos ocupacionales');
    } else {
      const hasValidExam = medicineNodes.some(exam => {
        const isApproved = exam.metadata?.status === 'Aprobado' || exam.metadata?.status === 'Apto';
        const expirationDate = exam.metadata?.expirationDate ? new Date(exam.metadata.expirationDate) : null;
        const isNotExpired = expirationDate ? expirationDate > new Date() : true;
        return isApproved && isNotExpired;
      });
      
      if (!hasValidExam) {
        reasons.push('Examen médico de aptitud vencido o reprobado');
      }
    }

    // 2. Check EPPs (EPP nodes)
    if (worker.requiredEPP && worker.requiredEPP.length > 0) {
      const assignedEPPNodes = connectedNodes.filter(n => n.type === NodeType.EPP);
      const assignedEPPCategories = assignedEPPNodes.map(n => n.metadata?.category || '');
      
      const missingEPP = worker.requiredEPP.filter(epp => 
        !assignedEPPCategories.includes(epp) && !worker.eppIds?.includes(epp)
      );
      
      if (missingEPP.length > 0) {
        reasons.push(`Falta EPP obligatorio: ${missingEPP.join(', ')}`);
      }
    }

    // 3. Check Certifications/Training based on role
    const roleLower = String(worker.role || '').toLowerCase();
    if (roleLower.includes('altura') || roleLower.includes('eléctrico') || roleLower.includes('soldador') || roleLower.includes('operador')) {
      const trainingNodes = connectedNodes.filter(n => n.type === NodeType.TRAINING || n.type === NodeType.DOCUMENT);
      if (trainingNodes.length === 0) {
        reasons.push('Falta certificación técnica o capacitación para el cargo');
      }
    }

    // For demonstration purposes: if the worker's name includes "Demo Block", force a block
    if (String(worker.name || '').toLowerCase().includes('demo block')) {
      reasons.push('Bloqueo de demostración activado');
    }

    return {
      passed: reasons.length === 0,
      reasons
    };
  };

  const handleCheckIn = async (worker: Worker) => {
    if (!selectedProject || !worker.nodeId) return;
    setLoadingAction(worker.id);
    setActiveWorker(worker);
    setAccessState('scanning');
    
    try {
      // Simulate scanning delay for UX
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Evaluate Access (Torniquete Virtual)
      const evaluation = evaluateWorkerAccess(worker);
      setAccessResult({ worker, passed: evaluation.passed, reasons: evaluation.reasons });

      if (!evaluation.passed) {
        setAccessState('missing_skill');
        // Log the denied access to the Neural Network
        await addNode({
          type: NodeType.INCIDENT,
          title: `Acceso Denegado: ${worker.name}`,
          description: `Se denegó el acceso al trabajador por incumplimiento de requisitos: ${evaluation.reasons.join(', ')}`,
          tags: ['Control de Acceso', 'Bloqueo', worker.name],
          projectId: selectedProject.id,
          connections: [worker.nodeId],
          metadata: {
            workerId: worker.id,
            type: 'Access-Denied',
            reasons: evaluation.reasons,
            timestamp: new Date().toISOString()
          }
        });
        setLoadingAction(null);
        return; // Stop check-in
      }

      setAccessState('granted');
      const now = new Date();
      
      const { handleFirestoreError, OperationType } = await import('../services/firebase');
      
      let docRef;
      try {
        // 1. Save to dedicated attendance collection
        docRef = await addDoc(collection(db, `projects/${selectedProject.id}/attendance`), {
          workerId: worker.id,
          workerName: worker.name,
          type: 'Check-In',
          timestamp: now.toISOString(),
          location: 'Torniquete Principal',
          projectId: selectedProject.id,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `projects/${selectedProject.id}/attendance`);
        return;
      }

      // 2. Save to Risk Network (Red Neuronal)
      const attendanceNode = await addNode({
        type: NodeType.ATTENDANCE,
        title: `Ingreso Autorizado: ${worker.name}`,
        description: `Registro de ingreso validado por IA a las ${now.toLocaleTimeString()} el ${now.toLocaleDateString()}`,
        tags: ['Asistencia', 'Ingreso', worker.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          attendanceId: docRef.id,
          workerId: worker.id,
          workerNodeId: worker.nodeId,
          type: 'Check-In',
          timestamp: now.toISOString(),
          location: 'Torniquete Principal'
        }
      });

      if (attendanceNode) {
        await addConnection(worker.nodeId, attendanceNode.id);
      }
    } catch (error) {
      console.error('Error in check-in:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCheckOut = async (worker: Worker) => {
    if (!selectedProject || !worker.nodeId) return;
    setLoadingAction(worker.id);
    
    try {
      const now = new Date();
      
      const { handleFirestoreError, OperationType } = await import('../services/firebase');
      
      let docRef;
      try {
        // 1. Save to dedicated attendance collection
        docRef = await addDoc(collection(db, `projects/${selectedProject.id}/attendance`), {
          workerId: worker.id,
          workerName: worker.name,
          type: 'Check-Out',
          timestamp: now.toISOString(),
          location: 'Torniquete Principal',
          projectId: selectedProject.id,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `projects/${selectedProject.id}/attendance`);
        return;
      }

      // 2. Save to Risk Network (Red Neuronal)
      const attendanceNode = await addNode({
        type: NodeType.ATTENDANCE,
        title: `Salida: ${worker.name}`,
        description: `Registro de salida a las ${now.toLocaleTimeString()} el ${now.toLocaleDateString()}`,
        tags: ['Asistencia', 'Salida', worker.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          attendanceId: docRef.id,
          workerId: worker.id,
          workerNodeId: worker.nodeId,
          type: 'Check-Out',
          timestamp: now.toISOString(),
          location: 'Torniquete Principal'
        }
      });

      if (attendanceNode) {
        await addConnection(worker.nodeId, attendanceNode.id);
      }
    } catch (error) {
      console.error('Error in check-out:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const getStatus = (workerId: string) => {
    const workerAttendance = attendanceNodes
      .filter(n => n.metadata?.workerId === workerId)
      .sort((a, b) => new Date(b.metadata?.timestamp).getTime() - new Date(a.metadata?.timestamp).getTime());
    
    if (workerAttendance.length === 0) return 'Fuera';
    return workerAttendance[0].metadata?.type === 'Check-In' ? 'Dentro' : 'Fuera';
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full overflow-hidden box-border">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
            <ShieldCheck className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-black text-zinc-950 dark:text-white uppercase tracking-tighter leading-tight">Torniquete Virtual</h1>
            <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Control de Acceso Inteligente</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
          <button 
            onClick={handleAnalyzeAttendance}
            disabled={analyzing || attendanceNodes.length === 0 || !isOnline}
            title={!isOnline ? 'Requiere conexión a internet' : ''}
            className={`flex items-center gap-2 px-4 py-3 sm:py-2.5 rounded-xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all disabled:opacity-50 justify-center w-full sm:w-auto ${
              !isOnline ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
            }`}
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : !isOnline ? <WifiOff className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
            <span>{!isOnline ? 'Requiere Conexión' : 'Analizar Patrones IA'}</span>
          </button>
          <div className="flex gap-2 w-full sm:w-auto">
            <button 
              onClick={() => setIsQRScannerOpen(true)}
              className="flex items-center gap-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-3 sm:py-2.5 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-black/20 dark:shadow-white/20 active:scale-95 transition-all flex-1 sm:flex-none justify-center"
            >
              <QrCode className="w-4 h-4" />
              <span>Escanear QR</span>
            </button>
            <button className="flex items-center gap-2 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white px-4 py-3 sm:py-2.5 rounded-xl font-black uppercase tracking-widest text-xs shadow-sm active:scale-95 transition-all flex-1 sm:flex-none justify-center">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Reporte Diario</span>
              <span className="sm:hidden">Reporte</span>
            </button>
          </div>
        </div>
      </div>

      {/* Access Result Modal */}
      <AnimatePresence>
        {accessResult && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className={`w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border ${
                accessResult.passed ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/20' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-500/20'
              }`}
            >
              <div className={`p-6 text-center ${accessResult.passed ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-rose-500 dark:bg-rose-600'}`}>
                <div className="w-20 h-20 mx-auto bg-white/20 rounded-full flex items-center justify-center mb-4 backdrop-blur-md">
                  {accessResult.passed ? (
                    <CheckCircle2 className="w-10 h-10 text-white" />
                  ) : (
                    <ShieldAlert className="w-10 h-10 text-white" />
                  )}
                </div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tight">
                  {accessResult.passed ? 'Acceso Permitido' : 'Acceso Denegado'}
                </h2>
                <p className="text-white/80 text-sm font-medium mt-1">{accessResult.worker.name}</p>
              </div>
              
              <div className="p-6 bg-white dark:bg-zinc-900">
                {!accessResult.passed ? (
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest text-center mb-4">Motivos de Bloqueo:</p>
                    <ul className="space-y-2">
                      {accessResult.reasons.map((reason, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 p-3 rounded-xl border border-rose-100 dark:border-rose-500/20">
                          <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                          <span className="font-medium">{reason}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center mt-4">
                      Este incidente ha sido registrado automáticamente en la Red Neuronal.
                    </p>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Validación Exitosa</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">Exámenes médicos, EPP y certificaciones al día.</p>
                  </div>
                )}
                
                <button 
                  onClick={() => setAccessResult(null)}
                  className={`w-full mt-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${
                    accessResult.passed 
                      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/30' 
                      : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-500/30'
                  }`}
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {analysis && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/10 rounded-2xl sm:rounded-[32px] p-4 sm:p-8 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-2 sm:p-4">
            <button onClick={() => setAnalysis(null)} className="text-emerald-400 dark:text-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400">
              <XCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white dark:bg-emerald-500/10 rounded-xl sm:rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-500 shadow-sm shrink-0">
              <BrainCircuit className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-emerald-900 dark:text-emerald-400 uppercase tracking-tight leading-tight">Análisis de Patrones de Asistencia</h3>
              <p className="text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-emerald-500/70 uppercase tracking-widest mt-0.5">Insights generados por El Guardián AI</p>
            </div>
          </div>
          <div className="markdown-body prose prose-emerald dark:prose-invert prose-sm sm:prose-base max-w-none">
            <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        </motion.div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: 'Presentes Hoy', value: workers.filter(w => getStatus(w.id) === 'Dentro').length, icon: UserCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Ausentes', value: workers.filter(w => getStatus(w.id) === 'Fuera').length, icon: UserX, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Total Dotación', value: workers.length, icon: UserCheck, color: 'text-blue-500', bg: 'bg-blue-500/10', className: 'col-span-2 md:col-span-1' },
        ].map((stat, i) => (
          <div key={i} className={`bg-white dark:bg-zinc-900/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-zinc-100 dark:border-white/5 shadow-sm flex items-center gap-3 sm:gap-4 ${stat.className || ''}`}>
            <div className={`w-10 h-10 sm:w-12 sm:h-12 ${stat.bg} rounded-xl flex items-center justify-center shrink-0`}>
              <stat.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs font-black text-zinc-400 uppercase tracking-widest leading-tight">{stat.label}</p>
              <h3 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white mt-0.5">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar trabajador..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl py-2.5 sm:py-3 pl-10 sm:pl-11 pr-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder:text-zinc-500"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl sm:rounded-2xl px-4 py-2.5 sm:py-3 transition-all text-xs font-bold w-full sm:w-auto">
          <Filter className="w-4 h-4" />
          <span>Filtros Avanzados</span>
        </button>
      </div>

      {/* Gamified HUD for Active Worker */}
      <AnimatePresence>
        {activeWorker && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 shadow-2xl relative overflow-hidden">
              {/* Scan Line Effect */}
              {accessState === 'scanning' && (
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/20 to-transparent w-full h-20"
                  animate={{ y: ['-100%', '500%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                />
              )}

              <div className="flex flex-col md:flex-row gap-8 relative z-10">
                {/* Avatar & Basic Info */}
                <div className="flex items-center gap-6">
                  <div className="relative">
                    <div className={`w-24 h-24 rounded-2xl flex items-center justify-center border-2 ${
                      accessState === 'granted' ? 'border-emerald-500 bg-emerald-500/10' :
                      accessState === 'missing_skill' ? 'border-rose-500 bg-rose-500/10' :
                      'border-zinc-700 bg-zinc-800'
                    }`}>
                      {activeWorker.photoUrl ? (
                        <img src={activeWorker.photoUrl} alt={activeWorker.name} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <span className="text-4xl font-black text-zinc-500">{activeWorker.name[0]}</span>
                      )}
                    </div>
                    {/* Status Badge */}
                    <div className="absolute -bottom-3 -right-3">
                      {accessState === 'granted' && (
                        <div className="bg-emerald-500 text-zinc-900 p-2 rounded-xl shadow-lg">
                          <Unlock className="w-5 h-5" />
                        </div>
                      )}
                      {accessState === 'missing_skill' && (
                        <div className="bg-rose-500 text-white p-2 rounded-xl shadow-lg">
                          <Lock className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight">{activeWorker.name}</h2>
                    <p className="text-emerald-400 font-mono text-sm uppercase tracking-widest">{activeWorker.role}</p>
                    
                    <div className="flex gap-4 mt-3">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <Activity className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">Nivel 12</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <HeartPulse className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">HP 100/100</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Validation Status */}
                <div className="flex-1 border-t md:border-t-0 md:border-l border-zinc-800 pt-6 md:pt-0 md:pl-8 flex flex-col justify-center">
                  {accessState === 'scanning' && (
                    <div className="flex items-center gap-4 text-zinc-400">
                      <Fingerprint className="w-8 h-8 animate-pulse text-emerald-500" />
                      <div>
                        <p className="font-bold uppercase tracking-widest text-sm">Validando Identidad...</p>
                        <p className="text-xs font-mono mt-1">Consultando Knowledge Graph</p>
                      </div>
                    </div>
                  )}

                  {accessState === 'granted' && (
                    <div className="space-y-2">
                      <p className="text-emerald-400 font-black uppercase tracking-widest text-lg">Acceso Concedido</p>
                      <p className="text-zinc-400 text-sm">Todas las conexiones (Edges) validadas correctamente.</p>
                      <button 
                        onClick={() => setActiveWorker(null)}
                        className="mt-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-colors"
                      >
                        Cerrar Panel
                      </button>
                    </div>
                  )}

                  {accessState === 'missing_skill' && accessResult && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-rose-500">
                        <ShieldAlert className="w-6 h-6" />
                        <p className="font-black uppercase tracking-widest text-lg">Acceso Denegado</p>
                      </div>
                      <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">
                        <p className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-2">Misión Requerida:</p>
                        <ul className="space-y-1">
                          {accessResult.reasons.map((reason, idx) => (
                            <li key={idx} className="text-sm text-zinc-300 flex items-start gap-2">
                              <span className="text-rose-500 mt-1">•</span>
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <button 
                        onClick={() => setActiveWorker(null)}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-colors"
                      >
                        Cerrar Panel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workers List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {loadingWorkers ? (
          <div className="col-span-full flex flex-col items-center justify-center py-12 sm:py-20 gap-3 sm:gap-4">
            <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-500 animate-spin" />
            <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-400">Cargando Dotación...</p>
          </div>
        ) : filteredWorkers.length > 0 ? (
          filteredWorkers.map((worker) => {
            const status = getStatus(worker.id);
            const isProcessing = loadingAction === worker.id;

            return (
              <motion.div
                key={worker.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-zinc-900/50 border border-zinc-100 dark:border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border border-zinc-200 dark:border-white/5 shrink-0">
                      {worker.photoUrl ? (
                        <img src={worker.photoUrl} alt={worker.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base sm:text-lg font-black text-zinc-400 dark:text-zinc-500">{worker.name[0]}</span>
                      )}
                    </div>
                    <div>
                      <h3 className="font-black text-zinc-900 dark:text-white text-sm sm:text-base uppercase tracking-tight leading-tight">{worker.name}</h3>
                      <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{worker.role}</p>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest shrink-0 ${
                    status === 'Dentro' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'bg-rose-500/10 text-rose-600 dark:text-rose-500'
                  }`}>
                    {status}
                  </div>
                </div>

                <div className="flex gap-2">
                  {status === 'Fuera' ? (
                    <button
                      onClick={() => handleCheckIn(worker)}
                      disabled={isProcessing}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 sm:gap-2 transition-all shadow-lg shadow-emerald-500/20"
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <ShieldCheck className="w-3 h-3 sm:w-4 sm:h-4" />}
                      Validar Ingreso
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCheckOut(worker)}
                      disabled={isProcessing}
                      className="flex-1 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 sm:gap-2 transition-all shadow-lg shadow-rose-500/20"
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <UserX className="w-3 h-3 sm:w-4 sm:h-4" />}
                      Salida
                    </button>
                  )}
                  <button className="w-10 sm:w-12 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all shrink-0">
                    <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="col-span-full text-center py-12 sm:py-20 bg-zinc-50 dark:bg-zinc-900/30 rounded-2xl sm:rounded-3xl border border-dashed border-zinc-200 dark:border-white/10">
            <UserX className="w-10 h-10 sm:w-12 sm:h-12 text-zinc-200 dark:text-zinc-700 mx-auto mb-3 sm:mb-4" />
            <p className="text-xs sm:text-sm font-bold text-zinc-400 uppercase tracking-widest">No se encontraron trabajadores</p>
          </div>
        )}
      </div>

      <QRScannerModal
        isOpen={isQRScannerOpen}
        onClose={() => setIsQRScannerOpen(false)}
        onScan={async (decodedText) => {
          // Assuming the QR code contains the worker's ID
          const worker = workers.find(w => w.id === decodedText);
          if (worker) {
            const status = getStatus(worker.id);
            if (status === 'Fuera') {
              await handleCheckIn(worker);
            } else {
              await handleCheckOut(worker);
            }
          } else {
            alert('Trabajador no encontrado en este proyecto.');
          }
        }}
      />
    </div>
  );
}

