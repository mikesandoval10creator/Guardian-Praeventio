import React from 'react';
import { motion } from 'framer-motion';
import { WisdomCapsule } from './WisdomCapsule';

export function ConsciousnessLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="flex flex-col items-center mb-10">
        <motion.img
          src="/mascot.png"
          alt="Guardian Praeventio"
          className="w-32 h-32 object-contain drop-shadow-xl"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div className="flex gap-1.5 mt-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full bg-emerald-500"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </motion.div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mt-3">
          Calibrando Conciencia...
        </span>
      </div>
      <WisdomCapsule />
    </div>
  );
}
