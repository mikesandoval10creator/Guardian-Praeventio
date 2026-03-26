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
  ShieldCheck
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { Worker, NodeType, ZettelkastenNode } from '../types';
import { where } from 'firebase/firestore';
import { analyzeAttendancePatterns } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { QRScannerModal } from '../components/QRScannerModal';

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

export function Attendance() {
  const { selectedProject } = useProject();
  const { addNode, addConnection } = useZettelkasten();
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isQRScannerOpen, setIsQRScannerOpen] = useState(false);
  const [accessResult, setAccessResult] = useState<{ worker: Worker, passed: boolean, reasons: string[] } | null>(null);

  // Fetch workers for the current project
  const { data: workers, loading: loadingWorkers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : 'workers'
  );

  // Fetch attendance nodes (Registro de Tiempo)
  const { data: attendanceNodes } = useFirestoreCollection<ZettelkastenNode>(
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
    w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const evaluateWorkerAccess = (worker: Worker) => {
    const reasons: string[] = [];
    
    // 1. Check medical clearance
    if (worker.medicalClearanceDate) {
      const clearanceDate = new Date(worker.medicalClearanceDate);
      if (clearanceDate < new Date()) {
        reasons.push('Examen médico de aptitud vencido');
      }
    }

    // 2. Check EPPs
    if (worker.requiredEPP && worker.requiredEPP.length > 0) {
      const missingEPP = worker.requiredEPP.filter(epp => !worker.eppIds?.includes(epp));
      if (missingEPP.length > 0) {
        reasons.push(`Falta EPP obligatorio: ${missingEPP.join(', ')}`);
      }
    }

    // 3. Check Certifications based on role
    const roleLower = worker.role.toLowerCase();
    if (roleLower.includes('altura') || roleLower.includes('eléctrico') || roleLower.includes('soldador')) {
      if (!worker.certifications || worker.certifications.length === 0) {
        reasons.push('Falta certificación técnica para el cargo');
      }
    }

    // For demonstration purposes: if the worker's name includes "Demo Block", force a block
    if (worker.name.toLowerCase().includes('demo block')) {
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
    
    try {
      // Evaluate Access (Torniquete Virtual)
      const evaluation = evaluateWorkerAccess(worker);
      setAccessResult({ worker, passed: evaluation.passed, reasons: evaluation.reasons });

      if (!evaluation.passed) {
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

      const now = new Date();
      
      // 1. Save to dedicated attendance collection
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/attendance`), {
        workerId: worker.id,
        workerName: worker.name,
        type: 'Check-In',
        timestamp: now.toISOString(),
        location: 'Torniquete Principal',
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });

      // 2. Save to Zettelkasten (Red Neuronal)
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
      
      // 1. Save to dedicated attendance collection
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/attendance`), {
        workerId: worker.id,
        workerName: worker.name,
        type: 'Check-Out',
        timestamp: now.toISOString(),
        location: 'Torniquete Principal',
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });

      // 2. Save to Zettelkasten (Red Neuronal)
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
            <h1 className="text-xl sm:text-3xl font-black text-zinc-950 uppercase tracking-tighter leading-tight">Torniquete Virtual</h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Control de Acceso Inteligente</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
          <button 
            onClick={handleAnalyzeAttendance}
            disabled={analyzing || attendanceNodes.length === 0}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-3 sm:py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50 justify-center w-full sm:w-auto"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Analizar Patrones IA</span>
          </button>
          <div className="flex gap-2 w-full sm:w-auto">
            <button 
              onClick={() => setIsQRScannerOpen(true)}
              className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-3 sm:py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-black/20 active:scale-95 transition-all flex-1 sm:flex-none justify-center"
            >
              <QrCode className="w-4 h-4" />
              <span>Escanear QR</span>
            </button>
            <button className="flex items-center gap-2 bg-white border border-zinc-200 text-zinc-900 px-4 py-3 sm:py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-sm active:scale-95 transition-all flex-1 sm:flex-none justify-center">
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
                accessResult.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
              }`}
            >
              <div className={`p-6 text-center ${accessResult.passed ? 'bg-emerald-500' : 'bg-rose-500'}`}>
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
              
              <div className="p-6 bg-white">
                {!accessResult.passed ? (
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-zinc-900 uppercase tracking-widest text-center mb-4">Motivos de Bloqueo:</p>
                    <ul className="space-y-2">
                      {accessResult.reasons.map((reason, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-rose-600 bg-rose-50 p-3 rounded-xl border border-rose-100">
                          <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                          <span className="font-medium">{reason}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-zinc-500 text-center mt-4">
                      Este incidente ha sido registrado automáticamente en la Red Neuronal.
                    </p>
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <p className="text-sm font-bold text-emerald-600 uppercase tracking-widest">Validación Exitosa</p>
                    <p className="text-sm text-zinc-600">Exámenes médicos, EPP y certificaciones al día.</p>
                  </div>
                )}
                
                <button 
                  onClick={() => setAccessResult(null)}
                  className={`w-full mt-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${
                    accessResult.passed 
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                      : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
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
          className="bg-emerald-50 border border-emerald-100 rounded-2xl sm:rounded-[32px] p-4 sm:p-8 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-2 sm:p-4">
            <button onClick={() => setAnalysis(null)} className="text-emerald-400 hover:text-emerald-600">
              <XCircle className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-xl sm:rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm shrink-0">
              <BrainCircuit className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-emerald-900 uppercase tracking-tight leading-tight">Análisis de Patrones de Asistencia</h3>
              <p className="text-[9px] sm:text-[10px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">Insights generados por El Guardián AI</p>
            </div>
          </div>
          <div className="markdown-body prose prose-emerald prose-sm sm:prose-base max-w-none">
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
          <div key={i} className={`bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-zinc-100 shadow-sm flex items-center gap-3 sm:gap-4 ${stat.className || ''}`}>
            <div className={`w-10 h-10 sm:w-12 sm:h-12 ${stat.bg} rounded-xl flex items-center justify-center shrink-0`}>
              <stat.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[9px] sm:text-[10px] font-black text-zinc-400 uppercase tracking-widest leading-tight">{stat.label}</p>
              <h3 className="text-xl sm:text-2xl font-black text-zinc-900 mt-0.5">{stat.value}</h3>
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
            className="w-full bg-white border border-zinc-200 rounded-xl sm:rounded-2xl py-2.5 sm:py-3 pl-10 sm:pl-11 pr-4 text-xs sm:text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 rounded-xl sm:rounded-2xl px-4 py-2.5 sm:py-3 transition-all text-xs font-bold w-full sm:w-auto">
          <Filter className="w-4 h-4" />
          <span>Filtros Avanzados</span>
        </button>
      </div>

      {/* Workers List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {loadingWorkers ? (
          <div className="col-span-full flex flex-col items-center justify-center py-12 sm:py-20 gap-3 sm:gap-4">
            <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-500 animate-spin" />
            <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-400">Cargando Dotación...</p>
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
                className="bg-white border border-zinc-100 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-zinc-100 flex items-center justify-center overflow-hidden border border-zinc-200 shrink-0">
                      {worker.photoUrl ? (
                        <img src={worker.photoUrl} alt={worker.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base sm:text-lg font-black text-zinc-400">{worker.name[0]}</span>
                      )}
                    </div>
                    <div>
                      <h3 className="font-black text-zinc-900 text-xs sm:text-sm uppercase tracking-tight leading-tight">{worker.name}</h3>
                      <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{worker.role}</p>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded-md sm:rounded-lg text-[7px] sm:text-[8px] font-black uppercase tracking-widest shrink-0 ${
                    status === 'Dentro' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                  }`}>
                    {status}
                  </div>
                </div>

                <div className="flex gap-2">
                  {status === 'Fuera' ? (
                    <button
                      onClick={() => handleCheckIn(worker)}
                      disabled={isProcessing}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 sm:gap-2 transition-all shadow-lg shadow-emerald-500/20"
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <ShieldCheck className="w-3 h-3 sm:w-4 sm:h-4" />}
                      Validar Ingreso
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCheckOut(worker)}
                      disabled={isProcessing}
                      className="flex-1 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white py-2.5 sm:py-3 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 sm:gap-2 transition-all shadow-lg shadow-rose-500/20"
                    >
                      {isProcessing ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <UserX className="w-3 h-3 sm:w-4 sm:h-4" />}
                      Salida
                    </button>
                  )}
                  <button className="w-10 sm:w-12 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all shrink-0">
                    <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="col-span-full text-center py-12 sm:py-20 bg-zinc-50 rounded-2xl sm:rounded-3xl border border-dashed border-zinc-200">
            <UserX className="w-10 h-10 sm:w-12 sm:h-12 text-zinc-200 mx-auto mb-3 sm:mb-4" />
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

