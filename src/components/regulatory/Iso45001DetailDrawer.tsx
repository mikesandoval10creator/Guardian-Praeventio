// Praeventio Guard — ISO 45001 control detail drawer (B1).
// Primary action: shows clause + scope + references. Official link is secondary.
// No fabricated guidance — only real ComplianceControl fields.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, BookCheck, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ISO_45001_BY_ID } from '../../services/regulatory/iso45001.js';

interface Iso45001DetailDrawerProps {
  controlId: string | null;
  onClose: () => void;
}

export function Iso45001DetailDrawer({ controlId, onClose }: Iso45001DetailDrawerProps) {
  const { t } = useTranslation();
  // Focus management: save the element that opened the drawer so we can
  // restore focus when it closes.
  const returnFocusRef = useRef<Element | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!controlId) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controlId, onClose]);

  // On open: capture current focus, then move focus into the drawer panel.
  // On close: restore focus to the element that triggered the open.
  // TODO: full tab-trap deferred (repo-wide gap, matches Modal.tsx)
  useEffect(() => {
    if (controlId) {
      returnFocusRef.current = document.activeElement;
      asideRef.current?.focus();
    } else {
      (returnFocusRef.current as HTMLElement | null)?.focus();
      returnFocusRef.current = null;
    }
  }, [controlId]);

  if (!controlId) return null;
  const control = ISO_45001_BY_ID[controlId];
  if (!control) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('iso45001.detail_aria', 'Detalle de control ISO 45001') as string}
      className="fixed inset-0 z-[80] flex justify-end"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={asideRef}
        tabIndex={-1}
        className="relative h-full w-full max-w-md bg-surface border-l border-default-token shadow-mode overflow-y-auto outline-none"
      >
        <header className="sticky top-0 flex items-center justify-between gap-2 bg-elevated border-b border-default-token px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookCheck className="w-4 h-4 text-[var(--accent-info,#38bdf8)] shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide text-secondary-token">ISO 45001:2018 · §{control.iso45001Clause}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close', 'Cerrar') as string}
            className="p-1.5 rounded-md text-secondary-token hover:text-primary-token hover:bg-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <h2 className="text-base font-semibold text-primary-token leading-snug">{control.title}</h2>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-token">{t('iso45001.references', 'Referencias normativas')}</h3>
            <ul className="space-y-2">
              {control.references.map((ref) => (
                <li key={ref.code} className="rounded-xl border border-default-token bg-elevated p-3">
                  <p className="text-xs font-semibold text-primary-token">{ref.title}</p>
                  <p className="text-xs text-secondary-token mt-1 leading-snug">{ref.scope}</p>
                  {ref.url && (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      {t('iso45001.openStandard', 'Ver estándar oficial')}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
