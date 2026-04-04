import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Book, 
  Search, 
  ExternalLink, 
  FileText, 
  ShieldCheck, 
  AlertTriangle,
  Download,
  Filter,
  Bookmark,
  WifiOff
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { suggestNormativesWithAI } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

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

export function Normatives() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSeeding, setIsSeeding] = useState(false);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('savedNormatives');
    return saved ? JSON.parse(saved) : [];
  });
  const { data: normatives, loading } = useFirestoreCollection<Normative>('normatives');
  const { selectedProject } = useProject();
  const [industryProtocols, setIndustryProtocols] = useState<any[]>([]);
  const [loadingProtocols, setLoadingProtocols] = useState(false);
  const isOnline = useOnlineStatus();

  const loadIndustryProtocols = async () => {
    if (!selectedProject?.industry || !isOnline) return;
    setLoadingProtocols(true);
    try {
      // Use Gemini to suggest specific normatives for the industry
      const suggestions = await suggestNormativesWithAI(selectedProject.industry);
      setIndustryProtocols(suggestions);
    } catch (error) {
      console.error('Error loading industry protocols:', error);
    } finally {
      setLoadingProtocols(false);
    }
  };

  React.useEffect(() => {
    if (selectedProject?.industry && isOnline) {
      loadIndustryProtocols();
    }
  }, [selectedProject?.industry, isOnline]);

  const seedNormatives = async () => {
    setIsSeeding(true);
    try {
      const { addDoc, collection } = await import('firebase/firestore');
      const { db } = await import('../services/firebase');
      
      const initialNormatives = [
        {
          title: 'Ley 16.744: Seguro Social contra Riesgos de Accidentes del Trabajo y Enfermedades Profesionales',
          code: 'Ley 16.744',
          category: 'Seguridad Social',
          description: 'Establece normas sobre accidentes del trabajo y enfermedades profesionales. Es la piedra angular de la seguridad laboral en Chile.',
          status: 'active',
          lastReview: new Date().toISOString()
        },
        {
          title: 'Decreto Supremo 594: Reglamento sobre Condiciones Sanitarias y Ambientales Básicas en los Lugares de Trabajo',
          code: 'DS 594',
          category: 'Higiene y Salud',
          description: 'Establece las condiciones sanitarias y ambientales básicas que debe cumplir todo lugar de trabajo.',
          status: 'active',
          lastReview: new Date().toISOString()
        },
        {
          title: 'Decreto Supremo 40: Reglamento sobre Prevención de Riesgos Profesionales',
          code: 'DS 40',
          category: 'Prevención',
          description: 'Establece normas sobre la organización y funcionamiento de los Departamentos de Prevención de Riesgos.',
          status: 'active',
          lastReview: new Date().toISOString()
        },
        {
          title: 'Decreto Supremo 54: Reglamento para la Constitución y Funcionamiento de los Comités Paritarios de Higiene y Seguridad',
          code: 'DS 54',
          category: 'Comités Paritarios',
          description: 'Regula la formación y funciones de los Comités Paritarios en empresas con más de 25 trabajadores.',
          status: 'active',
          lastReview: new Date().toISOString()
        },
        {
          title: 'Decreto Supremo 18: Certificación de Calidad de Elementos de Protección Personal contra Riesgos Ocupacionales',
          code: 'DS 18',
          category: 'EPP',
          description: 'Establece normas sobre la certificación de calidad de los EPP comercializados en el país.',
          status: 'active',
          lastReview: new Date().toISOString()
        },
        {
          title: 'Ley 21.096: Consagra el Derecho a la Protección de Datos Personales',
          code: 'Ley 21.096',
          category: 'Privacidad',
          description: 'Regula el tratamiento de datos personales y crea la Agencia de Protección de Datos.',
          status: 'active',
          lastReview: new Date().toISOString()
        },
        {
          title: 'Ley 20.123: Regula Trabajo en Régimen de Subcontratación',
          code: 'Ley 20.123',
          category: 'Subcontratación',
          description: 'Establece las responsabilidades de la empresa principal en materia de seguridad y salud para trabajadores subcontratados.',
          status: 'active',
          lastReview: new Date().toISOString()
        }
      ];

      for (const norm of initialNormatives) {
        await addDoc(collection(db, 'normatives'), norm);
      }
      alert('Biblioteca sincronizada con éxito');
    } catch (error) {
      console.error('Error seeding normatives:', error);
    } finally {
      setIsSeeding(false);
    }
  };

  const toggleSave = (id: string) => {
    setSavedIds(prev => {
      const newSaved = prev.includes(id) ? prev.filter(savedId => savedId !== id) : [...prev, id];
      localStorage.setItem('savedNormatives', JSON.stringify(newSaved));
      return newSaved;
    });
  };

  const filteredNormatives = normatives.filter(norm => {
    const matchesSearch = norm.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          norm.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          norm.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSaved = showSavedOnly ? savedIds.includes(norm.id) : true;
    return matchesSearch && matchesSaved;
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">Normativas</h1>
          <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Biblioteca de leyes, decretos y estándares de seguridad</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button 
            onClick={seedNormatives}
            disabled={isSeeding || !isOnline}
            className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800 px-4 py-3 sm:py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 w-full sm:w-auto disabled:bg-zinc-100 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-500 disabled:shadow-none shadow-sm"
          >
            {!isOnline ? <WifiOff className="w-4 h-4" /> : isSeeding ? <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{!isOnline ? 'Requiere Conexión' : 'Sincronizar Biblioteca'}</span>
          </button>
          <button 
            onClick={() => setShowSavedOnly(!showSavedOnly)}
            className={`flex items-center justify-center gap-2 px-4 py-3 sm:py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 w-full sm:w-auto ${
              showSavedOnly 
                ? 'bg-emerald-500 text-white shadow-emerald-500/20' 
                : 'bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-white/10'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${showSavedOnly ? 'fill-current' : ''}`} />
            <span>Mis Guardados</span>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-8">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por título, código o categoría..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl py-3 sm:py-2.5 pl-10 pr-4 text-[10px] sm:text-xs text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium shadow-sm"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl py-3 sm:py-2.5 px-6 transition-all w-full md:w-auto text-[10px] font-black uppercase tracking-widest shadow-sm">
          <Filter className="w-4 h-4" />
          <span>Filtrar</span>
        </button>
      </div>

      {/* Dynamic Industry Protocols Section */}
      {selectedProject?.industry && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Protocolos Dinámicos: {selectedProject.industry}</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Normativas específicas detectadas para tu rubro</p>
            </div>
          </div>
          
          {!isOnline ? (
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-dashed border-zinc-300 dark:border-white/10 rounded-2xl p-8 flex flex-col items-center justify-center text-center">
              <WifiOff className="w-8 h-8 text-zinc-400 dark:text-zinc-600 mb-3" />
              <p className="text-sm font-bold text-zinc-600 dark:text-zinc-400">Conexión requerida</p>
              <p className="text-xs text-zinc-500 mt-1">Los protocolos dinámicos por IA no están disponibles sin conexión.</p>
            </div>
          ) : loadingProtocols ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-zinc-100 dark:bg-zinc-900/50 rounded-2xl border border-zinc-200 dark:border-white/5 animate-pulse" />
              ))}
            </div>
          ) : industryProtocols.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {industryProtocols.map((protocol, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-gradient-to-br from-blue-50 dark:from-blue-900/20 to-white dark:to-zinc-900/50 border border-blue-200 dark:border-blue-500/20 rounded-2xl p-5 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-widest border border-blue-200 dark:border-blue-500/20">
                      Específico
                    </span>
                    <AlertTriangle className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                  </div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-2 line-clamp-2">{protocol.title || 'Protocolo Específico'}</h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-3">{protocol.description}</p>
                </motion.div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Normatives List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
        </div>
      ) : filteredNormatives.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredNormatives.map((norm, index) => (
            <motion.div
              key={norm.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => navigate(`/normatives/${norm.id}`)}
              className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl p-6 hover:border-emerald-500/30 dark:hover:border-emerald-500/30 transition-all group relative overflow-hidden cursor-pointer shadow-sm"
            >
              <div className="absolute top-0 right-0 p-4 flex items-center gap-2">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSave(norm.id);
                  }}
                  className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors group/bookmark"
                >
                  <Bookmark className={`w-5 h-5 ${savedIds.includes(norm.id) ? 'text-emerald-500 fill-emerald-500' : 'text-zinc-400 dark:text-zinc-500 group-hover/bookmark:text-emerald-500 dark:group-hover/bookmark:text-emerald-400'}`} />
                </button>
                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                  norm.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500'
                }`}>
                  {norm.status === 'active' ? 'Vigente' : 'Actualizada'}
                </span>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-emerald-500 border border-zinc-200 dark:border-white/5">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-zinc-900 dark:text-white text-lg leading-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {norm.title}
                  </h3>
                  <p className="text-zinc-500 text-sm font-medium mt-1">{norm.code} · {norm.category}</p>
                </div>
              </div>

              <p className="text-zinc-600 dark:text-zinc-400 text-sm mb-6 line-clamp-3">
                {norm.description}
              </p>

              <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-white/5">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Cumplimiento</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    <span>Riesgos</span>
                  </div>
                </div>
                {norm.url && (
                  <a 
                    href={norm.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 text-sm font-bold transition-colors"
                  >
                    <span>Ver Documento</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-dashed border-zinc-300 dark:border-white/10 rounded-3xl p-20 text-center">
          <div className="w-20 h-20 bg-white dark:bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm">
            <Book className="w-10 h-10 text-zinc-400 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">No se encontraron normativas</h3>
          <p className="text-zinc-500 max-w-md mx-auto">
            Intenta con otros términos de búsqueda o revisa la biblioteca completa de estándares de seguridad.
          </p>
        </div>
      )}
    </div>
  );
}
