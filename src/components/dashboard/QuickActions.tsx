import { useTranslation } from 'react-i18next';
import { Zap, AlertCircle, Shield, FileText, Activity, BookOpen } from 'lucide-react';
import { Button } from '../shared/Card';
import { useNavigate } from 'react-router-dom';

export function QuickActions() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const actions = [
    { icon: Zap, key: 'quick_actions.fast_check', fallback: 'Fast Check', color: 'bg-amber-500', path: '/fast-check' },
    { icon: AlertCircle, key: 'quick_actions.emergency', fallback: 'Emergencia', color: 'bg-red-600', path: '/emergency' },
    { icon: Shield, key: 'quick_actions.risks', fallback: 'Riesgos', color: 'bg-emerald-600', path: '/risks' },
    { icon: FileText, key: 'quick_actions.normatives', fallback: 'Normativas', color: 'bg-blue-600', path: '/normatives' },
    { icon: Activity, key: 'quick_actions.hygiene', fallback: 'Higiene', color: 'bg-purple-600', path: '/hygiene' },
    { icon: BookOpen, key: 'quick_actions.training', fallback: 'Capacitación', color: 'bg-indigo-600', path: '/training' },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {actions.map((action) => (
        <Button
          key={action.key}
          variant="secondary"
          className="flex flex-col items-center gap-3 h-32 w-full p-4 rounded-3xl border-2 border-transparent hover:border-emerald-500/20 transition-all active:scale-95"
          onClick={() => navigate(action.path)}
        >
          <div className={`${action.color} p-3 rounded-2xl shadow-lg shadow-${action.color}/20`}>
            <action.icon className="w-6 h-6 text-white" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
            {t(action.key, action.fallback)}
          </span>
        </Button>
      ))}
    </div>
  );
}
