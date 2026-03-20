import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Home, Menu, ArrowLeft, Moon, User as UserIcon, Clock } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { AsesorChat } from '../shared/AsesorChat';

export function RootLayout() {
  const { user } = useFirebase();
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#22C55E] text-zinc-900 font-sans selection:bg-emerald-500/30 overflow-hidden flex flex-col">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <header className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between bg-[#22C55E]/95 backdrop-blur-lg border-b border-white/10">
        {/* Left Icons */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="w-9 h-9 bg-white/10 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/20 text-white hover:bg-white/20 transition-all shadow-sm group"
          >
            <Menu className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
          
          {!isHome && (
            <button 
              onClick={() => navigate(-1)}
              className="w-9 h-9 bg-white/10 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/20 text-white hover:bg-white/20 transition-all shadow-sm group"
            >
              <ArrowLeft className="w-5 h-5 group-hover:scale-110 transition-transform" />
            </button>
          )}

          {!isHome && (
            <Link to="/" className="w-9 h-9 bg-white/10 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/20 text-white hover:bg-white/20 transition-all shadow-sm group">
              <Home className="w-5 h-5 group-hover:scale-110 transition-transform" />
            </Link>
          )}
        </div>
        
        {/* Right Info */}
        <div className="flex items-center gap-4 text-white">
          <div className="hidden xs:flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.1em]">
              <Clock className="w-3 h-3 text-emerald-300" />
              <span>06:02 CL</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/10 hover:bg-white/20 transition-colors">
              <Moon className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2.5 bg-black/20 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-white/10 shadow-sm">
              <div className="w-6 h-6 bg-gradient-to-tr from-emerald-400 to-teal-500 rounded-lg flex items-center justify-center shadow-inner">
                <UserIcon className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-[8px] font-black uppercase tracking-widest leading-none">Guardia</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 no-scrollbar">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <AsesorChat />
    </div>
  );
}
