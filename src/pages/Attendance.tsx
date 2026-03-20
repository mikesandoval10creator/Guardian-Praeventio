import React, { useState } from 'react';
import { motion } from 'framer-motion';
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
  Sparkles
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { Worker, NodeType, ZettelkastenNode } from '../types';
import { where } from 'firebase/firestore';
import { analyzeAttendancePatterns } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

export function Attendance() {
  const { selectedProject } = useProject();
  const { addNode, addConnection } = useZettelkasten();
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);

  // Fetch workers for the current project
  const { data: workers, loading: loadingWorkers } = useFirestoreCollection<Worker>(
    'workers',
    selectedProject ? [where('projectId', '==', selectedProject.id)] : []
  );

  // Fetch attendance nodes (Registro de Tiempo)
  const { data: attendanceNodes } = useFirestoreCollection<ZettelkastenNode>(
    'nodes',
    selectedProject ? [
      where('projectId', '==', selectedProject.id),
      where('type', '==', NodeType.TASK) // Using TASK as a base for attendance for now, or we could add a new type
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

  const handleCheckIn = async (worker: Worker) => {
    if (!selectedProject || !worker.nodeId) return;
    setLoadingAction(worker.id);
    
    try {
      const now = new Date();
      const attendanceNode = await addNode({
        type: NodeType.TASK, // Should ideally be a specific type like ATTENDANCE
        title: `Ingreso: ${worker.name}`,
        description: `Registro de ingreso a las ${now.toLocaleTimeString()} el ${now.toLocaleDateString()}`,
        tags: ['Asistencia', 'Ingreso', worker.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          workerId: worker.id,
          workerNodeId: worker.nodeId,
          type: 'Check-In',
          timestamp: now.toISOString(),
          location: 'Entrada Principal'
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
      const attendanceNode = await addNode({
        type: NodeType.TASK,
        title: `Salida: ${worker.name}`,
        description: `Registro de salida a las ${now.toLocaleTimeString()} el ${now.toLocaleDateString()}`,
        tags: ['Asistencia', 'Salida', worker.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          workerId: worker.id,
          workerNodeId: worker.nodeId,
          type: 'Check-Out',
          timestamp: now.toISOString(),
          location: 'Salida Principal'
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
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
            <Clock className="w-8 h-8 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-zinc-950 uppercase tracking-tighter">Control de Asistencia</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Gestión de Ingresos y Salidas en Tiempo Real</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleAnalyzeAttendance}
            disabled={analyzing || attendanceNodes.length === 0}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Analizar Patrones IA</span>
          </button>
          <button className="flex items-center gap-2 bg-zinc-900 text-white px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-black/20 active:scale-95 transition-all">
            <QrCode className="w-4 h-4" />
            <span>Escanear QR</span>
          </button>
          <button className="flex items-center gap-2 bg-white border border-zinc-200 text-zinc-900 px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-sm active:scale-95 transition-all">
            <Calendar className="w-4 h-4" />
            <span>Reporte Diario</span>
          </button>
        </div>
      </div>

      {analysis && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-50 border border-emerald-100 rounded-[32px] p-8 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-4">
            <button onClick={() => setAnalysis(null)} className="text-emerald-400 hover:text-emerald-600">
              <XCircle className="w-6 h-6" />
            </button>
          </div>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-emerald-900 uppercase tracking-tight">Análisis de Patrones de Asistencia</h3>
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Insights generados por El Guardián AI</p>
            </div>
          </div>
          <div className="markdown-body prose prose-emerald max-w-none">
            <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        </motion.div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Presentes Hoy', value: workers.filter(w => getStatus(w.id) === 'Dentro').length, icon: UserCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Ausentes', value: workers.filter(w => getStatus(w.id) === 'Fuera').length, icon: UserX, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Total Dotación', value: workers.length, icon: UserCheck, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-white rounded-3xl p-6 border border-zinc-100 shadow-sm flex items-center gap-4">
            <div className={`w-12 h-12 ${stat.bg} rounded-xl flex items-center justify-center`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{stat.label}</p>
              <h3 className="text-2xl font-black text-zinc-900">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Buscar trabajador..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-zinc-200 rounded-2xl py-3 pl-11 pr-4 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 rounded-2xl px-4 py-3 transition-all text-xs font-bold">
          <Filter className="w-4 h-4" />
          <span>Filtros Avanzados</span>
        </button>
      </div>

      {/* Workers List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loadingWorkers ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Cargando Dotación...</p>
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
                className="bg-white border border-zinc-100 rounded-3xl p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center overflow-hidden border border-zinc-200">
                      {worker.photoUrl ? (
                        <img src={worker.photoUrl} alt={worker.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg font-black text-zinc-400">{worker.name[0]}</span>
                      )}
                    </div>
                    <div>
                      <h3 className="font-black text-zinc-900 text-sm uppercase tracking-tight">{worker.name}</h3>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{worker.role}</p>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
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
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                      Ingreso
                    </button>
                  ) : (
                    <button
                      onClick={() => handleCheckOut(worker)}
                      disabled={isProcessing}
                      className="flex-1 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-500/20"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                      Salida
                    </button>
                  )}
                  <button className="w-12 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 rounded-2xl flex items-center justify-center transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="col-span-full text-center py-20 bg-zinc-50 rounded-3xl border border-dashed border-zinc-200">
            <UserX className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
            <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">No se encontraron trabajadores</p>
          </div>
        )}
      </div>
    </div>
  );
}
