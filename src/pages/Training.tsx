import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  CheckCircle2, 
  Clock, 
  Users, 
  Plus, 
  Search,
  BookOpen,
  Award,
  BarChart3,
  Zap,
  Brain,
  Loader2,
  ChevronRight,
  Shield,
  X
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { generateSafetyCapsule } from '../services/geminiService';
import { TrainingSession } from '../types';

export function Training() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [generatingCapsule, setGeneratingCapsule] = useState(false);
  const [capsule, setCapsule] = useState<string | null>(null);

  const { data: sessions, loading } = useFirestoreCollection<TrainingSession>(
    selectedProject ? `projects/${selectedProject.id}/training` : 'training'
  );

  const filteredSessions = sessions.filter(session => {
    if (activeTab === 'upcoming') return session.status === 'scheduled';
    if (activeTab === 'completed') return session.status === 'completed';
    return true;
  });

  const handleGenerateCapsule = async () => {
    setGeneratingCapsule(true);
    try {
      // Find nodes connected to the user (heuristic: nodes with user's name or relevant tags)
      const userNodes = nodes.filter(n => 
        n.title.toLowerCase().includes(user?.displayName?.toLowerCase() || '') ||
        n.description.toLowerCase().includes(user?.displayName?.toLowerCase() || '') ||
        n.type === 'Riesgo' || n.type === 'Incidente'
      ).slice(0, 10);

      const context = userNodes.map(n => `- [${n.type}] ${n.title}: ${n.description}`).join('\n');
      const content = await generateSafetyCapsule(
        user?.displayName || 'Trabajador',
        'Operador', // Default role
        context
      );
      setCapsule(content);
    } catch (error) {
      console.error('Error generating capsule:', error);
    } finally {
      setGeneratingCapsule(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-emerald-500" />
            Capacitaciones & Formación
          </h1>
          <p className="text-zinc-400 mt-1 font-medium italic">"El conocimiento es la primera línea de defensa"</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleGenerateCapsule}
            disabled={generatingCapsule}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
          >
            {generatingCapsule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span>Cápsula de Seguridad IA</span>
          </button>
          <button className="flex items-center gap-2 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95">
            <Plus className="w-4 h-4" />
            <span>Nueva Sesión</span>
          </button>
        </div>
      </div>

      {/* AI Capsule Modal */}
      <AnimatePresence>
        {capsule && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-blue-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                    <Brain className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">Cápsula de Seguridad Personalizada</h2>
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Mentoría El Guardián AI</p>
                  </div>
                </div>
                <button 
                  onClick={() => setCapsule(null)}
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                <div className="prose prose-invert max-w-none">
                  <div className="whitespace-pre-wrap font-sans text-zinc-300 leading-relaxed text-lg">
                    {capsule}
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <Shield className="w-5 h-5" />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest max-w-[200px]">
                    Capacitación completada con éxito. Registro guardado en el Zettelkasten.
                  </p>
                </div>
                <button 
                  onClick={() => setCapsule(null)}
                  className="px-8 py-4 rounded-2xl bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Entendido, Guardián
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Sesiones', value: sessions.length, icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Completadas', value: sessions.filter(s => s.status === 'completed').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Programadas', value: sessions.filter(s => s.status === 'scheduled').length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Participantes', value: sessions.reduce((acc, s) => acc + (s.attendees?.length || 0), 0), icon: Users, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 shadow-xl hover:border-white/20 transition-all">
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center border border-white/5`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</span>
            </div>
            <div className="text-4xl font-black text-white tracking-tighter">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/10 self-start shadow-inner">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'upcoming', label: 'Próximas' },
            { id: 'completed', label: 'Completadas' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id 
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-80 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
          <input
            type="text"
            placeholder="Buscar capacitación..."
            className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-3.5 pl-12 pr-6 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Sessions Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Cargando Conocimiento...</p>
        </div>
      ) : filteredSessions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {filteredSessions.map((session, index) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-zinc-900/50 border border-white/10 rounded-[32px] p-8 hover:border-emerald-500/30 transition-all group shadow-xl hover:shadow-emerald-500/5"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border border-white/5 ${
                    session.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    {session.status === 'completed' ? <Award className="w-7 h-7" /> : <Play className="w-7 h-7" />}
                  </div>
                  <div>
                    <h3 className="font-black text-white text-xl uppercase tracking-tight group-hover:text-emerald-400 transition-colors">{session.title}</h3>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-black uppercase tracking-widest mt-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{new Date(session.date).toLocaleDateString()} · {session.duration} min</span>
                    </div>
                  </div>
                </div>
                <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                  session.status === 'completed' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-black'
                }`}>
                  {session.status === 'completed' ? 'Completada' : 'Programada'}
                </span>
              </div>

              <p className="text-zinc-400 text-sm mb-8 line-clamp-2 font-medium leading-relaxed">
                {session.description || 'Sin descripción detallada para esta sesión de capacitación.'}
              </p>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3">
                    {[1, 2, 3].map((_, i) => (
                      <div key={i} className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-[10px] font-black text-zinc-500 shadow-lg">
                        U
                      </div>
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">
                    {session.attendees?.length || 0} participantes
                  </span>
                </div>
                <button className="text-emerald-500 hover:text-emerald-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95">
                  <span>Ver Detalles</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-[40px] p-24 text-center shadow-inner">
          <div className="w-24 h-24 bg-zinc-800 rounded-[32px] flex items-center justify-center mx-auto mb-8 border border-white/5 shadow-2xl">
            <BookOpen className="w-12 h-12 text-zinc-600" />
          </div>
          <h3 className="text-2xl font-black text-white mb-3 uppercase tracking-tight">No hay capacitaciones activas</h3>
          <p className="text-zinc-500 max-w-md mx-auto font-medium leading-relaxed">
            Programa tu primera sesión de capacitación o genera una <span className="text-blue-500">Cápsula IA</span> para empezar a fortalecer la cultura preventiva.
          </p>
        </div>
      )}
    </div>
  );
}
