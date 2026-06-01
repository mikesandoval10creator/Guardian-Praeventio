// SPDX-License-Identifier: MIT
//
// Bucket K.2 — MaintenanceStatusPanel
//
// Side panel rendered inside the Digital Twin when a PlacedObject is
// selected. Surfaces three sections:
//
//   1. Header — kind + lifecycle badge.
//   2. Histórico — geo-anchored ZK nodes near the selected object,
//      ordered by `metadata.occurredAt` desc. Filtered to the same
//      `kind` and `control-material` tag so unrelated nearby risks
//      don't pollute the timeline.
//   3. Próximos mantenimientos — `calendar_events` whose
//      `relatedObjectId` matches the selected PlacedObject, ordered
//      by `startIso` ascending. Past + pending events show a "Vencido"
//      badge so the prevencionista can act before the cron job
//      auto-flips the lifecycle to `maintenance_due`.
//
// Reuse: pulls history from the Bucket K.1 hook + tracks calendar
// events via `useFirestoreCollection`. No new Firestore plumbing.

import React, { useMemo } from 'react';
import {
  ClipboardList,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  History as HistoryIcon,
} from 'lucide-react';
import type { PlacedObject } from '../../services/digitalTwin/photogrammetry/types';
import type { RiskNode } from '../../types';
import { useGeoAnchoredNodes } from '../../hooks/useGeoAnchoredNodes';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection';
import { where, orderBy } from 'firebase/firestore';

const LIFECYCLE_LABEL: Record<string, string> = {
  planning: 'En planificación',
  pending_install: 'Pendiente de instalación',
  installed: 'Instalado',
  active: 'Activo',
  maintenance_due: 'Mantenimiento vencido',
  retired: 'Dado de baja',
};

const LIFECYCLE_BADGE: Record<string, string> = {
  planning: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
  pending_install: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  installed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  maintenance_due: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  retired: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

const HUMAN_KIND: Record<string, string> = {
  extinguisher_pqs: 'Extintor PQS',
  extinguisher_co2: 'Extintor CO₂',
  extinguisher_water: 'Extintor de agua',
  hydrant: 'Hidrante',
  sign_evacuation: 'Señal de evacuación',
  sign_warning: 'Señal de advertencia',
  sign_mandatory: 'Señal obligatoria',
  sign_prohibition: 'Señal de prohibición',
  aed: 'Desfibrilador (AED)',
  first_aid_kit: 'Botiquín',
  emergency_shower: 'Ducha de emergencia',
  eye_wash_station: 'Lavaojos',
  gas_detector: 'Detector de gas',
  spill_kit: 'Kit anti-derrames',
  safety_shower: 'Ducha de seguridad',
  assembly_point: 'Punto de encuentro',
  evacuation_route: 'Vía de evacuación',
};

interface CalendarEventRow {
  id: string;
  title?: string;
  description?: string;
  startIso?: string;
  status?: string;
  activityKind?: string;
  citations?: string[];
  relatedObjectId?: string;
  projectId?: string;
}

export interface MaintenanceStatusPanelProps {
  /** Selected PlacedObject. Render nothing if null. */
  placedObject: PlacedObject | null;
  /** Project the object belongs to. */
  projectId: string;
  /** Callback to close the panel (X button). Optional. */
  onClose?: () => void;
}

export function MaintenanceStatusPanel({
  placedObject,
  projectId,
  onClose,
}: MaintenanceStatusPanelProps) {
  // Rules of hooks: every hook below MUST run on every render. `placedObject`
  // may be null (no selection), so we derive null-safe inputs and early-return
  // AFTER the hooks (see below) instead of before them.
  const center = placedObject?.geo ?? { lat: 0, lng: 0 };
  const hasGeo = !!placedObject?.geo;

  // Histórico — sólo si tenemos geo. Sin geo (objeto en planning sobre
  // un mesh sin geoAnchor), el bounding box no tiene sentido y mostramos
  // un empty-state honesto.
  const history = useGeoAnchoredNodes(
    hasGeo && placedObject
      ? {
          projectId,
          center,
          radiusM: 5, // tolerance para objetos casi co-localizados
          objectKind: placedObject.kind,
          controlOnly: true,
        }
      : { projectId: '', center, radiusM: 0 }, // hook devuelve vacío
  );

  // Calendar — query directa por relatedObjectId.
  const { data: rawEvents, loading: loadingEvents } = useFirestoreCollection<CalendarEventRow>(
    'calendar_events',
    [where('relatedObjectId', '==', placedObject?.id ?? '__no_object__'), orderBy('startIso', 'asc')],
  );

  const events = useMemo(
    () => (rawEvents ?? []).filter((e) => e && e.id),
    [rawEvents],
  );

  // Histórico ordenado por occurredAt desc.
  const historyOrdered = useMemo(() => {
    return [...history.nodes].sort((a, b) => {
      const aT = (a.metadata as any)?.occurredAt ?? 0;
      const bT = (b.metadata as any)?.occurredAt ?? 0;
      return Number(bT) - Number(aT);
    });
  }, [history.nodes]);

  // Early-return AFTER all hooks (rules-of-hooks): nothing to show without a
  // selected object — the hooks above already ran with null-safe empty inputs.
  if (!placedObject) return null;

  const lifecycleClass =
    LIFECYCLE_BADGE[placedObject.lifecycle] ??
    'bg-zinc-500/15 text-zinc-300 border-zinc-500/40';

  const now = Date.now();

  return (
    <aside
      className="w-80 max-w-full bg-zinc-900/95 border border-zinc-700/60 rounded-xl shadow-xl text-zinc-100 flex flex-col"
      data-testid="maintenance-status-panel"
    >
      {/* Header */}
      <header className="px-4 py-3 border-b border-zinc-800 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-400">
            Objeto seleccionado
          </p>
          <h3 className="text-base font-semibold text-zinc-100">
            {HUMAN_KIND[placedObject.kind] ?? placedObject.kind}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5 break-all">
            {placedObject.id}
          </p>
          <span
            className={`inline-block mt-2 px-2 py-0.5 rounded-md text-xs border ${lifecycleClass}`}
          >
            {LIFECYCLE_LABEL[placedObject.lifecycle] ?? placedObject.lifecycle}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            ×
          </button>
        )}
      </header>

      {/* Histórico */}
      <section className="px-4 py-3 border-b border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2">
          <HistoryIcon className="w-4 h-4 text-cyan-400" />
          Histórico
          <span className="text-xs text-zinc-500">
            ({historyOrdered.length})
          </span>
        </h4>
        {!hasGeo && (
          <p className="text-xs text-zinc-500">
            Este objeto no tiene geo-anchor — el histórico geo-localizado no está disponible.
          </p>
        )}
        {hasGeo && history.loading && (
          <div className="text-xs text-zinc-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Cargando…
          </div>
        )}
        {hasGeo && !history.loading && historyOrdered.length === 0 && (
          <p className="text-xs text-zinc-500">Sin registros previos.</p>
        )}
        {hasGeo && history.error && (
          <p className="text-xs text-rose-400">
            Error al consultar nodos: {history.error.message}
          </p>
        )}
        <ul className="space-y-2 mt-1">
          {historyOrdered.slice(0, 8).map((node: RiskNode) => {
            const occurredAt = Number((node.metadata as any)?.occurredAt) || 0;
            const dateLabel = occurredAt
              ? new Date(occurredAt).toLocaleString('es-CL', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })
              : '—';
            return (
              <li
                key={node.id}
                className="text-xs bg-zinc-800/40 border border-zinc-700/40 rounded-md px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-200 truncate">
                    {node.title}
                  </span>
                  <span className="text-zinc-500 shrink-0">{dateLabel}</span>
                </div>
                {node.description && (
                  <p className="text-zinc-400 mt-0.5 line-clamp-2">
                    {node.description}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Próximos mantenimientos */}
      <section className="px-4 py-3">
        <h4 className="text-sm font-medium text-zinc-200 flex items-center gap-2 mb-2">
          <CalendarClock className="w-4 h-4 text-emerald-400" />
          Próximos mantenimientos
          <span className="text-xs text-zinc-500">({events.length})</span>
        </h4>
        {loadingEvents && (
          <div className="text-xs text-zinc-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Cargando…
          </div>
        )}
        {!loadingEvents && events.length === 0 && (
          <p className="text-xs text-zinc-500">
            No hay eventos agendados para este objeto.
          </p>
        )}
        <ul className="space-y-2 mt-1">
          {events.slice(0, 12).map((evt) => {
            const ts = evt.startIso ? Date.parse(evt.startIso) : NaN;
            const isOverdue =
              !!ts && ts <= now && (evt.status ?? 'pending') === 'pending';
            const isResolved = evt.status === 'completed';
            return (
              <li
                key={evt.id}
                className="text-xs bg-zinc-800/40 border border-zinc-700/40 rounded-md px-2 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-200 truncate">
                    {evt.title ?? evt.activityKind ?? 'Mantenimiento'}
                  </span>
                  {isOverdue && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300">
                      <AlertTriangle className="w-3 h-3" /> Vencido
                    </span>
                  )}
                  {isResolved && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" /> Listo
                    </span>
                  )}
                </div>
                <p className="text-zinc-500 mt-0.5">
                  {evt.startIso
                    ? new Date(evt.startIso).toLocaleString('es-CL', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : 'Sin fecha'}
                </p>
                {evt.citations && evt.citations.length > 0 && (
                  <p className="text-zinc-500 mt-0.5 italic line-clamp-1">
                    <ClipboardList className="inline w-3 h-3 mr-1" />
                    {evt.citations.join(' · ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}

export default MaintenanceStatusPanel;
