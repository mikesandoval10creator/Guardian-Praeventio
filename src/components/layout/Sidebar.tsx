import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Shield, 
  Zap, 
  Map, 
  FileText, 
  Layout, 
  Home, 
  Book, 
  User, 
  Settings,
  HelpCircle,
  LogOut,
  Bell,
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Briefcase,
  Truck,
  Clock
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { ProjectSelector } from './ProjectSelector';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const menuItems = [
  { title: 'Inicio', icon: Home, path: '/', color: 'text-emerald-500' },
  { title: 'Proyectos', icon: Briefcase, path: '/projects', color: 'text-blue-500' },
  { title: 'El Cerebro', icon: Zap, path: '/zettelkasten', color: 'text-emerald-400' },
  { title: 'Gestión de Riesgos', icon: Shield, path: '/risks', color: 'text-indigo-500' },
  { title: 'Matriz IA (IPERC)', icon: Zap, path: '/matrix', color: 'text-violet-500' },
  { title: 'Mapa de Evacuación', icon: Map, path: '/evacuation', color: 'text-pink-500' },
  { title: 'Plan de Emergencia', icon: FileText, path: '/emergency', color: 'text-amber-500' },
  { title: 'Trabajadores', icon: User, path: '/workers', color: 'text-emerald-500' },
  { title: 'Asistencia', icon: Clock, path: '/attendance', color: 'text-emerald-400' },
  { title: 'Gestión de EPP', icon: Shield, path: '/epp', color: 'text-blue-400' },
  { title: 'Generador PTS', icon: FileText, path: '/pts', color: 'text-emerald-400' },
  { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-rose-400' },
  { title: 'Gemelo Digital', icon: Map, path: '/digital-twin', color: 'text-indigo-400' },
  { title: 'Gestión de Activos', icon: Truck, path: '/assets', color: 'text-amber-400' },
  { title: 'AI Hub: El Guardián', icon: Zap, path: '/ai-hub', color: 'text-blue-500' },
  { title: 'Capacitaciones', icon: Activity, path: '/training', color: 'text-blue-500' },
  { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-zinc-500' },
  { title: 'Higiene y Salud', icon: Shield, path: '/hygiene', color: 'text-teal-500' },
  { title: 'Medicina Ocupacional', icon: Activity, path: '/medicine', color: 'text-rose-500' },
  { title: 'Ergonomía', icon: Layout, path: '/ergonomics', color: 'text-orange-500' },
  { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-amber-500' },
  { title: 'Auditorías', icon: ClipboardCheck, path: '/audits', color: 'text-blue-500' },
];

const secondaryItems = [
  { title: 'Notificaciones', icon: Bell, path: '/notifications' },
  { title: 'Mi Perfil', icon: User, path: '/profile' },
  { title: 'Configuración', icon: Settings, path: '/settings' },
  { title: 'Ayuda y Soporte', icon: HelpCircle, path: '/help' },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />

          {/* Sidebar */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 left-0 bottom-0 w-[280px] bg-zinc-950 border-r border-white/10 z-[70] flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none">Praeventio</span>
                  <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-tighter">Guard v1.0</span>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto py-4 px-3 no-scrollbar">
              <div className="mb-6 px-3">
                <ProjectSelector />
              </div>
              <div className="space-y-1">
                <p className="px-3 text-[7px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Funciones Principales</p>
                {menuItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                        isActive 
                          ? 'bg-emerald-500/10 text-white border border-emerald-500/20' 
                          : 'text-zinc-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <item.icon className={`w-4 h-4 ${isActive ? item.color : 'group-hover:text-white transition-colors'}`} />
                      <span className="text-[9px] font-black uppercase tracking-widest">{item.title}</span>
                      {isActive && (
                        <motion.div 
                          layoutId="sidebar-active"
                          className="ml-auto w-1 h-1 bg-emerald-500 rounded-full"
                        />
                      )}
                    </Link>
                  );
                })}
              </div>

              <div className="mt-6 space-y-1">
                <p className="px-3 text-[7px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Sistema y Cuenta</p>
                {secondaryItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onClose}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-all group"
                  >
                    <item.icon className="w-4 h-4 group-hover:text-white transition-colors" />
                    <span className="text-[9px] font-black uppercase tracking-widest">{item.title}</span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 bg-zinc-900/50">
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all group">
                <LogOut className="w-4 h-4" />
                <span className="text-[9px] font-black uppercase tracking-widest">Cerrar Sesión</span>
              </button>
              <div className="mt-4 text-center">
                <p className="text-[6px] font-black text-zinc-600 uppercase tracking-widest">© 2026 Praeventio Guard</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
