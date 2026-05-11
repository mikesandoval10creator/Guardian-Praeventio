import { useState } from 'react';
import { ShieldAlert, X, Users, Zap, Building2 } from 'lucide-react';
import { signInWithGoogle } from '../../services/firebase';

interface GuestSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  industry?: string;
}

const PLANS = [
  {
    name: 'Gratuito',
    price: '$0',
    workers: '10',
    icon: Users,
    border: 'border-zinc-600',
    badge: null,
  },
  {
    name: 'Comité',
    price: '$10/mes',
    workers: '25',
    icon: Zap,
    border: 'border-[#4db6ac]',
    badge: 'POPULAR',
  },
  {
    name: 'Empresa',
    price: '$30/mes',
    workers: '100+',
    icon: Building2,
    border: 'border-violet-500',
    badge: null,
  },
];

export function GuestSaveModal({ isOpen, onClose, industry }: GuestSaveModalProps) {
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleGoogle = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-save-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative bg-surface border border-default-token rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-token hover:text-primary-token transition-colors"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-xl accent-bg flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-white" />
          </div>
          <h2 id="guest-save-title" className="text-sm font-black text-primary-token uppercase tracking-tight">
            Guarda tu proyecto gratis
          </h2>
        </div>
        {industry && (
          <p className="text-[10px] text-muted-token mb-3 ml-10">
            Proyecto: <span className="text-secondary-token font-bold">{industry}</span>
          </p>
        )}

        {/* Plans */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.name}
                className={`relative border ${plan.border} rounded-xl p-2.5 flex flex-col items-center gap-1 bg-elevated`}
              >
                {plan.badge && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#4db6ac] text-white text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    {plan.badge}
                  </span>
                )}
                <Icon className="w-4 h-4 text-muted-token mt-1" />
                <p className="text-[9px] font-black text-primary-token">{plan.name}</p>
                <p className="text-[8px] text-muted-token">{plan.workers} trabajadores</p>
                <p className="text-[10px] font-black accent-text">{plan.price}</p>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 accent-bg hover:opacity-90 text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl transition-opacity disabled:opacity-60"
        >
          {loading ? (
            <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          Continuar con Google
        </button>

        <p className="text-center text-[9px] text-muted-token mt-2">
          Gratis hasta 10 trabajadores · Sin tarjeta de crédito
        </p>
      </div>
    </div>
  );
}
