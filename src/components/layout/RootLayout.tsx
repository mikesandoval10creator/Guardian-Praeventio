import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Home, Menu, ArrowLeft, User as UserIcon, Bell, Sun, Moon, Map, WifiOff, Search, Sparkles, Cloud } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AsesorChat } from '../shared/AsesorChat';
import { useNotifications } from '../../contexts/NotificationContext';
import { EmergencyAlertBanner } from './EmergencyAlertBanner';
import { PendingInvitesBanner } from './PendingInvitesBanner';
import { SyncConflictBanner } from '../shared/SyncConflictBanner';
import { routeForCollection } from '../shared/syncConflictRoutes';
import { useAutonomousAlerts } from '../../hooks/useAutonomousAlerts';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useSessionExpiry } from '../../hooks/useSessionExpiry';
import { useZettelkastenIntelligence } from '../../hooks/useZettelkastenIntelligence';
import { SmartConnectionsPanel } from '../knowledge/SmartConnectionsPanel';
import { logger } from '../../utils/logger';
import { ReloadPrompt } from './ReloadPrompt';
import { SyncCenterModal } from '../shared/SyncCenterModal';
import { MFASetupModal } from '../auth/MFASetupModal';
import { NormativaSwitch } from '../normativa/NormativaSwitch';
import { ShieldAlert } from 'lucide-react';
import { getPendingActions } from '../../utils/pwa-offline';
import { get, set } from 'idb-keyval';
import { useTheme } from '../../contexts/ThemeContext';
import { CookieConsent } from '../legal/CookieConsent';
import { ModeSwitcher } from '../shared/ModeSwitcher';
import { SOSButton } from '../emergency/SOSButton';
import { EmergencyAutoBridge } from '../emergency/EmergencyAutoBridge';
import { AlertSchedulerMount } from '../predictive/AlertSchedulerMount';
import { useProject } from '../../contexts/ProjectContext';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { db as firestoreDb } from '../../services/firebase';

export function RootLayout() {
  const { user } = useFirebase();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  
  usePushNotifications();
  useSessionExpiry();

  const isHome = location.pathname === '/';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isMfaSetupOpen, setIsMfaSetupOpen] = useState(false);
  const [isMfaForced, setIsMfaForced] = useState(false);
  const [mfaSuccessCallback, setMfaSuccessCallback] = useState<(() => void) | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [mfaSetupCompleted, setMfaSetupCompleted] = useState<boolean>(false);

  useEffect(() => {
    const loadMfaStatus = async () => {
      const mfa = await get('mfa_setup_completed');
      setMfaSetupCompleted(mfa === 'true');
      
      // theme preference is managed by ThemeContext
    };
    loadMfaStatus();
  }, []);

  // Initialize background watcher
  useAutonomousAlerts();
  useZettelkastenIntelligence();

  useEffect(() => {
    const updatePendingCount = async () => {
      const actions = await getPendingActions();
      setPendingSyncCount(actions.length);
    };

    updatePendingCount();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const handleRequireMfa = async (e: any) => {
      const mfa = await get('mfa_setup_completed');
      if (mfa !== 'true') {
        setIsMfaSetupOpen(true);
        setIsMfaForced(e.detail?.isForced ?? true); // Force by default when required
        if (e.detail?.onSuccess) {
          setMfaSuccessCallback(() => e.detail.onSuccess);
        }
      } else {
        if (e.detail?.onSuccess) e.detail.onSuccess();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('require-mfa', handleRequireMfa);
    window.addEventListener('sync-actions-updated', updatePendingCount);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('require-mfa', handleRequireMfa);
      window.removeEventListener('sync-actions-updated', updatePendingCount);
    };
  }, []);

  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#4db6ac] dark:bg-zinc-950 text-zinc-900 dark:text-white font-sans selection:bg-[#4db6ac]/30 flex flex-col transition-colors duration-300">
      <CookieConsent />
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
      <div className="lg:ml-[300px] lg:w-[calc(100%-300px)]">
        <EmergencyAlertBanner />
        <PendingInvitesBanner />
        <SyncConflictBanner
          onOpenRecord={(collectionName, docId) => {
            // Mapping lives in the shared `routeForCollection` helper so it
            // can be unit-tested in isolation; see
            // `src/components/shared/syncConflictRoutes.ts`.
            const target = routeForCollection(collectionName, docId);
            if (target) {
              navigate(target);
            } else {
              logger.warn('SyncConflictBanner: no route mapping for collection', {
                collection: collectionName,
                docId,
              });
            }
          }}
        />
      </div>
      <ReloadPrompt />

      <header className="shrink-0 z-40 px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between bg-[#4db6ac]/95 dark:bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-200/50 dark:border-white/5 transition-colors duration-300 lg:ml-[300px] lg:w-[calc(100%-300px)] shadow-sm">
        {/* Left: Menu & Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Abrir Menú"
            className="w-10 h-10 bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 rounded-xl flex items-center justify-center text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all group lg:hidden shadow-sm"
          >
            <Menu className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
          
          {isHome ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#4db6ac] to-[#2a8a81] rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(77,182,172,0.3)]">
                <span className="text-white font-black text-lg leading-none">P</span>
              </div>
              <div className="flex flex-col hidden sm:flex">
                <span className="text-sm font-black tracking-tight text-zinc-900 dark:text-white leading-none">Praeventio</span>
                <span className="text-[10px] font-bold text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-widest mt-0.5">Guard</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigate(-1)}
                className="w-10 h-10 bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 rounded-xl flex items-center justify-center text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all group shadow-sm"
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              </button>
              <Link to="/" className="w-10 h-10 bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 rounded-xl flex items-center justify-center text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all group shadow-sm">
                <Home className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </Link>
            </div>
          )}
        </div>
        
        {/* Middle: Global Search & AI Help */}
        <div className="flex flex-1 max-w-xl mx-4 relative justify-end sm:justify-center">
          <div className="relative w-full max-w-[300px] sm:max-w-full flex items-center group hidden sm:flex">
            <Search className="absolute left-4 w-4 h-4 text-zinc-700 dark:text-zinc-500 group-focus-within:text-[#4db6ac] transition-colors" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery.trim()) {
                  window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { query: searchQuery } }));
                  setSearchQuery('');
                }
              }}
              placeholder="Buscar o preguntar a la IA..." 
              className="w-full bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 rounded-2xl py-2.5 pl-11 pr-12 text-sm focus:ring-2 focus:ring-[#4db6ac]/50 text-zinc-900 dark:text-white transition-all placeholder:text-zinc-700 dark:placeholder:text-zinc-500 shadow-inner"
            />
            <button 
              onClick={() => {
                if (!isOnline) return;
                window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { query: searchQuery } }));
                setSearchQuery('');
              }}
              disabled={!isOnline}
              className={`absolute right-2 p-1.5 rounded-xl transition-all duration-300 ${
                !isOnline ? 'bg-white/40 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 cursor-not-allowed' : 'bg-[#4db6ac]/10 hover:bg-[#4db6ac]/20 text-[#2a8a81] dark:text-[#4db6ac] hover:scale-105'
              }`}
              title={!isOnline ? 'Requiere conexión a internet' : 'Preguntar a Gemini AI'}
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
          
          {/* Mobile Search Button (Opens Chat) */}
          <button 
            onClick={() => {
              if (!isOnline) return;
              window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { query: '' } }));
            }}
            disabled={!isOnline}
            className={`sm:hidden w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm ${
              !isOnline ? 'bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 text-zinc-700 dark:text-zinc-400 cursor-not-allowed' : 'bg-[#4db6ac]/10 border border-[#4db6ac]/20 text-[#2a8a81] dark:text-[#4db6ac]'
            }`}
          >
            <Sparkles className="w-5 h-5" />
          </button>
        </div>

        {/* Right: Notifications, Theme & Profile */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Country normativa selector — visible on every page */}
          <div className="hidden md:block">
            <NormativaSwitch />
          </div>

          <Link
            to="/safe-driving"
            className="hidden sm:flex w-10 h-10 bg-blue-50 dark:bg-blue-500/10 border border-transparent dark:border-blue-500/20 rounded-xl items-center justify-center text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-all duration-300 relative shadow-sm"
            title="Modo Conducción Segura"
          >
            <Map className="w-5 h-5" />
          </Link>

          <button 
            onClick={() => setIsSyncModalOpen(true)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 relative shadow-sm border ${
              !isOnline 
                ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-500/20' 
                : 'bg-white/30 dark:bg-zinc-900 border-transparent dark:border-white/5 text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white'
            }`}
            title="Centro de Sincronización"
          >
            {!isOnline ? <WifiOff className="w-5 h-5" /> : <Cloud className="w-5 h-5" />}
            {pendingSyncCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] bg-orange-500 rounded-full border-2 border-white dark:border-zinc-950 flex items-center justify-center text-[9px] font-black text-white px-1 shadow-sm">
                {pendingSyncCount > 99 ? '99+' : pendingSyncCount}
              </span>
            )}
          </button>

          {!isOnline && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg text-rose-600 dark:text-rose-500 shadow-sm">
              <WifiOff className="w-3.5 h-3.5" />
              <span className="text-[9px] font-black uppercase tracking-widest hidden sm:block">Offline</span>
            </div>
          )}

          <button 
            onClick={toggleTheme}
            className="hidden sm:flex w-10 h-10 bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 rounded-xl items-center justify-center text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all duration-300 relative shadow-sm"
            aria-label="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <Link 
            to="/notifications"
            className="w-10 h-10 bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 rounded-xl flex items-center justify-center text-zinc-800 dark:text-zinc-400 hover:bg-white/50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all duration-300 relative shadow-sm"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] bg-[#4db6ac] dark:bg-[#d4af37] rounded-full border-2 border-white dark:border-zinc-950 flex items-center justify-center text-[9px] font-black text-white dark:text-zinc-900 px-1 shadow-sm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          
          {user ? (
            <div
              onClick={() => navigate('/profile')}
              className="flex items-center gap-2 bg-white/30 dark:bg-zinc-900 border border-transparent dark:border-white/5 px-2 py-1.5 rounded-xl cursor-pointer hover:bg-white/50 dark:hover:bg-zinc-800 transition-all duration-300 relative shadow-sm"
            >
              {mfaSetupCompleted === false && (
                <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-amber-500 rounded-full border-2 border-white dark:border-zinc-950 animate-pulse" />
              )}
              <div className="w-7 h-7 bg-gradient-to-br from-zinc-700 to-zinc-900 dark:from-zinc-600 dark:to-zinc-800 rounded-lg flex items-center justify-center shadow-inner">
                <UserIcon className="w-4 h-4 text-white" />
              </div>
              <div className="hidden sm:flex flex-col pr-1 sm:pr-2">
                <span className="text-[10px] sm:text-xs font-bold text-zinc-900 dark:text-white leading-none truncate max-w-[60px] sm:max-w-[100px]">{user.displayName || 'Mi perfil'}</span>
                <span className={`text-[9px] sm:text-[10px] font-medium mt-0.5 ${isOnline ? 'text-[#4db6ac] dark:text-[#4db6ac]' : 'text-rose-600 dark:text-rose-500'}`}>
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-2 bg-teal-400 hover:bg-teal-500 px-3 py-2 rounded-xl cursor-pointer transition-all shadow-sm"
            >
              <UserIcon className="w-4 h-4 text-zinc-950" />
              <span className="hidden sm:block text-[11px] font-black uppercase tracking-wider text-zinc-950">Iniciar sesión</span>
            </button>
          )}
        </div>
      </header>

      <MFASetupModal 
        isOpen={isMfaSetupOpen} 
        onClose={() => {
          setIsMfaSetupOpen(false);
          setMfaSuccessCallback(null);
        }} 
        onComplete={async () => {
          await set('mfa_setup_completed', 'true');
          setMfaSetupCompleted(true);
          setIsMfaSetupOpen(false);
          if (mfaSuccessCallback) {
            mfaSuccessCallback();
            setMfaSuccessCallback(null);
          }
        }} 
        isForced={isMfaForced}
      />

      <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar w-full px-2 sm:px-4 py-2 pb-2 flex flex-col lg:ml-[300px] lg:w-[calc(100%-300px)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex-1 flex flex-col min-h-0"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <AsesorChat />
      <SyncCenterModal isOpen={isSyncModalOpen} onClose={() => setIsSyncModalOpen(false)} />
      <SmartConnectionsPanel />

      {/* 4-mode UX dock — floating, post-login only (RootLayout never renders on landing). */}
      <div className="fixed bottom-4 right-4 z-50 pointer-events-auto">
        <ModeSwitcher />
      </div>

      {/* Sprint 14 — emergency bridge subscribes weather/company/motion to autoTrigger;
          SOSButton renders only in emergency mode. */}
      <EmergencyAutoBridge />
      <SOSButton />

      {/* Sprint 16 — predictive-alert scheduler. Mounts only when both a
          project AND a crew are resolved; renders nothing in the DOM. */}
      <PredictiveSchedulerSlot />
    </div>
  );
}

/**
 * Sprint 16 — thin wrapper that resolves the first crew in the selected
 * project and only mounts AlertSchedulerMount when both ids exist.
 * Probes are empty by default; upstream autonomous-alerts pipelines can
 * inject probes via a future context. The empty-probes path keeps
 * evaluation cheap (early-return inside the scheduler).
 */
function PredictiveSchedulerSlot() {
  const { selectedProject } = useProject();
  const [crewId, setCrewId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProject?.id) {
      setCrewId(null);
      return;
    }
    const q = query(
      collection(firestoreDb, 'crews'),
      where('projectId', '==', selectedProject.id),
      limit(1),
    );
    const un = onSnapshot(
      q,
      (snap) => setCrewId(snap.empty ? null : snap.docs[0].id),
      () => setCrewId(null),
    );
    return () => un();
  }, [selectedProject?.id]);

  if (!selectedProject?.id || !crewId) return null;
  return (
    <AlertSchedulerMount
      projectId={selectedProject.id}
      crewId={crewId}
      probes={[]}
    />
  );
}
