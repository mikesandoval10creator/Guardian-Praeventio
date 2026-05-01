import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { logger } from '../../utils/logger';

interface Props {
  children: ReactNode;
  silent?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught error: ' + error.message, { componentStack: errorInfo.componentStack ?? '' });
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.silent) {
        return (
          <div className="flex items-center justify-center p-4 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-white/5">
            <div className="flex items-center gap-2 text-zinc-500">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Módulo temporalmente inactivo</span>
            </div>
          </div>
        );
      }

      const errorMessage = this.state.error?.message || 'Error inesperado';

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950">
          <div className="max-w-sm w-full bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center text-center">
            <img
              src="/mascot.png"
              alt="Guardian Praeventio"
              className="w-24 h-24 object-contain mb-4 opacity-80"
              style={{ filter: 'grayscale(30%)' }}
            />
            <h2 className="text-lg font-black uppercase tracking-tighter text-red-500 mb-2">Sistema Interrumpido</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed">
              Se detectó una anomalía. El Guardian está calibrando el sistema.
            </p>
            <details className="w-full mb-5 text-left">
              <summary className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 cursor-pointer mb-2">Ver detalle técnico</summary>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl p-3 overflow-auto max-h-32">
                <pre className="text-[9px] font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{errorMessage}</pre>
              </div>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-colors"
            >
              Reiniciar Conciencia
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
