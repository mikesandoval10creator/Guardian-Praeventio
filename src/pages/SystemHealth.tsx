// Praeventio Guard — Sistema de salud (end-to-end wire de PR #249/#253).
//
// Esta página cierra el wire de `<ResilienceHealthDashboard />` (que
// llevaba meses como pieza presentational sin estar montada en ningún
// route). Une:
//
//   useResilienceHealth (hook con checkers REALES: SLM, ZK, Firestore,
//                        KEK, encrypted_kv, network)
//        │
//        ▼
//   <ResilienceHealthDashboard report={...} onRefresh={refresh} />
//
// Disponible en /settings/system-health (route registrada en App.tsx)
// + accesible desde el menu del header.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useResilienceHealth } from '../hooks/useResilienceHealth';
import { ResilienceHealthDashboard } from '../components/observability/ResilienceHealthDashboard';
import { humanErrorMessage } from '../lib/humanError';


export function SystemHealth() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { report, loading, error, refresh } = useResilienceHealth();

  return (
    <main
      data-testid="system-health-page"
      className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-4"
    >
      <header className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={t('common.back', 'Volver') as string}
          className="p-2 rounded-md hover:bg-stone-500/10"
          data-testid="system-health-back"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <Activity className="w-7 h-7 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-stone-900 dark:text-white">
            {t('systemHealth.title', 'Salud del sistema')}
          </h1>
          <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5">
            {t(
              'systemHealth.subtitle',
              'Estado de los subsistemas que garantizan que la app NUNCA falla offline.',
            )}
          </p>
        </div>
      </header>

      {error && !report && (
        <div
          data-testid="system-health-error"
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2"
        >
          <AlertTriangle
            className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-bold text-rose-800 dark:text-rose-200">
              {t('systemHealth.errorTitle', 'No se pudo medir la salud')}
            </p>
            <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5 font-mono">
              {humanErrorMessage(error)}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 inline-flex items-center px-2.5 py-1 rounded-md bg-rose-600 text-white text-xs font-bold hover:brightness-110"
              data-testid="system-health-retry"
            >
              {t('systemHealth.retry', 'Reintentar')}
            </button>
          </div>
        </div>
      )}

      {!report && !error && (
        <div
          data-testid="system-health-loading"
          className="rounded-lg border border-stone-500/20 bg-white/40 dark:bg-stone-900/30 p-6 text-center"
        >
          <p className="text-sm text-stone-600 dark:text-stone-400 animate-pulse">
            {t('systemHealth.loading', 'Midiendo subsistemas…')}
          </p>
        </div>
      )}

      {report && (
        <ResilienceHealthDashboard
          report={report}
          onRefresh={() => void refresh()}
          refreshing={loading}
        />
      )}

      <p className="text-[10px] text-stone-500 dark:text-stone-500 italic text-center">
        {t(
          'systemHealth.autoRefresh',
          'Se actualiza automáticamente cada 5 minutos.',
        )}
      </p>
    </main>
  );
}

export default SystemHealth;
