import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Users,
  Settings,
  HelpCircle,
  LogOut,
  Bell,
  Activity,
  AlertTriangle,
  ShieldAlert,
  ClipboardCheck,
  ShieldCheck,
  Briefcase,
  Truck,
  Clock,
  Network,
  ClipboardList,
  UserCheck,
  BookOpen,
  Calendar,
  Folder,
  AlertOctagon,
  Grid,
  Droplets,
  HeartPulse,
  Award,
  BarChart3,
  Brain,
  ChevronDown,
  ChevronRight,
  Wrench,
  Car,
  MessageSquare,
  Mountain,
  TreePine,
  Route,
  Gamepad2,
  Scan,
  Cloud,
  Database,
  Printer,
  Box,
  Watch,
  Cpu,
  Server,
  Key,
  Layers,
  Waves,
  Sun,
  Droplet,
  WifiOff
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ProjectSelector } from "./ProjectSelector";
import { logOut } from "../../services/firebase";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type MenuItem = {
  title: string;
  icon: any;
  path: string;
  color: string;
  isBeta?: boolean;
};

type MenuGroup = {
  title: string;
  icon: any;
  items: MenuItem[];
};

const menuGroups: MenuGroup[] = [
  {
    title: "Inteligencia",
    icon: Brain,
    items: [
      {
        title: "El Asesor",
        icon: MessageSquare,
        path: "/asesor",
        color: "text-violet-500",
      },
      {
        title: "Procesador Académico",
        icon: BookOpen,
        path: "/academic-processor",
        color: "text-violet-500",
      },
      {
        title: "Motor OCR",
        icon: Scan,
        path: "/document-ocr",
        color: "text-violet-400",
      },
      {
        title: "Zettelkasten",
        icon: Network,
        path: "/zettelkasten",
        color: "text-blue-500",
      },
      {
        title: "Arcade Seguridad",
        icon: Gamepad2,
        path: "/arcade-games",
        color: "text-fuchsia-500",
      },
    ],
  },
  {
    title: "Principal",
    icon: Home,
    items: [
      { title: "Inicio", icon: Home, path: "/", color: "text-emerald-500" },
      {
        title: "Red Neuronal",
        icon: Network,
        path: "/risk-network",
        color: "text-emerald-400",
      },
      {
        title: "Proyectos",
        icon: Briefcase,
        path: "/projects",
        color: "text-blue-500",
      },
      { title: "AI Hub", icon: Zap, path: "/ai-hub", color: "text-violet-500" },
      {
        title: "Muro",
        icon: Users,
        path: "/safety-feed",
        color: "text-emerald-500",
      },
    ],
  },
  {
    title: "Gestión Operativa",
    icon: Briefcase,
    items: [
      {
        title: "Mural Dinámico",
        icon: MessageSquare,
        path: "/mural",
        color: "text-blue-500",
      },
      {
        title: "Trabajadores",
        icon: Users,
        path: "/workers",
        color: "text-violet-500",
      },
      {
        title: "Documentos",
        icon: Folder,
        path: "/documents",
        color: "text-violet-500",
      },
      {
        title: "Asistencia",
        icon: UserCheck,
        path: "/attendance",
        color: "text-zinc-400",
      },
      {
        title: "Calendario",
        icon: Calendar,
        path: "/calendar",
        color: "text-zinc-400",
      },
      {
        title: "Comité Paritario",
        icon: Users,
        path: "/comite-paritario",
        color: "text-emerald-500",
      },
      {
        title: "Telemetría",
        icon: Activity,
        path: "/telemetry",
        color: "text-zinc-400",
      },
      {
        title: "Activos",
        icon: Wrench,
        path: "/assets",
        color: "text-zinc-400",
      },
      {
        title: "Conducción",
        icon: Car,
        path: "/safe-driving",
        color: "text-zinc-400",
      },
      {
        title: "Mapa de Sitio",
        icon: Map,
        path: "/site-map",
        color: "text-zinc-400",
      },
    ],
  },
  {
    title: "Prevención y Riesgos",
    icon: ShieldAlert,
    items: [
      {
        title: "Diagnóstico",
        icon: ClipboardList,
        path: "/diagnostico",
        color: "text-zinc-400",
      },
      {
        title: "Controles y Materiales",
        icon: Wrench,
        path: "/controls-materials",
        color: "text-zinc-400",
      },
      {
        title: "Riesgos",
        icon: AlertOctagon,
        path: "/risks",
        color: "text-violet-500",
      },
      {
        title: "Hallazgos",
        icon: AlertTriangle,
        path: "/findings",
        color: "text-amber-500",
      },
      { title: "EPP", icon: Shield, path: "/epp", color: "text-violet-500" },
      { title: "Matriz", icon: Grid, path: "/matrix", color: "text-zinc-400" },
      { title: "PTS", icon: FileText, path: "/pts", color: "text-zinc-400" },
      {
        title: "Guardia Predictivo",
        icon: Zap,
        path: "/predictive-guard",
        color: "text-zinc-400",
      },
    ],
  },
  {
    title: "Salud Ocupacional",
    icon: HeartPulse,
    items: [
      {
        title: "Zonas DEA",
        icon: HeartPulse,
        path: "/dea-zones",
        color: "text-rose-500",
      },
      {
        title: "Visor Anatómico",
        icon: Activity,
        path: "/human-body",
        color: "text-rose-500",
      },
      {
        title: "Wearables",
        icon: Watch,
        path: "/wearables",
        color: "text-rose-400",
      },
      {
        title: "Radiación UV",
        icon: Sun,
        path: "/sun-tracker",
        color: "text-yellow-500",
      },
      {
        title: "Higiene",
        icon: Droplets,
        path: "/hygiene",
        color: "text-zinc-400",
      },
      {
        title: "Medicina",
        icon: HeartPulse,
        path: "/medicine",
        color: "text-zinc-400",
      },
      {
        title: "Ergonomía",
        icon: UserCheck,
        path: "/ergonomics",
        color: "text-zinc-400",
      },
      {
        title: "Psicosocial",
        icon: Brain,
        path: "/psychosocial",
        color: "text-zinc-400",
      },
      {
        title: "Bio-Análisis",
        icon: Activity,
        path: "/bio-analysis",
        color: "text-zinc-400",
      },
    ],
  },
  {
    title: "Cumplimiento",
    icon: ClipboardCheck,
    items: [
      {
        title: "Normativas",
        icon: Book,
        path: "/normatives",
        color: "text-zinc-400",
      },
      {
        title: "Protocolos MINSAL",
        icon: ShieldCheck,
        path: "/minsal-protocols",
        color: "text-zinc-400",
      },
      {
        title: "Auditorías",
        icon: ClipboardList,
        path: "/audits",
        color: "text-zinc-400",
      },
      {
        title: "Reportes SUSESO",
        icon: FileText,
        path: "/suseso",
        color: "text-zinc-400",
      },
      {
        title: "Glosario",
        icon: BookOpen,
        path: "/glossary",
        color: "text-zinc-400",
      },
    ],
  },
  {
    title: "Emergencias",
    icon: AlertTriangle,
    items: [
      {
        title: "Emergencia",
        icon: AlertTriangle,
        path: "/emergency",
        color: "text-rose-500",
      },
      {
        title: "Rutas Evacuación",
        icon: Route,
        path: "/evacuation-routes",
        color: "text-emerald-500",
      },
      {
        title: "Erupción Volcánica",
        icon: Mountain,
        path: "/volcanic-eruption",
        color: "text-orange-500",
      },
      {
        title: "Mapeo Hazmat",
        icon: Droplet,
        path: "/hazmat-map",
        color: "text-violet-500",
      },
      {
        title: "Refugios Montaña",
        icon: Mountain,
        path: "/mountain-refuges",
        color: "text-blue-500",
      },
      {
        title: "Parques Nacionales",
        icon: TreePine,
        path: "/national-parks",
        color: "text-emerald-500",
      },
      {
        title: "Rutas Climáticas",
        icon: Route,
        path: "/climate-routes",
        color: "text-cyan-500",
      },
      {
        title: "Guía Inhóspita",
        icon: Mountain,
        path: "/inhospitable-guide",
        color: "text-zinc-400",
      },
      {
        title: "Evacuación",
        icon: Map,
        path: "/evacuation",
        color: "text-zinc-400",
      },
      {
        title: "Simulador",
        icon: Zap,
        path: "/emergency-generator",
        color: "text-zinc-400",
      },
    ],
  },
  {
    title: "Medio Ambiente",
    icon: Sun,
    items: [
      {
        title: "Contaminación Lumínica",
        icon: Sun,
        path: "/light-pollution",
        color: "text-amber-500",
      },
    ],
  },
  {
    title: "Capacitación",
    icon: BookOpen,
    items: [
      {
        title: "Capacitaciones",
        icon: BookOpen,
        path: "/training",
        color: "text-zinc-400",
      },
      {
        title: "Gamificación",
        icon: Award,
        path: "/gamification",
        color: "text-zinc-400",
      },
      {
        title: "Currículum Preventivo",
        icon: ShieldCheck,
        path: "/curriculum",
        color: "text-emerald-500",
      },
      {
        title: "Entrenamiento IA",
        icon: Zap,
        path: "/knowledge-ingestion",
        color: "text-zinc-400",
      },
    ],
  },
  {
    title: "Reportes",
    icon: BarChart3,
    items: [
      {
        title: "Reportabilidad",
        icon: BarChart3,
        path: "/analytics",
        color: "text-zinc-400",
      },
      {
        title: "Historia",
        icon: Clock,
        path: "/history",
        color: "text-zinc-400",
      },
    ],
  },
];

const secondaryItems = [
  { title: "Notificaciones", icon: Bell, path: "/notifications" },
  { title: "Workspace Sync", icon: Cloud, path: "/google-drive" },
  { title: "Visor de Planos", icon: Map, path: "/blueprint-viewer" },
  {
    title: "Emergencia Avanzada",
    icon: Activity,
    path: "/emergencia-avanzada",
  },
  { title: "Emergencia Costera", icon: Waves, path: "/coastal-emergency" },
  { title: "Arquitectura CQRS", icon: Layers, path: "/cqrs-architecture" },
  { title: "SSO Config", icon: Key, path: "/sso-config" },
  { title: "Integración ERP", icon: Server, path: "/erp-integration" },
  { title: "IoT Edge", icon: Cpu, path: "/iot-edge" },
  { title: "Visor AutoCAD", icon: Box, path: "/autocad" },
  { title: "Seguridad MFA", icon: Shield, path: "/security-shield" },
  { title: "Audit Trail", icon: Database, path: "/audit-trail" },
  { title: "Render Inmutable", icon: Printer, path: "/immutable-render" },
  { title: "Mi Perfil", icon: User, path: "/profile" },
  { title: "Configuración", icon: Settings, path: "/settings" },
  { title: "Planes y Facturación", icon: Key, path: "/pricing" },
  { title: "Ayuda y Soporte", icon: HelpCircle, path: "/help" },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    const activeGroup = menuGroups.find((group) =>
      group.items.some((item) => location.pathname === item.path),
    );
    return activeGroup ? activeGroup.title : "Principal";
  });

  // Also update openGroup when location changes if the new active group is not open
  useEffect(() => {
    const activeGroup = menuGroups.find((group) =>
      group.items.some((item) => location.pathname === item.path),
    );
    if (activeGroup && openGroup !== activeGroup.title) {
      setOpenGroup(activeGroup.title);
    }
  }, [location.pathname]);

  const toggleGroup = (title: string) => {
    setOpenGroup((prev) => (prev === title ? null : title));
  };

  const handleLogout = async () => {
    try {
      await logOut();
      onClose(); // Close sidebar on mobile
      navigate("/");
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 bottom-0 w-[280px] sm:w-[300px] bg-[#4eb5ac] dark:bg-zinc-950 border-r border-zinc-200/50 dark:border-white/10 z-[70] flex flex-col shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center justify-between bg-[#4eb5ac]/50 dark:bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)] relative">
              <span className="text-white font-black text-lg leading-none">
                P
              </span>
              {!isOnline && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-amber-500 rounded-full border-2 border-[#4eb5ac] dark:border-zinc-950 flex items-center justify-center" title="Modo Búnker (Offline)">
                  <WifiOff className="w-2 h-2 text-white" />
                </div>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tight text-zinc-900 dark:text-white leading-none">
                Praeventio
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                  Guard v1.0
                </span>
                {!isOnline && (
                  <span className="text-[8px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded uppercase tracking-widest">
                    Búnker
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-white/20 dark:bg-white/5 flex items-center justify-center text-zinc-800 dark:text-zinc-400 hover:bg-white/30 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white transition-all lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto py-4 px-3 custom-scrollbar">
          <div className="mb-6 px-3">
            <ProjectSelector />
          </div>

          <div className="space-y-2">
            {menuGroups.map((group) => {
              const isGroupOpen = openGroup === group.title;
              const hasActiveItem = group.items.some(
                (item) => location.pathname === item.path,
              );

              return (
                <div key={group.title} className="flex flex-col">
                  <button
                    onClick={() => toggleGroup(group.title)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 ${
                      isGroupOpen || hasActiveItem
                        ? "bg-white/30 dark:bg-zinc-800/50 text-zinc-900 dark:text-white shadow-inner border border-white/20 dark:border-white/5"
                        : "text-zinc-800 dark:text-zinc-400 hover:bg-white/20 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-1.5 rounded-lg transition-colors ${hasActiveItem ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-white/20 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-400 group-hover:bg-white/40 dark:group-hover:bg-zinc-700"}`}
                      >
                        <group.icon className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold tracking-wide">
                        {group.title}
                      </span>
                    </div>
                    <motion.div
                      animate={{ rotate: isGroupOpen ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown
                        className={`w-4 h-4 ${isGroupOpen ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-500"}`}
                      />
                    </motion.div>
                  </button>

                  <AnimatePresence>
                    {isGroupOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-col gap-1 pl-11 pr-2 py-2 relative">
                          {/* Left connecting line */}
                          <div className="absolute left-6 top-0 bottom-4 w-px bg-zinc-200 dark:bg-zinc-800/50" />

                          {group.items.map((item) => {
                            const isActive = location.pathname === item.path;
                            return (
                              <Link
                                key={item.path}
                                to={item.path}
                                onClick={onClose}
                                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                                  isActive
                                    ? "bg-white/40 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-white/30 dark:border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                                    : "text-zinc-800 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/20 dark:hover:bg-zinc-800/30"
                                }`}
                              >
                                {/* Horizontal connecting line */}
                                <div className="absolute -left-5 top-1/2 w-3 h-px bg-white/30 dark:bg-zinc-800/50" />

                                <item.icon
                                  className={`w-4 h-4 ${isActive ? item.color : "text-zinc-700 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-300 transition-colors"}`}
                                />
                                <span
                                  className={`text-xs font-medium ${isActive ? "font-bold" : ""}`}
                                >
                                  {item.title}
                                </span>

                                {item.isBeta && (
                                  <span className="ml-2 px-1.5 py-0.5 rounded-md bg-white/30 dark:bg-zinc-800 text-[8px] font-black tracking-widest text-zinc-800 dark:text-zinc-500 uppercase">
                                    Beta
                                  </span>
                                )}

                                {isActive && !item.isBeta && (
                                  <motion.div
                                    layoutId="sidebar-active"
                                    className="ml-auto w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                                  />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          <div className="mt-8 space-y-1 pb-12">
            <p className="px-4 text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest mb-3">
              Sistema y Cuenta
            </p>
            {secondaryItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-800 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-white/20 dark:hover:bg-zinc-800/30 transition-all duration-200 group"
              >
                <div className="p-1.5 rounded-lg bg-white/20 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-400 group-hover:bg-white/40 dark:group-hover:bg-zinc-700 transition-colors">
                  <item.icon className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold tracking-wide">
                  {item.title}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200/50 dark:border-white/5 bg-[#4eb5ac] dark:bg-zinc-950 shrink-0">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all duration-200 group border border-transparent hover:border-rose-200 dark:hover:border-rose-500/20"
          >
            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="text-xs font-bold tracking-wide">
              Cerrar Sesión
            </span>
          </button>
          <div className="mt-4 text-center flex flex-col gap-1">
            <p className="text-[10px] font-medium text-zinc-800 dark:text-zinc-500">
              Praeventio Guard
            </p>
            <p className="text-[9px] text-zinc-700 dark:text-zinc-600">
              © 2026 Todos los derechos reservados
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
