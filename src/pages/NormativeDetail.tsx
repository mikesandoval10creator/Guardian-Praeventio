import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  ArrowLeft, 
  Book, 
  ExternalLink, 
  FileText, 
  ShieldCheck, 
  AlertTriangle,
  Bookmark,
  Calendar,
  Tag,
  Loader2,
  Wand2,
  CheckCircle2,
  WifiOff
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { generateOperationalTasks } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { get, set } from 'idb-keyval';

interface Normative {
  id: string;
  title: string;
  code: string;
  category: string;
  description: string;
  url?: string;
  status: 'active' | 'deprecated' | 'updated';
  lastReview: string;
}

export function NormativeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [normative, setNormative] = useState<Normative | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [operationalTasks, setOperationalTasks] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  
  useEffect(() => {
    const loadSaved = async () => {
      const saved = await get('savedNormatives');
      if (saved) setSavedIds(saved as string[]);
    };
    loadSaved();
  }, []);
  
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const fetchNormative = async () => {
      if (!id) return;
      try {
        const docRef = doc(db, 'normatives', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setNormative({ id: docSnap.id, ...docSnap.data() } as Normative);
        }
      } catch (error) {
        console.error('Error fetching normative:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchNormative();
  }, [id]);

  const toggleSave = async () => {
    if (!id) return;
    const newSaved = savedIds.includes(id) ? savedIds.filter(savedId => savedId !== id) : [...savedIds, id];
    setSavedIds(newSaved);
    await set('savedNormatives', newSaved);
  };

  const handleGenerateTasks = async () => {
    if (!normative) return;
    setIsGeneratingTasks(true);
    try {
      const tasks = await generateOperationalTasks(normative.title, normative.description);
      setOperationalTasks(tasks);
    } catch (error) {
      console.error('Error generating tasks:', error);
    } finally {
      setIsGeneratingTasks(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!normative) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-20">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white mb-4">Normativa no encontrada</h2>
        <button 
          onClick={() => navigate('/normatives')}
          className="text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 font-medium"
        >
          Volver a la biblioteca
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <button 
        onClick={() => navigate('/normatives')}
        className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm font-bold uppercase tracking-widest">Volver</span>
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-8 md:p-12 relative overflow-hidden shadow-sm"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500" />
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-emerald-500 border border-zinc-200 dark:border-white/5 shrink-0">
              <Book className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-emerald-600 dark:text-emerald-500 font-bold uppercase tracking-widest text-sm">
                  {normative.code}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                  normative.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500'
                }`}>
                  {normative.status === 'active' ? 'Vigente' : 'Actualizada'}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">
                {normative.title}
              </h1>
            </div>
          </div>
          
          <div className="flex gap-2 shrink-0">
            <button 
              onClick={toggleSave}
              className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors group"
            >
              <Bookmark className={`w-5 h-5 ${savedIds.includes(normative.id) ? 'text-emerald-500 fill-emerald-500' : 'text-zinc-400 dark:text-zinc-400 group-hover:text-emerald-500 dark:group-hover:text-emerald-400'}`} />
            </button>
            {normative.url && (
              <a 
                href={normative.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-colors shadow-sm"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 border border-zinc-200 dark:border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <Tag className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Categoría</span>
            </div>
            <p className="text-zinc-900 dark:text-white font-medium">{normative.category}</p>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 border border-zinc-200 dark:border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Última Revisión</span>
            </div>
            <p className="text-zinc-900 dark:text-white font-medium">
              {new Date(normative.lastReview).toLocaleDateString('es-CL')}
            </p>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 border border-zinc-200 dark:border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Estado Legal</span>
            </div>
            <p className="text-emerald-600 dark:text-emerald-500 font-bold">Obligatorio</p>
          </div>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-500" />
              Descripción General
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-lg">
              {normative.description}
            </p>
          </section>

          <section className="bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/10 rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-tight mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Impacto en Operaciones
            </h2>
            <p className="text-emerald-800 dark:text-emerald-200/70 leading-relaxed">
              El incumplimiento de esta normativa puede resultar en sanciones por parte de la Dirección del Trabajo o SEREMI de Salud, además de aumentar significativamente el riesgo de accidentes laborales. Se recomienda integrar sus directrices en todos los Procedimientos de Trabajo Seguro (PTS).
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-emerald-500" />
                Tareas Operativas (IA)
              </h2>
              <button
                onClick={handleGenerateTasks}
                disabled={isGeneratingTasks || !isOnline}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-zinc-100 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-500 text-white px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-sm"
              >
                {!isOnline ? (
                  <>
                    <WifiOff className="w-4 h-4" />
                    Requiere Conexión
                  </>
                ) : isGeneratingTasks ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Generar Tareas
                  </>
                )}
              </button>
            </div>

            {operationalTasks.length > 0 ? (
              <ul className="space-y-3">
                {operationalTasks.map((task, index) => (
                  <li key={index} className="flex items-start gap-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl p-4 shadow-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-zinc-700 dark:text-zinc-300">{task}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-8 bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl border border-dashed border-zinc-300 dark:border-white/10">
                <p className="text-zinc-500 text-sm">
                  Haz clic en "Generar Tareas" para traducir esta normativa en acciones operativas concretas usando IA.
                </p>
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </div>
  );
}
