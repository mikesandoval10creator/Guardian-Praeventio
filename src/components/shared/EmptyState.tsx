import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  compact?: boolean;
  mascot?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, className = '', compact = false, mascot = false }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'} ${className}`}
    >
      {mascot ? (
        <picture>
          <source srcSet="/mascot.webp" type="image/webp" />
          <motion.img
            src="/mascot.png"
            alt="Guardian Praeventio"
            className={`${compact ? 'w-16 h-16' : 'w-24 h-24'} object-contain drop-shadow-lg mb-4`}
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </picture>
      ) : Icon ? (
        <div className={`${compact ? 'w-10 h-10' : 'w-14 h-14'} rounded-2xl bg-zinc-800/60 border border-white/5 flex items-center justify-center mb-4`}>
          <Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-zinc-500`} />
        </div>
      ) : null}
      <p className={`${compact ? 'text-sm' : 'text-base'} font-bold text-zinc-400 mb-1`}>{title}</p>
      {description && (
        <p className="text-xs text-zinc-600 max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
