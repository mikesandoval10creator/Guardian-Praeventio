import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Home, Menu, ArrowLeft, User as UserIcon, Bell, Sun, Moon, Map, WifiOff, Search, Sparkles } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AsesorChat } from '../shared/AsesorChat';
import { useNotifications } from '../../contexts/NotificationContext';
import { EmergencyAlertBanner } from './EmergencyAlertBanner';
import { useAutonomousAlerts } from '../../hooks/useAutonomousAlerts';
import { ReloadPrompt } from './ReloadPrompt';

export function RootLayout() {
  const { user } = useFirebase();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [searchQuery, setSearchQuery] = useState('');

  // Initialize background watcher
  useAutonomousAlerts();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check local storage or system preference on initial load
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    // Apply theme class to html element
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white font-sans selection:bg-emerald-500/30 flex flex-col transition-colors duration-300">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <EmergencyAlertBanner />
      <ReloadPrompt />

      <header className="shrink-0 z-40 px-2 py-1.5 flex items-center justify-between bg-white/95 dark:bg-zinc-950/95 backdrop-blur-lg border-b border-zinc-100 dark:border-zinc-800 transition-colors duration-300">
        {/* Left: Menu & Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="w-8 h-8 bg-zinc-100 dark:bg-zinc-900 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all group"
          >
            <Menu className="w-4 h-4 group-hover:scale-110 transition-transform" />
          </button>
          
          {isHome ? (
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-[#22C55E] rounded flex items-center justify-center">
                <span className="text-white font-black text-xs leading-none">P</span>
              </div>
              <span className="text-sm font-black tracking-tight text-zinc-900 dark:text-white hidden sm:block">Praeventio</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => navigate(-1)}
                className="w-8 h-8 bg-zinc-100 dark:bg-zinc-900 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all group"
              >
                <ArrowLeft className="w-4 h-4 group-hover:scale-110 transition-transform" />
              </button>
              <Link to="/" className="w-8 h-8 bg-zinc-100 dark:bg-zinc-900 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all group">
                <Home className="w-4 h-4 group-hover:scale-110 transition-transform" />
              </Link>
            </div>
          )}
        </div>
        
        {/* Middle: Global Search & AI Help */}
        <div className="flex flex-1 max-w-xl mx-2 md:mx-4 relative">
          <div className="relative w-full flex items-center group">
            <Search className="absolute left-3 w-4 h-4 text-zinc-400 group-focus-within:text-emerald-500 transition-colors" />
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
              placeholder="Buscar..." 
              className="w-full bg-zinc-100 dark:bg-zinc-900 border-none rounded-full py-1.5 pl-9 pr-10 text-sm focus:ring-2 focus:ring-emerald-500/50 dark:text-white transition-all placeholder:text-zinc-500"
            />
            <button 
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-ai-chat', { detail: { query: searchQuery } }));
                setSearchQuery('');
              }}
              className="absolute right-1.5 p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full transition-colors"
              title="Preguntar a Gemini AI"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Notifications, Theme & Profile */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link 
            to="/safe-driving"
            className="w-8 h-8 bg-blue-50 dark:bg-blue-900/20 rounded flex items-center justify-center text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors relative"
            title="Modo Conducción Segura"
          >
            <Map className="w-4 h-4" />
          </Link>

          {!isOnline && (
            <div className="flex items-center gap-1 px-2 py-1 bg-rose-500/10 border border-rose-500/20 rounded text-rose-500">
              <WifiOff className="w-3 h-3" />
              <span className="text-[8px] font-black uppercase tracking-widest hidden sm:block">Offline</span>
            </div>
          )}

          <button 
            onClick={toggleTheme}
            className="w-8 h-8 bg-zinc-100 dark:bg-zinc-900 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors relative"
            aria-label="Toggle Dark Mode"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <Link 
            to="/notifications"
            className="w-8 h-8 bg-zinc-100 dark:bg-zinc-900 rounded flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors relative"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-red-500 rounded-full border border-white dark:border-zinc-950 flex items-center justify-center text-[8px] font-black text-white px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          
          <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 px-1.5 py-1 rounded cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">
            <div className="w-6 h-6 bg-zinc-800 dark:bg-zinc-700 rounded flex items-center justify-center">
              <UserIcon className="w-3 h-3 text-white" />
            </div>
            <div className="hidden sm:flex flex-col pr-1">
              <span className="text-[10px] font-bold text-zinc-900 dark:text-white leading-none">Admin</span>
              <span className={`text-[8px] font-medium ${isOnline ? 'text-emerald-500' : 'text-rose-500'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 pb-2 flex flex-col">
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
    </div>
  );
}
