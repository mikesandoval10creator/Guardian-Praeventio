import { useProject } from '../../contexts/ProjectContext';
import { ChevronDown, Briefcase, Plus } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function ProjectSelector() {
  const { projects, selectedProject, setSelectedProject, loading } = useProject();
  const [isOpen, setIsOpen] = useState(false);

  if (loading) return (
    <div className="h-10 w-full bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-xl" />
  );

  return (
    <div className="relative w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
      >
        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
          <Briefcase className="w-4 h-4" />
        </div>
        <div className="flex-1 text-left overflow-hidden">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none mb-1">Proyecto Activo</p>
          <p className="text-xs font-black uppercase tracking-tight truncate text-zinc-900 dark:text-white">
            {selectedProject?.name || 'Seleccionar Proyecto'}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div 
              className="fixed inset-0 z-10" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl shadow-2xl z-20 overflow-hidden flex flex-col max-h-[60vh]"
            >
              <div className="p-2 space-y-1 overflow-y-auto custom-scrollbar">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      setSelectedProject(project);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      selectedProject?.id === project.id 
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' 
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full ${
                      project.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-300'
                    }`} />
                    <span className="text-xs font-bold uppercase tracking-tight">{project.name}</span>
                  </button>
                ))}
                
                <button className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-400 transition-colors border-t border-zinc-50 dark:border-zinc-800 mt-1 pt-3">
                  <Plus className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Nuevo Proyecto</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
