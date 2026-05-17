import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  Zap,
  Map,
  FileText,
  Layout,
  LayoutGrid,
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
  ListChecks,
  ScanLine,
  Inbox as InboxIcon,
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
  Moon,
  Droplet,
  WifiOff,
  LayoutDashboard,
  Stethoscope,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ProjectSelector } from "./ProjectSelector";
import { logOut } from "../../services/firebase";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useSubscription } from "../../contexts/SubscriptionContext";
import { useFirebase } from "../../contexts/FirebaseContext";
import { NormativaSwitch } from "../normativa/NormativaSwitch";

import { SurvivalMode } from "../emergency/SurvivalMode";
import { logger } from '../../utils/logger';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
  toggleTheme?: () => void;
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

export function Sidebar({ isOpen, onClose, isDarkMode, toggleTheme }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  // Use the granular `canUseExecutiveDashboard` flag (oro+) instead of the
  // coarse `isEnterprise` (empresarial+). The route guard in
  // ExecutiveDashboard.tsx already opens at oro+ — the sidebar entry was
  // hidden until empresarial, which made the route undiscoverable for
  // ~1500 customers in oro/titanio/diamante. (R4 Round 14.)
  const { features } = useSubscription();
  // Sprint 23 Bucket CC — admin role gates the B2D panel item.
  const { isAdmin } = useFirebase();
  const [showSurvivalMode, setShowSurvivalMode] = useState(false);

  const menuGroups: MenuGroup[] = [
    {
      title: t("nav.command_center", "Centro de Mando"),
      icon: Home,
      items: [
        { title: t("nav.dashboard", "Inicio"), icon: Home, path: "/", color: "text-[#4db6ac]" },
        // Sprint 40 Fase F.8 — Bandeja del Prevencionista. Pendientes
        // de hoy agregados de múltiples feeds (corrective actions, SIF,
        // exceptions, etc.) en una vista única ordenada por urgencia.
        { title: t("nav.inbox", "Bandeja"), icon: InboxIcon, path: "/inbox", color: "text-teal-500" },
        { title: "Safe Driving", icon: Car, path: "/safe-driving", color: "text-blue-500" },
        { title: t("nav.safety_feed", "Muro Social"), icon: Users, path: "/safety-feed", color: "text-[#4db6ac]" },
        { title: t("nav.projects", "Proyectos"), icon: Briefcase, path: "/projects", color: "text-blue-500" },
        { title: t("nav.cuadrillas", "Cuadrillas"), icon: Users, path: "/cuadrillas", color: "text-[#4db6ac]" },
        // Sprint 41 Fase F.16 — Score de Preparación del Trabajador.
        // Asistente NO bloqueante; muestra training/EPP/fatiga/historial
        // del trabajador para que el supervisor decida con criterio.
        { title: t("nav.worker_readiness", "Preparación Trabajador"), icon: UserCheck, path: "/worker-readiness", color: "text-teal-500" },
        // Sprint 28 Bucket B5 — CPHS formal module (audit hallazgo H29 P1).
        // Apunta a /cphs (registro formal con quórum DS 54 + firmas WebAuthn).
        // El link legacy a /comite-paritario sigue disponible en ModuleHub para
        // las actas en formato libre hasta que la migración del próximo
        // sprint consolide ambos en /cphs.
        { title: t("nav.cphs", "Comité Paritario (CPHS)"), icon: ShieldCheck, path: "/cphs", color: "text-[#4db6ac]" },
        // Sprint 40 Fase F.7 — sub-link al borrador mensual automático.
        { title: t("nav.cphs_draft", "Minuta CPHS"), icon: FileText, path: "/cphs/draft-minute", color: "text-teal-500" },
        { title: t("nav.mining_contractors", "Contratistas Mineros"), icon: Mountain, path: "/mining-contractors", color: "text-amber-500" },
        { title: t("nav.analytics", "Reportabilidad"), icon: BarChart3, path: "/analytics", color: "text-zinc-400" },
        // Sprint 40 Fase F.4 — Centro de Acciones Correctivas (PDCA).
        // Acceso directo desde Cumplimiento — cierra ISO 45001 §10.2.
        { title: t("nav.corrective_actions", "Acciones Correctivas"), icon: ListChecks, path: "/corrective-actions", color: "text-teal-500" },
        // Sprint K §131-138 — Cierre de Proyecto + Lecciones Transferibles +
        // Decisiones Críticas + Resúmenes Multi-Rol. Cierra el ciclo
        // completo: extrae lecciones publicables (scope='industry'),
        // registra decisiones críticas, y genera resúmenes adaptados al rol.
        { title: t("nav.project_closure", "Cierre de Proyecto"), icon: Briefcase, path: "/closure", color: "text-violet-500" },
        // Sprint K §195-200 — Módulo PDCA + No Conformidades (ISO 45001 §10.2).
        // Kanban Plan/Do/Check/Act sobre ciclos vinculados a NCs.
        { title: t("nav.pdca", "PDCA + No Conformidades"), icon: Activity, path: "/pdca", color: "text-teal-500" },
        // Sprint K §291-295 — Revisión Anual del SGI (ISO 45001 §9.3 + DS 76).
        // Cierra el ciclo PDCA a nivel anual: objetivos preventivos,
        // evidencias y conclusiones firmadas por la dirección.
        { title: t("nav.annual_review", "Revisión Anual SGI"), icon: ClipboardCheck, path: "/annual-review", color: "text-violet-500" },
        // Sprint K §296-301 — Riesgo Residual + Aceptación Formal +
        // Detector de Criticidad Sospechosa. ISO 31000 risk-flow:
        // residual >= alto requiere firma de gerencia, drift sospechoso
        // se marca para revisión humana sin bloquear operación.
        { title: t("nav.residual_risk", "Riesgo Residual"), icon: AlertOctagon, path: "/residual-risk", color: "text-rose-500" },
        // Sprint K §90-91 — Calidad de Proveedores + Ranking de Riesgo.
        // Motor determinístico (supplierScoring 4-dim) ya vivía; este link
        // hace visible el ranking para decisiones de adjudicación.
        { title: t("nav.suppliers", "Proveedores"), icon: Truck, path: "/suppliers", color: "text-blue-500" },
        // Sprint K §214-215 — Observaciones Positivas + Balance.
        // Contrapunto cultural a las CA: reconocer comportamientos
        // seguros + ideas de mejora. El widget de balance pinta la
        // salud cultural (cultura punitiva si solo hay correctivas).
        { title: t("nav.positive_observations", "Observaciones Positivas"), icon: Award, path: "/positive-observations", color: "text-teal-500" },
        // Sprint 42 Fase F.6 — Modo Sin Señal para Inspecciones.
        // Offline-first daily ops: inspector captura hallazgos en
        // terreno sin conexión, sync diferido cuando vuelve la red.
        { title: t("nav.inspections", "Inspecciones"), icon: ClipboardCheck, path: "/inspections", color: "text-blue-500" },
        // §42-44 — Inventario Controles de Ingeniería + Jerarquía ISO 31000.
        // Audita la jerarquía de controles aplicados (elimination >
        // substitution > engineering > administrative > epp) y la
        // vigencia de cada verificación (verde/ámbar/rojo).
        { title: t("nav.engineering_controls", "Controles de Ingeniería"), icon: Layers, path: "/engineering-controls", color: "text-violet-500" },
        // Sprint K §61-63 — Cultura Preventiva (encuesta + índice).
        // Pulso periódico anónimo (Likert 1-5) que mide percepción y
        // detecta cultura punitiva. Cierra la fase de "Detección
        // Predictiva" del Flow Infinito para liderazgo.
        { title: t("nav.culture_pulse", "Cultura Preventiva"), icon: HeartPulse, path: "/culture-pulse", color: "text-rose-500" },
        // Sprint 40 Fase F.5 — Firma QR de Recepción (EPP, charlas, docs).
        // Genera challenge HMAC + TTL corto; firma del trabajador queda
        // como comprobante interno (no se empuja a SUSESO/SII/MINSAL).
        { title: t("nav.qr_signature", "Firma QR"), icon: ScanLine, path: "/qr-signature", color: "text-violet-500" },
        // Sprint 41 Fase F.26 — Índice de Madurez Preventiva.
        // Score 1..5 con palancas para subir de nivel (marketing + upsell).
        { title: t("nav.maturity_index", "Índice de Madurez"), icon: Award, path: "/maturity-index", color: "text-violet-500" },
        // Sprint 42 Fase F.15 — Centro de Permisos de Trabajo.
        // LOTO / altura / caliente / confinado / excavación / izaje — DS 594, DS 132, DS 109.
        { title: t("nav.work_permits", "Permisos de Trabajo"), icon: ShieldCheck, path: "/work-permits", color: "text-amber-500" },
        // Sprint 40 Fase F.12 — Biblioteca de Lecciones Aprendidas.
        // Conocimiento reutilizable derivado de incidentes cerrados;
        // hace navegable lo que ya vivía como nodos LESSON en el grafo.
        { title: t("nav.lessons_learned", "Lecciones Aprendidas"), icon: BookOpen, path: "/lessons", color: "text-amber-500" },
        // Sprint 40 Fase F.21 — Panel de Riesgo por Turno (pre-turno).
        // Supervisor lo abre ANTES de iniciar el turno para ver score
        // global + factores trazables + top recomendaciones.
        { title: t("nav.pre_shift_risk", "Pre-turno"), icon: Sun, path: "/pre-shift-risk", color: "text-amber-500" },
        // Sprint 40 Fase F.13 — Radar de Riesgos Repetidos (patrones
        // determinísticos sobre incidentes, sin ML). Sólo asiste — nunca
        // bloquea operación. Acompaña Acciones Correctivas: el radar
        // detecta el patrón, las CA lo cierran.
        { title: t("nav.repeating_risks", "Patrones de Riesgo"), icon: AlertTriangle, path: "/repeating-risks", color: "text-rose-500" },
        // Sprint 41 Fase F.20 — Gestor de Simulacros (DS 132 / DS 594).
        // Planifica + ejecuta + reporta preparación (excellent → critical).
        { title: t("nav.drills", "Gestor de Simulacros"), icon: ShieldAlert, path: "/drills", color: "text-amber-500" },
        // Sprint K §74-78 — Brigada de Emergencia + Inventario de Recursos.
        // Brigadistas por rol (líder / fuego / primeros aux / evac / comms)
        // + extintores / AED / lavaojos / botiquines con QR + countdown
        // de inspección. Determinístico, sin push a SUSESO/MINSAL.
        { title: t("nav.emergency_brigade", "Brigada Emergencia"), icon: ShieldAlert, path: "/emergency-brigade", color: "text-amber-500" },
        // Sprint K §276-277 — Bitácora de Decisiones de Supervisión + Ranking
        // de Impacto. Liderazgo preventivo trazable (NO castiga, mide qué
        // decisiones evitan más riesgo). Auditoría real para el SGSST.
        { title: t("nav.leadership_decisions", "Decisiones Supervisión"), icon: User, path: "/leadership-decisions", color: "text-blue-500" },
        ...(features.canUseExecutiveDashboard ? [{ title: t("nav.executive_dashboard", "Dashboard Ejecutivo"), icon: BarChart3, path: "/executive-dashboard", color: "text-violet-500" }] : []),
      ],
    },
    {
      title: t("nav.ai_group", "Inteligencia Artificial"),
      icon: Brain,
      items: [
        { title: t("nav.ai_hub", "AI Hub"), icon: Zap, path: "/ai-hub", color: "text-violet-500" },
        { title: "Coach de Seguridad", icon: Brain, path: "/safety-coach", color: "text-[#4db6ac]" },
        { title: t("nav.zettelkasten", "Zettelkasten"), icon: Database, path: "/zettelkasten", color: "text-blue-500" },
        { title: t("nav.knowledge_base", "Base de Conocimiento"), icon: Database, path: "/knowledge-base", color: "text-violet-500" },
        { title: "Pizarra", icon: LayoutDashboard, path: "/pizarra", color: "text-indigo-400" },
        { title: t("nav.academic_processor", "Procesador Académico"), icon: BookOpen, path: "/academic-processor", color: "text-violet-500" },
        { title: t("nav.ocr_motor", "Motor OCR"), icon: Scan, path: "/document-ocr", color: "text-violet-400" },
        { title: "Rastreador Solar", icon: Sun, path: "/sun-tracker", color: "text-amber-500" },
        // Sprint 29 Bucket AA F-A — hub de las 12 calculadoras Bernoulli/Euler.
        { title: "Calculadoras Especializadas", icon: Wrench, path: "/calculators", color: "text-[#4db6ac]" },
      ],
    },
    {
      title: t("nav.ops_group", "Módulos Operativos"),
      icon: LayoutGrid,
      items: [
        { title: t("nav.ops_mgmt", "Gestión Operativa"), icon: Briefcase, path: "/hub/operations", color: "text-blue-500" },
        { title: t("nav.risk_network", "Prevención y Riesgos"), icon: ShieldAlert, path: "/hub/risks", color: "text-violet-500" },
        { title: t("nav.health", "Salud y Bienestar"), icon: HeartPulse, path: "/hub/health", color: "text-rose-500" },
        { title: t("nav.emergencies", "Entorno y Emergencias"), icon: AlertTriangle, path: "/hub/emergencies", color: "text-amber-500" },
        { title: t("nav.compliance", "Cumplimiento Legal"), icon: ClipboardCheck, path: "/hub/compliance", color: "text-[#4db6ac]" },
        { title: t("nav.culture", "Talento y Cultura"), icon: Users, path: "/hub/training", color: "text-indigo-500" },
        { title: t("nav.afiches", "Afiches de Seguridad"), icon: Printer, path: "/afiches-seguridad", color: "text-blue-400" },
        { title: t("nav.digital_twin", "Gemelo Digital 3D"), icon: Layers, path: "/hub/operations/digital-twin", color: "text-cyan-400" },
      ],
    },
    {
      title: t("nav.occupational_health_group", "Salud Ocupacional"),
      icon: Stethoscope,
      items: [
        { title: t("nav.human_body_viewer", "Visor Corporal DIAT"), icon: Activity, path: "/human-body", color: "text-rose-500" },
        { title: t("nav.medicine", "Medicina"), icon: HeartPulse, path: "/medicine", color: "text-rose-400" },
        { title: t("nav.hygiene", "Higiene Industrial"), icon: Droplets, path: "/hygiene", color: "text-blue-400" },
        { title: t("nav.ergonomics", "Ergonomía"), icon: UserCheck, path: "/ergonomics", color: "text-amber-400" },
      ],
    },
    {
      title: t("nav.settings_group", "Configuración"),
      icon: Settings,
      items: [
        { title: t("nav.profile", "Mi Perfil"), icon: User, path: "/profile", color: "text-zinc-400" },
        // Sprint 23 Bucket FF — Ley 19.628 data-subject control center.
        { title: t("nav.my_data", "Mis datos"), icon: ShieldCheck, path: "/my-data", color: "text-[#4db6ac]" },
        { title: t("nav.settings", "Ajustes"), icon: Settings, path: "/settings", color: "text-zinc-400" },
        { title: t("nav.pricing", "Planes y Facturación"), icon: Key, path: "/pricing", color: "text-zinc-400" },
        { title: t("nav.help", "Ayuda y Soporte"), icon: HelpCircle, path: "/help", color: "text-zinc-400" },
      ],
    },
    // Sprint 23 Bucket CC — Admin group, only visible to admin role.
    ...(isAdmin
      ? [{
          title: t("nav.admin_group", "Admin"),
          icon: ShieldCheck,
          items: [
            { title: t("nav.b2d_admin", "Panel B2D"), icon: Key, path: "/admin/b2d", color: "text-[#d4af37]" },
          ],
        }]
      : []),
  ];

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
      logger.error("Error logging out:", error);
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
      <nav
        aria-label="Navegación principal"
        id="primary-navigation"
        className={`fixed top-0 left-0 bottom-0 w-[280px] sm:w-[300px] bg-surface border-r border-default-token z-[70] flex flex-col shadow-mode-lg transition-transform duration-300 ${isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Header */}
        <div className="p-4 border-b border-default-token flex items-center justify-between bg-elevated shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-[#4db6ac] to-[#2a8a81] rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(77,182,172,0.3)] relative">
              <span className="text-white font-black text-lg leading-none">
                P
              </span>
              {!isOnline && (
                // Sprint 20 19th-wave (Bucket C): badge is non-interactive (no focus, no click); native title= is invisible to keyboard and screen readers. role="img" + aria-label gives proper SR semantic; the visible text "Búnker" pill below already conveys this for sighted users so a Tooltip wrapper is not warranted here.
                <div
                  role="img"
                  aria-label="Modo Búnker (Offline)"
                  className="absolute -bottom-1 -right-1 w-4 h-4 bg-amber-500 rounded-full border-2 border-[#4db6ac] dark:border-zinc-950 flex items-center justify-center"
                >
                  <WifiOff className="w-2 h-2 text-white" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tight text-primary-token leading-none">
                Praeventio
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-bold text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-widest">
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
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú de navegación"
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
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={isGroupOpen}
                    aria-controls={`nav-group-${group.title.replace(/\s+/g, '-').toLowerCase()}`}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 ${
                      isGroupOpen || hasActiveItem
                        ? "bg-canvas text-primary-token shadow-mode border border-default-token"
                        : "text-zinc-800 dark:text-zinc-400 hover:bg-white/20 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-1.5 rounded-lg transition-colors ${hasActiveItem ? "bg-[#4db6ac]/10 dark:bg-[#d4af37]/20 text-[#4db6ac] dark:text-[#d4af37]" : "bg-white/20 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-400 group-hover:bg-white/40 dark:group-hover:bg-zinc-700"}`}
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
                        className={`w-4 h-4 ${isGroupOpen ? "text-[#4db6ac] dark:text-[#d4af37]" : "text-zinc-700 dark:text-zinc-500"}`}
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
                        id={`nav-group-${group.title.replace(/\s+/g, '-').toLowerCase()}`}
                        role="region"
                        aria-label={`Submenú ${group.title}`}
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
                                aria-current={isActive ? "page" : undefined}
                                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                                  isActive
                                    ? "bg-white/40 dark:bg-[#d4af37]/10 text-[#2a8a81] dark:text-[#d4af37] border border-white/30 dark:border-[#d4af37]/20 shadow-[0_0_15px_rgba(77,182,172,0.08)]"
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
                                    className="ml-auto w-1.5 h-1.5 bg-[#4db6ac] dark:bg-[#d4af37] rounded-full shadow-[0_0_8px_rgba(77,182,172,0.8)]"
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
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default-token bg-elevated shrink-0 space-y-2">
          {/* Country normativa selector — mobile only (topbar covers md+) */}
          <div className="md:hidden flex justify-center pb-2 border-b border-zinc-200/50 dark:border-white/5">
            <NormativaSwitch />
          </div>

          <button
            onClick={() => setShowSurvivalMode(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-rose-600 dark:text-rose-500 bg-rose-500/10 hover:bg-rose-500/20 transition-all duration-200 border border-rose-500/20"
          >
            <ShieldAlert className="w-4 h-4" />
            <span className="text-xs font-bold tracking-wide uppercase">
              {t("nav.survival_mode", "Modo Supervivencia")}
            </span>
          </button>
          
          {toggleTheme && (
            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-zinc-800 dark:text-zinc-400 hover:bg-white/20 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200 transition-all duration-200 border border-transparent"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span className="text-xs font-bold tracking-wide">
                {isDarkMode ? t("nav.theme_light", "Modo Claro") : t("nav.theme_dark", "Modo Oscuro")}
              </span>
            </button>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all duration-200 group border border-transparent hover:border-rose-200 dark:hover:border-rose-500/20"
          >
            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span className="text-xs font-bold tracking-wide">
              {t("nav.logout", "Cerrar Sesión")}
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
      </nav>

      {showSurvivalMode && (
        <SurvivalMode onClose={() => setShowSurvivalMode(false)} />
      )}
    </>
  );
}
