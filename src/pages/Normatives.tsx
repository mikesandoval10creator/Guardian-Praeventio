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
  Bookmark
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [isSeeding, setIsSeeding] = useState(false);
  const { data: normatives, loading } = useFirestoreCollection<Normative>('normatives');

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

  const filteredNormatives = normatives.filter(norm => 
    norm.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    norm.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    norm.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Normativas</h1>
          <p className="text-zinc-400 mt-1">Biblioteca de leyes, decretos y estándares de seguridad</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={seedNormatives}
            disabled={isSeeding}
            className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 px-4 py-2 rounded-xl font-medium transition-all disabled:opacity-50"
          >
            {isSeeding ? <div className="w-5 h-5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" /> : <Download className="w-5 h-5" />}
            <span>Sincronizar Biblioteca</span>
          </button>
          <button className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95">
            <Bookmark className="w-5 h-5" />
            <span>Mis Guardados</span>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="md:col-span-3 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por título, código o categoría (ej: Ley 16.744)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl py-3 transition-all">
          <Filter className="w-5 h-5" />
          <span>Filtrar</span>
        </button>
      </div>

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
              className="bg-zinc-900/50 border border-white/10 rounded-2xl p-6 hover:border-emerald-500/30 transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4">
                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                  norm.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                }`}>
                  {norm.status === 'active' ? 'Vigente' : 'Actualizada'}
                </span>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg leading-tight group-hover:text-emerald-400 transition-colors">
                    {norm.title}
                  </h3>
                  <p className="text-zinc-500 text-sm font-medium mt-1">{norm.code} · {norm.category}</p>
                </div>
              </div>

              <p className="text-zinc-400 text-sm mb-6 line-clamp-3">
                {norm.description}
              </p>

              <div className="flex items-center justify-between pt-4 border-t border-white/5">
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
                    className="flex items-center gap-1.5 text-emerald-500 hover:text-emerald-400 text-sm font-bold transition-colors"
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
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
          <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Book className="w-10 h-10 text-zinc-600" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No se encontraron normativas</h3>
          <p className="text-zinc-500 max-w-md mx-auto">
            Intenta con otros términos de búsqueda o revisa la biblioteca completa de estándares de seguridad.
          </p>
        </div>
      )}
    </div>
  );
}
