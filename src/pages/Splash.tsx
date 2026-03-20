import { motion } from 'framer-motion';

interface SplashProps {
  onEnter: () => void;
}

export function Splash({ onEnter }: SplashProps) {
  return (
    <div className="min-h-screen bg-[#58D66D] flex flex-col items-center justify-center p-6 font-sans">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center"
      >
        <h1 className="text-7xl md:text-9xl font-black tracking-tighter text-zinc-950 mb-4">
          Praeventio
        </h1>
        <p className="text-xl md:text-2xl font-medium text-zinc-800 mb-12">
          Haz clic para entrar
        </p>
        
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onEnter}
          className="bg-[#B666FF] text-white px-12 py-4 rounded-2xl text-xl font-black uppercase tracking-widest shadow-xl hover:shadow-2xl transition-all"
        >
          Entrar
        </motion.button>
      </motion.div>
    </div>
  );
}
