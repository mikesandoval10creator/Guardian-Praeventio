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
  Loader2
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

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
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('savedNormatives');
    return saved ? JSON.parse(saved) : [];
  });

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

  const toggleSave = () => {
    if (!id) return;
    setSavedIds(prev => {
      const newSaved = prev.includes(id) ? prev.filter(savedId => savedId !== id) : [...prev, id];
      localStorage.setItem('savedNormatives', JSON.stringify(newSaved));
      return newSaved;
    });
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
        <h2 className="text-2xl font-bold text-white mb-4">Normativa no encontrada</h2>
        <button 
          onClick={() => navigate('/normatives')}
          className="text-emerald-500 hover:text-emerald-400 font-medium"
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
        className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm font-bold uppercase tracking-widest">Volver</span>
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 md:p-12 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500" />
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5 shrink-0">
              <Book className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-emerald-500 font-bold uppercase tracking-widest text-sm">
                  {normative.code}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${
                  normative.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                }`}>
                  {normative.status === 'active' ? 'Vigente' : 'Actualizada'}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">
                {normative.title}
              </h1>
            </div>
          </div>
          
          <div className="flex gap-2 shrink-0">
            <button 
              onClick={toggleSave}
              className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center hover:bg-zinc-700 transition-colors group"
            >
              <Bookmark className={`w-5 h-5 ${savedIds.includes(normative.id) ? 'text-emerald-500 fill-emerald-500' : 'text-zinc-400 group-hover:text-emerald-400'}`} />
            </button>
            {normative.url && (
              <a 
                href={normative.url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white hover:bg-emerald-600 transition-colors"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-zinc-800/50 rounded-2xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <Tag className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Categoría</span>
            </div>
            <p className="text-white font-medium">{normative.category}</p>
          </div>
          <div className="bg-zinc-800/50 rounded-2xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Última Revisión</span>
            </div>
            <p className="text-white font-medium">
              {new Date(normative.lastReview).toLocaleDateString('es-CL')}
            </p>
          </div>
          <div className="bg-zinc-800/50 rounded-2xl p-4 border border-white/5">
            <div className="flex items-center gap-2 text-zinc-500 mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Estado Legal</span>
            </div>
            <p className="text-emerald-500 font-bold">Obligatorio</p>
          </div>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-500" />
              Descripción General
            </h2>
            <p className="text-zinc-400 leading-relaxed text-lg">
              {normative.description}
            </p>
          </section>

          <section className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6">
            <h2 className="text-lg font-black text-emerald-500 uppercase tracking-tight mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Impacto en Operaciones
            </h2>
            <p className="text-emerald-200/70 leading-relaxed">
              El incumplimiento de esta normativa puede resultar en sanciones por parte de la Dirección del Trabajo o SEREMI de Salud, además de aumentar significativamente el riesgo de accidentes laborales. Se recomienda integrar sus directrices en todos los Procedimientos de Trabajo Seguro (PTS).
            </p>
          </section>
        </div>
      </motion.div>
    </div>
  );
}
