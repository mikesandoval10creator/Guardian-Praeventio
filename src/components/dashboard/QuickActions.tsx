import { Zap, AlertCircle, Shield, FileText, Activity, BookOpen } from 'lucide-react';
import { Button } from '../shared/Card';
import { useNavigate } from 'react-router-dom';

export function QuickActions() {
  const navigate = useNavigate();
  const actions = [
    { icon: Zap, label: 'Fast Check', color: 'bg-amber-500', path: '/fast-check' },
    { icon: AlertCircle, label: 'Emergencia', color: 'bg-red-600', path: '/emergency' },
    { icon: Shield, label: 'Riesgos', color: 'bg-emerald-600', path: '/risks' },
    { icon: FileText, label: 'Normativas', color: 'bg-blue-600', path: '/normatives' },
    { icon: Activity, label: 'Higiene', color: 'bg-purple-600', path: '/hygiene' },
    { icon: BookOpen, label: 'Capacitación', color: 'bg-indigo-600', path: '/training' },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {actions.map((action) => (
        <Button
          key={action.label}
          variant="secondary"
          className="flex flex-col items-center gap-3 h-32 w-full p-4 rounded-3xl border-2 border-transparent hover:border-emerald-500/20 transition-all active:scale-95"
          onClick={() => navigate(action.path)}
        >
          <div className={`${action.color} p-3 rounded-2xl shadow-lg shadow-${action.color}/20`}>
            <action.icon className="w-6 h-6 text-white" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400">
            {action.label}
          </span>
        </Button>
      ))}
    </div>
  );
}
