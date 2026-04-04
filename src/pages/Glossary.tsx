import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Book, Search, Filter, BookOpen } from 'lucide-react';
import { SAFETY_GLOSSARY } from '../constants/glossary';

interface GlossaryItem {
  term: string;
  definition: string;
  category: string;
  relatedTerms?: string[];
}

export function Glossary() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const parsedGlossary = useMemo(() => {
    const items: Record<string, GlossaryItem> = {};
    const lines = SAFETY_GLOSSARY.split('\n').filter(line => line.trim() !== '');
    let currentCategory = 'General';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length === 1 && line === line.toUpperCase()) {
        currentCategory = line;
        continue;
      }
      
      if (line.includes(':')) {
        const [term, ...defParts] = line.split(':');
        const definition = defParts.join(':').trim();
        if (term && definition) {
          items[term.trim()] = {
            term: term.trim(),
            definition,
            category: currentCategory,
            relatedTerms: []
          };
        }
      } else if (line.length > 3 && !line.startsWith('Técnicas')) {
        // Handle lines without colon but might be terms or continuation
        // Simple heuristic: if it's a short line, it might be a term, next line is definition
        if (line.split(' ').length <= 4 && i + 1 < lines.length && !lines[i+1].includes(':')) {
           const term = line;
           const definition = lines[i+1].trim();
           items[term] = {
             term,
             definition,
             category: currentCategory,
             relatedTerms: []
           };
           i++; // skip next line
        }
      }
    }
    return items;
  }, []);

  // Extract unique categories from the glossary
  const categories = Array.from(new Set(Object.values(parsedGlossary).map(item => item.category))).sort();

  const filteredGlossary = Object.values(parsedGlossary).filter((details) => {
    const matchesSearch = (details.term || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) || 
                          (details.definition || '').toLowerCase().includes(String(searchTerm || '').toLowerCase());
    const matchesCategory = selectedCategory ? details.category === selectedCategory : true;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Glosario Técnico</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Diccionario Semántico de Prevención de Riesgos
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar término o definición..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 custom-scrollbar">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ${
              selectedCategory === null
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-zinc-900/50 text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5'
            }`}
          >
            Todos
          </button>
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap shrink-0 ${
                selectedCategory === category
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-zinc-900/50 text-zinc-400 hover:text-white hover:bg-zinc-800 border border-white/5'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Glossary Grid */}
      {filteredGlossary.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredGlossary.map((details, index) => (
            <motion.div
              key={details.term}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 hover:border-emerald-500/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5 shrink-0 group-hover:scale-110 transition-transform">
                  <BookOpen className="w-6 h-6" />
                </div>
                <span className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 text-[8px] font-black uppercase tracking-widest border border-emerald-500/20">
                  {details.category}
                </span>
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tight mb-3 group-hover:text-emerald-400 transition-colors">
                {details.term}
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {details.definition}
              </p>
              {details.relatedTerms && details.relatedTerms.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Términos Relacionados</p>
                  <div className="flex flex-wrap gap-2">
                    {details.relatedTerms.map(related => (
                      <span key={related} className="text-xs text-emerald-500/70 font-medium bg-emerald-500/5 px-2 py-1 rounded-md border border-emerald-500/10">
                        {related}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
          <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Book className="w-10 h-10 text-zinc-600" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No se encontraron términos</h3>
          <p className="text-zinc-500 max-w-md mx-auto">
            Intenta con otra búsqueda o selecciona una categoría diferente.
          </p>
        </div>
      )}
    </div>
  );
}
