// Sprint 39 J4 — Shared "Eventos en zona" UI panel.
//
// Renders a calm, neutral list of EONET events around the project bbox.
// All copy goes through `buildCalmRecommendation()` so the user-facing
// body NEVER mentions NASA / USGS / EONET (regla 4 del usuario). The
// expandable footer exposes the citation refId for trazabilidad
// auditoría/legal — it's discreta, no shouting.
//
// WCAG 2.5.5: every clickable row + close button is ≥ 44×44 px.
// Dark-mode tokens follow the project semantic palette.

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, Loader2, X, Info } from 'lucide-react';
import {
  eonetAdapter,
  bboxFromCenter,
  eonetCategoryGlyph,
  buildCalmRecommendation,
  type EonetEvent,
  type EonetCategory,
  type CalmRecommendation,
} from '../../services/external/index.js';

export interface ExternalEventsPanelProps {
  center: { lat: number; lng: number } | null | undefined;
  /** look-back en días (default 14) */
  days?: number;
  /** filtros de categoría — undefined = todas */
  categories?: EonetCategory[];
  /** controla si se muestra el header */
  showHeader?: boolean;
  /** Callback opcional cuando se carga la lista (para que el padre
   *  pueda añadir markers en un mapa, por ejemplo). */
  onEventsLoaded?: (events: EonetEvent[]) => void;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; events: EonetEvent[] }
  | { status: 'error' };

export function ExternalEventsPanel({
  center,
  days = 14,
  categories,
  showHeader = true,
  onEventsLoaded,
}: ExternalEventsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [selected, setSelected] = useState<EonetEvent | null>(null);
  const [showCitation, setShowCitation] = useState(false);

  const bbox = useMemo(
    () => (center ? bboxFromCenter(center, 1) : undefined),
    [center],
  );

  useEffect(() => {
    if (!bbox) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    eonetAdapter
      .fetchEvents({ bbox, days, status: 'open', categories })
      .then((events) => {
        if (cancelled) return;
        setState({ status: 'ready', events });
        onEventsLoaded?.(events);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox?.lonMin, bbox?.lonMax, bbox?.latMin, bbox?.latMax, days]);

  const recommendation: CalmRecommendation | null = useMemo(
    () => (selected ? buildCalmRecommendation(selected) : null),
    [selected],
  );

  return (
    <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-3xl p-6 space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">
            {t('external_events.title', { defaultValue: 'Eventos en zona' })}
          </h3>
          <Info className="w-4 h-4 text-zinc-400" aria-hidden="true" />
        </div>
      )}

      {state.status === 'loading' && (
        <div className="py-6 flex items-center gap-3 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-widest">
            {t('external_events.loading', { defaultValue: 'Cargando datos…' })}
          </span>
        </div>
      )}

      {state.status === 'error' && (
        <p className="text-xs text-zinc-500">
          {t('external_events.unavailable', {
            defaultValue: 'No hay datos de eventos disponibles.',
          })}
        </p>
      )}

      {state.status === 'ready' && state.events.length === 0 && (
        <p className="text-xs text-zinc-500">
          {t('external_events.empty', {
            defaultValue: 'Sin eventos relevantes en la zona del proyecto.',
          })}
        </p>
      )}

      {state.status === 'ready' && state.events.length > 0 && (
        <ul className="space-y-2" role="list">
          {state.events.slice(0, 8).map((ev) => {
            const catId = ev.categories[0]?.id ?? 'manmade';
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(ev);
                    setShowCitation(false);
                  }}
                  className="w-full min-h-[44px] flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-white/5 hover:border-[#4db6ac]/40 dark:hover:border-[#d4af37]/40 transition-colors text-left"
                  aria-label={t('external_events.row_aria', {
                    defaultValue: 'Detalle del evento {{title}}',
                    title: ev.title,
                  })}
                >
                  <span className="text-xl" aria-hidden="true">
                    {eonetCategoryGlyph(catId)}
                  </span>
                  <span className="flex-1 text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">
                    {ev.title}
                  </span>
                  <span className="text-[9px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest bg-amber-500/10 px-2 py-1 rounded-md whitespace-nowrap">
                    {t('external_events.badge', {
                      defaultValue: 'Considerar evento natural en zona',
                    })}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && recommendation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={recommendation.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-white/10 max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className="w-5 h-5 text-amber-500"
                  aria-hidden="true"
                />
                <h4 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                  {recommendation.title}
                </h4>
              </div>
              <button
                type="button"
                aria-label={t('external_events.close', {
                  defaultValue: 'Cerrar',
                })}
                onClick={() => setSelected(null)}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-white/5"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
              {selected.title}
            </p>
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {recommendation.body}
            </p>
            <ul className="flex flex-wrap gap-2">
              {recommendation.actions.map((a) => (
                <li
                  key={a.kind}
                  className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 text-[#4db6ac] dark:text-[#d4af37] border border-[#4db6ac]/20 dark:border-[#d4af37]/20"
                >
                  {a.label}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setShowCitation((s) => !s)}
              className="min-h-[44px] w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-3 py-2 rounded-xl border border-dashed border-zinc-300 dark:border-white/10"
              aria-expanded={showCitation}
            >
              <span>
                {t('external_events.citation_toggle', {
                  defaultValue: 'Ver fuente',
                })}
              </span>
              <ChevronRight
                className={`w-4 h-4 transition-transform ${
                  showCitation ? 'rotate-90' : ''
                }`}
                aria-hidden="true"
              />
            </button>
            {showCitation && recommendation.expandableDetail && (
              <p className="text-[11px] text-zinc-500 font-mono break-all">
                {recommendation.expandableDetail}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ExternalEventsPanel;
