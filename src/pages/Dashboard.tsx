import { motion } from 'framer-motion';
import { 
  Shield, 
  Zap,
  Map,
  FileText,
  Layout,
  RefreshCw,
  Sun,
  Moon,
  Activity,
  Users,
  Brain,
  Network
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { SafetyCapsules } from '../components/safety/SafetyCapsules';

export function Dashboard() {
  const { nodes } = useZettelkasten();
  const { selectedProject } = useProject();

  const projectNodes = nodes.filter(n => !selectedProject || n.projectId === selectedProject.id);
  const totalConnections = projectNodes.reduce((acc, node) => acc + node.connections.length, 0) / 2;

  const modules = [
    { title: 'Riesgos', icon: Shield, color: 'bg-[#6366F1]', path: '/risks' },
    { title: 'Matriz (IA)', icon: Zap, color: 'bg-[#8B5CF6]', path: '/matrix' },
    { title: 'Evacuación', icon: Map, color: 'bg-[#EC4899]', path: '/evacuation' },
    { title: 'Plan de Emergencia', icon: FileText, color: 'bg-[#F59E0B]', path: '/emergency' },
    { title: 'Trabajadores', icon: Users, color: 'bg-[#10B981]', path: '/workers' },
    { title: 'Capacitaciones', icon: Activity, color: 'bg-[#3B82F6]', path: '/training' },
    { title: 'Normativas', icon: FileText, color: 'bg-[#6B7280]', path: '/normatives' },
    { title: 'Higiene', icon: Shield, color: 'bg-[#14B8A6]', path: '/hygiene' },
    { title: 'Medicina', icon: Activity, color: 'bg-[#EF4444]', path: '/medicine' },
    { title: 'Ergonomía', icon: Layout, color: 'bg-[#F97316]', path: '/ergonomics' },
  ];

  // Duplicate modules for infinite scroll
  const duplicatedModules = [...modules, ...modules];

  return (    <div className="space-y-1.5 pb-2">
      {/* 1. Boletín Climático */}
      <motion.section 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded-[20px] p-3 border border-white/20 shadow-md bg-gradient-to-br from-[#D9F99D] via-[#BEF264] to-[#A3E635] backdrop-blur-xl"
      >
        <div className="absolute inset-0 bg-white/5 pointer-events-none" />
        
        <div className="flex justify-between items-center mb-2 relative z-10">
          <div className="flex items-center gap-1.5">
            <div className="w-1 h-1 bg-zinc-900 rounded-full animate-pulse" />
            <h2 className="text-[11px] font-black tracking-tighter text-zinc-900 uppercase">Boletín Climático</h2>
            <RefreshCw className="w-3 h-3 text-zinc-700 cursor-pointer" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="bg-black text-white text-[6px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest">Tip:</div>
            <p className="text-[8px] font-bold text-zinc-900">🚨 Chaleco reflectante.</p>
          </div>
          <span className="text-[7px] font-black text-zinc-900 uppercase tracking-widest bg-black/5 px-1.5 py-0.5 rounded-md">20 Mar 2026</span>
        </div>

        <div className="grid grid-cols-2 gap-3 relative z-10">
          <div className="flex items-center gap-2 bg-white/20 p-2 rounded-xl border border-white/30">
            <Moon className="w-6 h-6 text-zinc-900" />
            <div className="flex flex-col">
              <span className="text-lg font-black text-zinc-900 leading-none">24°C</span>
              <span className="text-[8px] font-black text-zinc-800 uppercase opacity-60">Despejado • UV 0</span>
            </div>
          </div>

          <div className="bg-[#151619] rounded-[16px] p-2 flex flex-col justify-center border border-white/5 relative overflow-hidden">
             <div className="flex justify-between items-center text-zinc-400 text-[7px] font-black uppercase tracking-[0.1em] mb-1">
               <span className="flex items-center gap-0.5"><Sun className="w-2.5 h-2.5 text-amber-500" /> 07:15</span>
               <span className="flex items-center gap-0.5"><Moon className="w-2.5 h-2.5 text-indigo-400" /> 18:13</span>
             </div>
             <div className="w-full h-0.5 bg-zinc-800 rounded-full relative">
               <motion.div 
                 initial={{ left: "0%" }}
                 animate={{ left: "45%" }}
                 className="absolute -top-1 w-2.5 h-2.5 bg-amber-500 rounded-full shadow-[0_0_10px_rgba(245,158,11,0.8)] border border-[#151619]" 
               />
             </div>
          </div>
        </div>
      </motion.section>

      {/* 2. Safety Capsules (IA) */}
      <SafetyCapsules />

      {/* 3. Hero Section */}
      <section className="text-center py-1 relative">
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10"
        >
          <h2 className="text-xl font-black tracking-tighter text-zinc-950 uppercase leading-none">
            Tu Protección es <span className="text-emerald-600">Nuestra Prioridad</span>
          </h2>
        </motion.div>
      </section>

      {/* Neural Core Summary */}
      <Link to="/zettelkasten" className="block">
        <motion.section 
          whileHover={{ scale: 1.01 }}
          className="bg-zinc-900/90 rounded-[20px] p-3 border border-white/10 shadow-lg relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Brain className="w-16 h-16 text-emerald-500" />
          </div>
          
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Network className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-white">Núcleo Neuronal</h3>
              <p className="text-[8px] font-bold text-zinc-500 uppercase tracking-tighter">Zettelkasten Knowledge Graph</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-[7px] font-black uppercase tracking-widest text-zinc-500">Nodos Activos</p>
              <p className="text-xl font-black text-white tracking-tighter">{projectNodes.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[7px] font-black uppercase tracking-widest text-zinc-500">Sinapsis Totales</p>
              <p className="text-xl font-black text-emerald-500 tracking-tighter">{totalConnections}</p>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[7px] font-black uppercase tracking-widest text-zinc-400">Sincronización en tiempo real</span>
            </div>
            <span className="text-[7px] font-black uppercase tracking-widest text-emerald-500 group-hover:translate-x-1 transition-transform">Ver Grafo →</span>
          </div>
        </motion.section>
      </Link>

      {/* 5. EPP Section */}
      <section className="bg-[#22C55E] rounded-[20px] p-2 relative overflow-hidden shadow-md">
        <div className="text-center mb-1 relative z-10">
          <h2 className="text-[10px] font-black tracking-tighter text-zinc-950 uppercase">
            Equipo de Protección Personal
          </h2>
        </div>

        <div className="flex items-center justify-center gap-2 relative z-10">
          {/* Left Cards */}
          <div className="flex flex-col gap-1.5">
            {[
              { emoji: "👷", label: "Casco" },
              { emoji: "🧤", label: "Guantes" }
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-lg p-0 w-11 h-11 shadow-md border border-white/50 flex flex-col items-center justify-center relative overflow-hidden group hover:scale-105 transition-transform">
                <div className="text-lg mb-0.5">{item.emoji}</div>
                <div className="absolute bottom-0 left-0 right-0 bg-black text-white text-[5px] font-black py-0.5 text-center uppercase tracking-widest">{item.label}</div>
              </div>
            ))}
          </div>

          {/* Center Character */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="bg-white rounded-[16px] p-1 shadow-lg border-2 border-white/50 w-24 aspect-square flex items-center justify-center relative overflow-hidden">
              <div className="w-full h-full bg-white flex items-center justify-center">
                <Shield className="w-8 h-8 text-zinc-100" />
              </div>
            </div>
            <div className="bg-black/90 text-white px-2 py-0.5 rounded-lg flex items-center gap-1 border border-white/10 w-24 shadow-sm">
              <select className="bg-transparent text-white text-[6px] font-black outline-none cursor-pointer flex-1 uppercase tracking-widest">
                <option className="bg-zinc-900">Construcción</option>
                <option className="bg-zinc-900">Minería</option>
              </select>
            </div>
          </div>

          {/* Right Cards */}
          <div className="flex flex-col gap-1.5">
            {[
              { emoji: "🥽", label: "Lentes" },
              { emoji: "🥾", label: "Zapatos" }
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-lg p-0 w-11 h-11 shadow-md border border-white/50 flex flex-col items-center justify-center relative overflow-hidden group hover:scale-105 transition-transform">
                <div className="text-lg mb-0.5">{item.emoji}</div>
                <div className="absolute bottom-0 left-0 right-0 bg-black text-white text-[5px] font-black py-0.5 text-center uppercase tracking-widest">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recent Activity Feed */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[10px] font-black tracking-tighter text-zinc-950 uppercase">Actividad Reciente</h2>
          <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Últimas 24h</span>
        </div>
        <div className="space-y-1.5">
          {projectNodes.slice(0, 3).map((node, i) => (
            <motion.div 
              key={node.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-white/80 backdrop-blur-sm rounded-xl p-2 border border-white/50 flex items-center gap-3 shadow-sm"
            >
              <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-white">
                <Shield className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-black text-zinc-900 truncate uppercase tracking-tight">{node.title}</p>
                <p className="text-[7px] font-bold text-zinc-500 uppercase tracking-widest">{node.type}</p>
              </div>
              <div className="text-right">
                <p className="text-[7px] font-black text-zinc-900">NUEVO</p>
                <div className="w-1 h-1 bg-emerald-500 rounded-full ml-auto mt-0.5" />
              </div>
            </motion.div>
          ))}
          {projectNodes.length === 0 && (
            <p className="text-[9px] text-zinc-500 text-center py-4 italic">No hay actividad reciente en este proyecto.</p>
          )}
        </div>
      </section>

      {/* 6. Module Carousel */}
      <section className="py-2 relative overflow-hidden">
        <motion.div 
          className="flex gap-2"
          animate={{
            x: [0, -1180], // Adjust based on module width + gap
          }}
          transition={{
            x: {
              repeat: Infinity,
              repeatType: "loop",
              duration: 60, // Slower rotation (was 30)
              ease: "linear",
            },
          }}
        >
          {duplicatedModules.map((module, i) => (
            <motion.div
              key={i}
              whileTap={{ scale: 0.98 }}
              className="flex-shrink-0"
            >
              <Link 
                to={module.path}
                className={`${module.color} w-[110px] h-[60px] rounded-[16px] p-2 flex flex-col justify-between shadow-sm cursor-pointer transition-all group relative overflow-hidden border border-white/10`}
              >
                <div className="bg-white/20 w-6 h-6 rounded-md flex items-center justify-center backdrop-blur-md border border-white/20 shadow-sm group-hover:rotate-6 transition-transform">
                  <module.icon className="w-3 h-3 text-white" />
                </div>
                <h3 className="text-white text-[8px] font-black uppercase tracking-widest">{module.title}</h3>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </section>
    </div>
  );
}
