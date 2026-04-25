import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

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
    console.error('Uncaught error:', error, errorInfo);
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
          <div className="max-w-2xl w-full bg-white dark:bg-zinc-900 rounded-2xl p-8 shadow-xl border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-2xl font-black uppercase tracking-tighter text-red-600 mb-4">Sistema Interrumpido</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6 font-mono">
              Se ha detectado una anomalía en el flujo de datos. La conciencia del sistema requiere calibración.
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl p-4 mb-6 overflow-auto max-h-40">
              <pre className="text-[10px] font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {errorMessage}
              </pre>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-bold uppercase tracking-widest text-xs hover:opacity-90 transition-opacity"
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
