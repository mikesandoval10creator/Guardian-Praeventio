// Praeventio Guard — Wire UI #7: <AuditExpressButton />
//
// "Carpeta de Fiscalización" — single-click button that triggers the
// bundle generation (server-side Cloud Function builds ZIP + signed URL).
// Client only orchestrates the request + spinner + download.
//
// Used in: ProjectDetail header. The actual ZIP is built server-side;
// this component is the UX entry point.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderArchive, Loader2, Check, AlertTriangle } from 'lucide-react';

interface AuditExpressButtonProps {
  projectId: string;
  /** Async caller — typically `POST /api/audit/express-bundle?projectId=`. */
  onRequest: (projectId: string) => Promise<{ downloadUrl: string; expiresAt: string }>;
  /** Optional: triggered with download URL once ready. */
  onReady?: (downloadUrl: string, expiresAt: string) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string; expiresAt: string }
  | { kind: 'error'; message: string };

export function AuditExpressButton({ projectId, onRequest, onReady }: AuditExpressButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function trigger() {
    setState({ kind: 'loading' });
    try {
      const result = await onRequest(projectId);
      setState({ kind: 'ready', url: result.downloadUrl, expiresAt: result.expiresAt });
      onReady?.(result.downloadUrl, result.expiresAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      setState({ kind: 'error', message });
    }
  }

  if (state.kind === 'ready') {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="audit-express-ready"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 transition-colors"
      >
        <Check className="w-4 h-4" aria-hidden="true" />
        {t('audit_express.download', 'Descargar Carpeta Fiscalización')}
      </a>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        data-testid="audit-express-error"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 text-sm border border-rose-500/30"
        role="alert"
      >
        <AlertTriangle className="w-4 h-4" aria-hidden="true" />
        <span>{t('audit_express.error', 'Falla al generar:')} {state.message}</span>
        <button
          type="button"
          onClick={trigger}
          className="ml-2 text-xs underline font-semibold"
        >
          {t('audit_express.retry', 'Reintentar')}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={state.kind === 'loading'}
      data-testid="audit-express-button"
      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-sm font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {state.kind === 'loading' ? (
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      ) : (
        <FolderArchive className="w-4 h-4" aria-hidden="true" />
      )}
      {state.kind === 'loading'
        ? t('audit_express.generating', 'Generando...')
        : t('audit_express.prepare', 'Preparar Carpeta Fiscalización')}
    </button>
  );
}
