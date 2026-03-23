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
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  Image,
  Calendar,
  BookOpen,
  Lightbulb,
  Folder,
  ShieldAlert,
  UserCheck,
  Droplets,
  Clock,
  Award,
  Package,
  Grid,
  HeartPulse,
  Sliders,
  Book,
  ClipboardList,
  ShieldCheck,
  AlertOctagon,
  MapPin,
  Target,
  Brain
} from 'lucide-react';
import { Link } from 'react-router-dom';

export function Dashboard() {
  const modules = [
    { title: 'Proyectos', icon: Briefcase, color: 'bg-[#A855F7]', path: '/projects' },
    { title: 'Hallazgos', icon: AlertTriangle, color: 'bg-[#F59E0B]', path: '/findings' },
    { title: 'Auditorías', icon: ClipboardList, color: 'bg-[#10B981]', path: '/audits' },
    { title: 'Asistencia', icon: UserCheck, color: 'bg-[#3B82F6]', path: '/attendance' },
    { title: 'Capacitaciones', icon: BookOpen, color: 'bg-[#A855F7]', path: '/training' },
    { title: 'Calendario', icon: Calendar, color: 'bg-[#A855F7]', path: '/calendar' },
    { title: 'Documentos', icon: Folder, color: 'bg-[#A855F7]', path: '/documents' },
    { title: 'EPP', icon: Shield, color: 'bg-[#A855F7]', path: '/epp' },
    { title: 'Riesgos', icon: AlertOctagon, color: 'bg-[#A855F7]', path: '/risks' },
    { title: 'Matriz', icon: Grid, color: 'bg-[#A855F7]', path: '/matrix' },
    { title: 'Trabajadores', icon: Users, color: 'bg-[#A855F7]', path: '/workers' },
    { title: 'PTS', icon: FileText, color: 'bg-[#A855F7]', path: '/pts' },
    { title: 'Bio-Análisis', icon: Activity, color: 'bg-[#A855F7]', path: '/bio-analysis' },
    { title: 'Digital Twin', icon: Layout, color: 'bg-[#A855F7]', path: '/digital-twin' },
    { title: 'Normativas', icon: Book, color: 'bg-[#A855F7]', path: '/normatives' },
    { title: 'Emergencia', icon: AlertTriangle, color: 'bg-[#A855F7]', path: '/emergency' },
    { title: 'Evacuación', icon: Map, color: 'bg-[#A855F7]', path: '/evacuation' },
    { title: 'Higiene', icon: Droplets, color: 'bg-[#A855F7]', path: '/hygiene' },
    { title: 'Medicina', icon: HeartPulse, color: 'bg-[#A855F7]', path: '/medicine' },
    { title: 'Ergonomía', icon: UserCheck, color: 'bg-[#A855F7]', path: '/ergonomics' },
    { title: 'Historia', icon: Clock, color: 'bg-[#A855F7]', path: '/history' },
    { title: 'AI Hub', icon: Zap, color: 'bg-[#A855F7]', path: '/ai-hub' },
    { title: 'Zettelkasten', icon: Brain, color: 'bg-[#A855F7]', path: '/zettelkasten' },
  ];

  const duplicatedModules = [...modules, ...modules, ...modules];

  return (
    <div className="flex-1 flex flex-col gap-3">
      {/* 1. Boletín Climático */}
      <section className="bg-[#bbf7d0] rounded-xl p-3 shadow-sm relative overflow-hidden">
        <div className="flex flex-row justify-between gap-2 relative z-10">
          <div className="flex-1 flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-sm font-black text-zinc-900 tracking-tight leading-none">Boletín climático</h2>
                <p className="text-[8px] text-zinc-600 flex items-center gap-1 mt-0.5">
                  <Map className="w-2 h-2" /> Ubicación simulada
                </p>
              </div>
              <RefreshCw className="w-3 h-3 text-zinc-500 cursor-pointer" />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shrink-0">
                <Moon className="w-3 h-3" />
              </div>
              <div className="text-[8px] text-zinc-700 leading-tight">
                <p>24°C • UV 0 • 59% HR</p>
                <p>Aire: <span className="text-amber-600 font-bold">Moderada</span></p>
              </div>
            </div>

            <div className="hidden sm:block mt-1">
              <ul className="text-[9px] text-zinc-600 flex gap-3">
                <li className="flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5 text-amber-500" /> Hidratación constante</li>
                <li className="flex items-center gap-1"><Sun className="w-2.5 h-2.5 text-amber-500" /> Pausas cada 2h</li>
              </ul>
            </div>
          </div>

          <div className="w-[110px] sm:w-[150px] bg-[#1E293B] rounded-lg p-2 text-white relative flex flex-col justify-between shrink-0">
            <div className="flex justify-between text-[8px] font-bold">
              <span className="flex items-center gap-1 text-amber-400"><Sun className="w-2 h-2" /> Amanecer</span>
              <span>07:15</span>
            </div>
            <div className="relative h-8 mt-1">
              <svg viewBox="0 0 100 50" className="w-full h-full overflow-visible">
                <path d="M 0 50 A 50 50 0 0 1 100 50" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2 2" />
                <circle cx="45" cy="15" r="2.5" fill="#FBBF24" className="shadow-[0_0_8px_#FBBF24]" />
              </svg>
              <div className="absolute -bottom-1 w-full text-center text-[6px] text-zinc-400">en 5h 51m</div>
            </div>
            <div className="flex justify-between text-[8px] font-bold mt-1">
              <span>07:15</span>
              <span>18:13</span>
            </div>
          </div>
        </div>
      </section>

      {/* Consejo */}
      <div className="bg-[#bbf7d0] rounded-lg py-1.5 px-3 flex items-center justify-center gap-2 shadow-sm mx-auto w-full">
        <span className="bg-zinc-800 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0">Consejo:</span>
        <span className="text-[9px] text-zinc-700 font-medium truncate">
          🧘‍♂️ Concéntrate en lo que controlas; actúa con calma.
        </span>
      </div>

      {/* Tu Protección es Nuestra Prioridad */}
      <section className="text-center flex flex-col items-center justify-center mt-1">
        <h2 className="text-sm sm:text-base font-black text-zinc-900 tracking-tight leading-none mb-2">Tu Protección es Nuestra Prioridad</h2>
        
        <div className="flex flex-row items-center justify-center gap-2 w-full max-w-sm">
          <button className="flex-1 bg-[#22C55E] hover:bg-[#16A34A] text-white px-2 py-2 rounded-lg font-black uppercase tracking-widest text-[10px] shadow-md transition-transform hover:scale-105 flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Fast Check
          </button>
          <Link to="/emergency" className="flex-1 bg-[#EF4444] hover:bg-[#DC2626] text-white px-2 py-2 rounded-lg font-black uppercase tracking-widest text-[10px] shadow-md transition-transform hover:scale-105 flex items-center justify-center gap-1">
            <Zap className="w-3.5 h-3.5" /> Emergencia
          </Link>
        </div>
      </section>

      {/* Elige tu Equipo de Protección Personal */}
      <section className="flex flex-col justify-center items-center w-full mt-2">
        <div className="text-center mb-2">
          <h2 className="text-xs sm:text-sm font-black text-zinc-900 tracking-tight">Elige tu Equipo de Protección Personal</h2>
        </div>

        <div className="bg-[#4ADE80] p-3 sm:p-4 rounded-2xl shadow-xl relative border-2 border-white/20 w-full max-w-sm mx-auto flex flex-col justify-center items-center">
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-[#22C55E] text-white px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1 border border-white/20 whitespace-nowrap">
            👷 Construcción
          </div>
          
          <div className="flex items-center justify-center gap-2 sm:gap-3 mt-1 w-full">
            <div className="flex flex-col gap-1.5">
              <div className="bg-white p-1 rounded-lg shadow-md text-center w-12 sm:w-14 border-2 border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base sm:text-lg leading-none mb-0.5">👷</div>
                <div className="bg-black text-white text-[5px] font-black py-0.5 rounded uppercase leading-tight">Casco</div>
              </div>
              <div className="bg-white p-1 rounded-lg shadow-md text-center w-12 sm:w-14 border-2 border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base sm:text-lg leading-none mb-0.5">🧤</div>
                <div className="bg-black text-white text-[5px] font-black py-0.5 rounded uppercase leading-tight">Guantes</div>
              </div>
            </div>

            <div className="bg-white/40 backdrop-blur-sm rounded-2xl p-2 shadow-inner w-16 h-16 sm:w-20 sm:h-20 flex flex-col items-center justify-center border-2 border-dashed border-white/60 shrink-0 group hover:border-white transition-all">
              <Shield className="w-6 h-6 text-emerald-800/40 group-hover:text-emerald-800/60 transition-colors mb-1" />
              <span className="text-emerald-800/40 text-[6px] sm:text-[7px] font-black uppercase tracking-widest text-center px-1 leading-tight group-hover:text-emerald-800/60 transition-colors">Praeventio Guard</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="bg-white p-1 rounded-lg shadow-md text-center w-12 sm:w-14 border-2 border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base sm:text-lg leading-none mb-0.5">🥽</div>
                <div className="bg-black text-white text-[5px] font-black py-0.5 rounded uppercase leading-tight">Lentes</div>
              </div>
              <div className="bg-white p-1 rounded-lg shadow-md text-center w-12 sm:w-14 border-2 border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base sm:text-lg leading-none mb-0.5">🥾</div>
                <div className="bg-black text-white text-[5px] font-black py-0.5 rounded uppercase leading-tight">Zapatos</div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex justify-center shrink-0">
            <div className="bg-[#22C55E] rounded-md p-0.5 flex items-center gap-1 border border-white/20 shadow-inner">
              <span className="bg-black text-white text-[6px] font-black px-1 py-0.5 rounded uppercase tracking-widest">Rubro:</span>
              <select className="bg-transparent text-white text-[7px] font-bold outline-none cursor-pointer px-1">
                <option className="text-black">👷 Construcción</option>
                <option className="text-black">⛏️ Minería</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Module Carousel */}
      <section className="mt-4 overflow-hidden pt-2 border-t border-zinc-100">
        <div className="text-center mb-3">
          <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Módulos del Sistema</h2>
        </div>
        <motion.div 
          className="flex gap-2"
          animate={{
            x: [0, -3186], // 27 modules * (110px width + 8px gap)
          }}
          transition={{
            x: {
              repeat: Infinity,
              repeatType: "loop",
              duration: 80, // Slower due to longer list
              ease: "linear",
            },
          }}
        >
          {duplicatedModules.map((module, i) => (
            <motion.div
              key={i}
              whileTap={{ scale: 0.95 }}
              className="flex-shrink-0"
            >
              <Link 
                to={module.path}
                className={`${module.color} w-[110px] h-[45px] rounded-xl p-2 flex items-center justify-center gap-1.5 shadow-md cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg border border-white/20`}
              >
                <module.icon className="w-4 h-4 text-white shrink-0" />
                <h3 className="text-white text-[8px] font-black uppercase tracking-widest leading-tight text-center">{module.title}</h3>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </section>
    </div>
  );
}
