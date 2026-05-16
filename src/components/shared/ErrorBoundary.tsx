import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Wifi, ShieldAlert, Settings } from 'lucide-react';
import { logger } from '../../utils/logger';
import { captureEmergencyError } from '../../lib/sentry';
import i18n from '../../i18n';

interface Props {
  children: ReactNode;
  silent?: boolean;
}

type ErrorCategory = 'network' | 'auth' | 'config' | 'runtime';

interface State {
  hasError: boolean;
  error: Error | null;
  category: ErrorCategory;
}

function classifyError(error: Error): ErrorCategory {
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('offline')) return 'network';
  if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('permission')) return 'auth';
  if (msg.includes('firebase') || msg.includes('config') || msg.includes('undefined') && msg.includes('apikey')) return 'config';
  return 'runtime';
}

const CATEGORY_COPY: Record<ErrorCategory, { title: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  network: {
    title: 'Sin conexión',
    description: 'Perdimos contacto con los servidores. Revisa tu conexión y volvemos a intentar.',
    icon: Wifi,
  },
  auth: {
    title: 'Sesión expirada',
    description: 'Tu sesión venció por seguridad. Inicia sesión nuevamente para continuar.',
    icon: ShieldAlert,
  },
  config: {
    title: 'Sistema en configuración',
    description: 'Estamos terminando de inicializar el entorno. Recarga en unos segundos.',
    icon: Settings,
  },
  runtime: {
    title: 'Sistema Interrumpido',
    description: 'Detectamos una anomalía. El Guardian ya está calibrando el sistema.',
    icon: AlertTriangle,
  },
};

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    category: 'runtime',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, category: classifyError(error) };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught error: ' + error.message, { componentStack: errorInfo.componentStack ?? '' });
    captureEmergencyError(error, {
      boundary: 'global',
      category: classifyError(error),
      componentStack: (errorInfo.componentStack ?? '').slice(0, 500),
    });
  }

  public override render() {
    if (this.state.hasError) {
      if (this.props.silent) {
        return (
          <div className="flex items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-white/5">
            <div className="flex items-center gap-2 text-zinc-500">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {i18n.t('errors.module_inactive', 'Módulo temporalmente inactivo')}
              </span>
            </div>
          </div>
        );
      }

      const errorMessage = this.state.error?.message || i18n.t('errors.unexpected', 'Error inesperado');
      const copy = CATEGORY_COPY[this.state.category];
      const Icon = copy.icon;
      const accentClass =
        this.state.category === 'network' ? 'text-amber-500'
        : this.state.category === 'auth' ? 'text-blue-500'
        : this.state.category === 'config' ? 'text-emerald-500'
        : 'text-red-500';

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950">
          <div className="max-w-sm w-full bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center text-center">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 bg-zinc-100 dark:bg-zinc-800 ${accentClass}`}>
              <Icon className="w-8 h-8" />
            </div>
            <h2 className={`text-lg font-black uppercase tracking-tighter mb-2 ${accentClass}`}>
              {i18n.t(`errors.category_${this.state.category}_title`, copy.title)}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed">
              {i18n.t(`errors.category_${this.state.category}_desc`, copy.description)}
            </p>
            <details className="w-full mb-5 text-left">
              <summary className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 cursor-pointer mb-2">Ver detalle técnico</summary>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl p-3 overflow-auto max-h-32">
                <pre className="text-[9px] font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{errorMessage}</pre>
              </div>
            </details>
            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-colors"
              >
                {i18n.t('errors.reload', 'Recargar')}
              </button>
              <button
                onClick={() => { window.location.href = '/'; }}
                className="w-full py-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-semibold uppercase tracking-widest text-[10px] transition-colors"
              >
                {i18n.t('errors.go_home', 'Ir al inicio')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
