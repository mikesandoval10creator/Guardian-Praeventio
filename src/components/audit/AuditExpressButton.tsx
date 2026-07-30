// Praeventio Guard — Wire UI #7: <AuditExpressButton />
//
// Single-click entry point for a browser-downloadable audit index PDF.
// The caller owns generation/auth; this component owns request state,
// project-switch invalidation and the final download link.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderArchive, Loader2, Check, AlertTriangle } from 'lucide-react';

interface AuditExpressButtonProps {
  projectId: string;
  /** Async caller that returns a browser-downloadable audit artifact. */
  onRequest: (projectId: string) => Promise<{
    downloadUrl: string;
    fileName?: string;
    expiresAt?: string;
  }>;
  /** Optional: triggered with download URL once ready. */
  onReady?: (downloadUrl: string, expiresAt?: string) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string; fileName?: string; expiresAt?: string }
  | { kind: 'error'; message: string };

export function AuditExpressButton({ projectId, onRequest, onReady }: AuditExpressButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const requestGeneration = useRef(0);

  useEffect(() => {
    requestGeneration.current += 1;
    setState({ kind: 'idle' });
  }, [projectId]);

  async function trigger() {
    const generation = ++requestGeneration.current;
    setState({ kind: 'loading' });
    try {
      const result = await onRequest(projectId);
      if (generation !== requestGeneration.current) return;
      setState({
        kind: 'ready',
        url: result.downloadUrl,
        fileName: result.fileName,
        expiresAt: result.expiresAt,
      });
      onReady?.(result.downloadUrl, result.expiresAt);
    } catch (err) {
      if (generation !== requestGeneration.current) return;
      const message = err instanceof Error ? err.message : 'unknown';
      setState({ kind: 'error', message });
    }
  }

  if (state.kind === 'ready') {
    return (
      <a
        href={state.url}
        download={state.fileName}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="audit-express-ready"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 transition-colors"
      >
        <Check className="w-4 h-4" aria-hidden="true" />
        {t('audit_express.download', 'Descargar Índice de Fiscalización')}
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
        : t('audit_express.prepare', 'Preparar Índice de Fiscalización')}
    </button>
  );
}
