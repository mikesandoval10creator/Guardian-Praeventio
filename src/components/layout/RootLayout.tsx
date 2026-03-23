import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Home, Menu, ArrowLeft, User as UserIcon, Bell } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AsesorChat } from '../shared/AsesorChat';

export function RootLayout() {
  const { user } = useFirebase();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900 font-sans selection:bg-emerald-500/30 flex flex-col">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <header className="sticky top-0 z-40 px-4 py-4 flex items-center justify-between bg-white/95 backdrop-blur-lg border-b border-zinc-100">
        {/* Left: Menu & Logo */}
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-600 hover:bg-zinc-200 transition-all group"
          >
            <Menu className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
          
          {isHome ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#22C55E] rounded-lg flex items-center justify-center">
                <span className="text-white font-black text-lg leading-none">P</span>
              </div>
              <span className="text-xl font-black tracking-tight text-zinc-900 hidden sm:block">Praeventio</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => navigate(-1)}
                className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-600 hover:bg-zinc-200 transition-all group"
              >
                <ArrowLeft className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </button>
              <Link to="/" className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-600 hover:bg-zinc-200 transition-all group">
                <Home className="w-5 h-5 group-hover:scale-110 transition-transform" />
              </Link>
            </div>
          )}
        </div>
        
        {/* Right: Notifications & Profile */}
        <div className="flex items-center gap-3">
          <button className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-600 hover:bg-zinc-200 transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-zinc-100"></span>
          </button>
          
          <div className="flex items-center gap-3 bg-zinc-100 px-2 py-1.5 rounded-xl cursor-pointer hover:bg-zinc-200 transition-colors">
            <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center">
              <UserIcon className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:flex flex-col pr-2">
              <span className="text-xs font-bold text-zinc-900 leading-none">Admin</span>
              <span className="text-[10px] text-zinc-500 font-medium">Online</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex-1 flex flex-col"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <AsesorChat />
    </div>
  );
}
