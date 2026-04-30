import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Link2,
  GraduationCap,
  AlertTriangle,
  ShieldCheck,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';
import { useZettelkastenIntelligence, SmartAction, SmartActionType } from '../../hooks/useZettelkastenIntelligence';

const ACTION_ICONS: Record<SmartActionType, React.ReactNode> = {
  link_risk_to_control: <Link2 className="w-4 h-4" />,
  assign_training: <GraduationCap className="w-4 h-4" />,
  create_incident_node: <AlertTriangle className="w-4 h-4" />,
  link_worker_to_epp: <ShieldCheck className="w-4 h-4" />,
  escalate_to_supervisor: <UserCheck className="w-4 h-4" />,
};

const PRIORITY_BADGE: Record<SmartAction['priority'], string> = {
  high: 'bg-red-500/20 text-red-400 border border-red-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-green-500/20 text-green-400 border border-green-500/30',
};

const PRIORITY_LABEL: Record<SmartAction['priority'], string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

const PRIORITY_ICON_WRAPPER: Record<SmartAction['priority'], string> = {
  high: 'bg-red-500/10 text-red-400',
  medium: 'bg-yellow-500/10 text-yellow-400',
  low: 'bg-green-500/10 text-green-400',
};

export function SmartConnectionsPanel() {
  const { smartActions } = useZettelkastenIntelligence();
  const [isExpanded, setIsExpanded] = useState(true);

  if (smartActions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed bottom-4 right-4 z-50 w-72 rounded-2xl shadow-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-xl overflow-hidden"
      role="complementary"
      aria-label="Acciones inteligentes Zettelkasten"
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/80 hover:bg-zinc-800 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Zap className="w-3.5 h-3.5" />
          </span>
          <span className="text-xs font-bold text-white tracking-wide">Acciones Inteligentes</span>
          <span className="min-w-[18px] h-[18px] bg-emerald-500 rounded-full flex items-center justify-center text-[9px] font-black text-white px-1">
            {smartActions.length}
          </span>
        </div>
        <span className="text-zinc-400">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </span>
      </button>

      {/* Action list */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.ul
            key="action-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {smartActions.map((action, idx) => (
              <li
                key={action.type}
                className={`flex items-start gap-3 px-4 py-3 ${
                  idx < smartActions.length - 1
                    ? 'border-b border-white/5'
                    : ''
                }`}
              >
                {/* Icon */}
                <span
                  className={`mt-0.5 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${PRIORITY_ICON_WRAPPER[action.priority]}`}
                >
                  {ACTION_ICONS[action.type]}
                </span>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-white leading-tight">
                      {action.label}
                    </span>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full ${PRIORITY_BADGE[action.priority]}`}
                    >
                      {PRIORITY_LABEL[action.priority]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-400 leading-snug line-clamp-2">
                    {action.description}
                  </p>
                  {action.relevantNodeIds.length > 0 && (
                    <span className="mt-1 inline-block text-[9px] text-zinc-500">
                      {action.relevantNodeIds.length} nodo{action.relevantNodeIds.length > 1 ? 's' : ''} afectado{action.relevantNodeIds.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
