import { useProject } from '../../contexts/ProjectContext';
import { ChevronDown, Briefcase, Plus, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useNavigate } from 'react-router-dom';

export function ProjectSelector() {
  const { t } = useTranslation();
  const { projects, selectedProject, setSelectedProject, loading } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();

  if (loading) return (
    <div className="h-10 w-full bg-zinc-100 dark:bg-zinc-800 animate-pulse rounded-xl" />
  );

  return (
    <div className="relative w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/40 dark:bg-zinc-900 border border-white/20 dark:border-white/5 hover:bg-white/60 dark:hover:bg-zinc-800 transition-all duration-300 group shadow-sm"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#4db6ac] to-[#2a8a81] flex items-center justify-center text-white shadow-[0_0_15px_rgba(77,182,172,0.3)] group-hover:scale-105 transition-transform">
          <Briefcase className="w-5 h-5" />
        </div>
        <div className="flex-1 text-left overflow-hidden">
          <p className="text-[10px] font-black text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-widest leading-none mb-1">{t('project_selector.active_project', 'Proyecto Activo')}</p>
          <p className="text-sm font-bold tracking-tight truncate text-zinc-900 dark:text-white">
            {selectedProject?.name || t('project_selector.select_project', 'Seleccionar Proyecto')}
          </p>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-4 h-4 text-zinc-700 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-300" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0, y: -10 }}
            animate={{ height: 'auto', opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden mt-2 absolute w-full z-50"
          >
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl flex flex-col max-h-[40vh] shadow-2xl backdrop-blur-xl">
              <div className="p-2 space-y-1 overflow-y-auto custom-scrollbar">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      setSelectedProject(project);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${
                      selectedProject?.id === project.id 
                        ? 'bg-[#4db6ac]/5 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20 shadow-inner'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full shadow-sm ${
                      project.status === 'active' ? 'bg-[#4db6ac] shadow-[#4db6ac]/50' : 'bg-zinc-300 dark:bg-zinc-600'
                    }`} />
                    <span className="text-xs font-bold tracking-wide text-left truncate">{project.name}</span>
                  </button>
                ))}
                
                <button
                  disabled={!isOnline}
                  onClick={() => {
                    setIsOpen(false);
                    navigate('/projects');
                  }}
                  title={!isOnline ? t('project_selector.requires_internet_title', 'Requiere conexión a internet') : ''}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 border-t border-zinc-200 dark:border-white/5 mt-2 pt-3 ${
                    !isOnline ? 'text-zinc-400 dark:text-zinc-600 cursor-not-allowed' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                    {!isOnline ? <WifiOff className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    {!isOnline
                      ? t('project_selector.requires_connection', 'Requiere Conexión')
                      : t('project_selector.new_project', 'Nuevo Proyecto')}
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
