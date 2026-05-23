import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronDown,
  LogOut,
  ShieldAlert,
  Sun,
  Moon,
  WifiOff,
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
// Plan 2026-05-23 §P2 — la lista de menuGroups (227 LOC de data) se
// extrajo a un módulo aparte para reducir este archivo de 609 → ~380 LOC
// y dejar la estructura de navegación testeable en isolation.
import { buildSidebarMenuGroups } from "./sidebarMenuGroups";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode?: boolean;
  toggleTheme?: () => void;
}

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

  const menuGroups = buildSidebarMenuGroups(t, features, isAdmin);

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
