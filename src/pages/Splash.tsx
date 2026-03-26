import { motion } from 'framer-motion';

interface SplashProps {
  onEnter: () => void;
}

export function Splash({ onEnter }: SplashProps) {
  return (
    <div className="min-h-screen bg-[#58D66D] flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center w-full max-w-3xl mx-auto"
      >
        <h1 className="text-5xl sm:text-7xl md:text-9xl font-black tracking-tighter text-zinc-950 mb-3 sm:mb-4 leading-none">
          Praeventio
        </h1>
        <p className="text-lg sm:text-xl md:text-2xl font-medium text-zinc-800 mb-8 sm:mb-12">
          Haz clic para entrar
        </p>
        
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onEnter}
          className="bg-[#B666FF] text-white px-8 sm:px-12 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-black uppercase tracking-widest shadow-xl hover:shadow-2xl transition-all w-full sm:w-auto max-w-xs mx-auto"
        >
          Entrar
        </motion.button>
      </motion.div>
    </div>
  );
}
