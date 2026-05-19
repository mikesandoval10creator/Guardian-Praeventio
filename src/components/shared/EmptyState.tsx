import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { GuardianMascot, MascotMood } from './GuardianMascot';

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
  /** Optional mood override when `mascot` is true. Defaults to 'default'. */
  mascotMood?: MascotMood;
}

export function EmptyState({ icon: Icon, title, description, action, className = '', compact = false, mascot = false, mascotMood = 'default' }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8 px-4' : 'py-16 px-6'} ${className}`}
    >
      {mascot ? (
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className="drop-shadow-lg mb-4"
        >
          <GuardianMascot mood={mascotMood} size={compact ? 'sm' : 'md'} />
        </motion.div>
      ) : Icon ? (
        <div className={`${compact ? 'w-10 h-10' : 'w-14 h-14'} rounded-2xl bg-elevated border border-default-token flex items-center justify-center mb-4`}>
          <Icon className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-muted-token`} />
        </div>
      ) : null}
      {/* WCAG 1.4.3 — text-muted-token = #52525b (7.51:1 on light bg) */}
      <p className={`${compact ? 'text-sm' : 'text-base'} font-bold text-secondary-token mb-1`}>{title}</p>
      {description && (
        <p className="text-xs text-muted-token max-w-xs">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          // WCAG 2.5.8 — min 44x44px touch target
          className="mt-4 min-h-[44px] px-4 py-2 accent-bg accent-on-primary-text hover:opacity-90 rounded-xl text-xs font-black uppercase tracking-wider transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
