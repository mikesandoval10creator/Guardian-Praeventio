// Praeventio Guard — Sprint 12.
//
// `Driving.tsx` is the route-level full-screen experience activated when
// `useAppMode().mode === 'driving'`. The page is intentionally large-touch,
// high-contrast, and Spanish-only; all small chrome (sidebar, header)
// belongs to RootLayout and is stripped by `mode === 'driving'` styling
// outside this file (see AppModeContext).
//
// Composition rules:
//   • The map fills the viewport. The Driving experience is the map.
//   • The speedometer is the only persistent number on screen — text-7xl,
//     color-coded green ≤80, amber ≤120, red >120 km/h.
//   • The "Base" button is the dedicated emergency dial — bottom-left,
//     red, fat — opens `tel:${selectedProject.phone}` if defined; the
//     button is disabled (40% opacity, not-allowed) when `phone` is
//     empty so we never render a dead `tel:` link.
//   • The bottom dock has three actions ("Reportar near-miss",
//     "Reportar incidente", "Llegué a destino"). Buttons are wired to
//     stub handlers that surface a toast — the persistence layer is
//     SafeDriving.tsx (existing) and is intentionally NOT duplicated.
//
// We REUSE — not duplicate — existing primitives:
//   • `useSpeedMonitor()` from speedTrigger.ts (committed in 6fc9f74).
//   • `<SafeDrivingMode />` is mounted as a fallback section under the map
//     so the dictation + SOS workflows already shipped on /safe-driving
//     remain reachable. The Driving page is the modern shell; SafeDrivingMode
//     stays the operational sub-screen for SOS / dictation.
//   • Semantic tokens (`var(--accent-warning)`, etc.) per BRAND.md so the
//     light/dark/driving stylesheet variants are honored automatically.
//
// Route-level gate: redirects to `/` if `useAppMode().mode !== 'driving'`.
// The driving mode is opt-in via the ModeSwitcher; deep-linking to
// /driving without flipping the mode is a no-op (avoids confusing a
// pedestrian-mode user landing on a driving UI).
//
// Sprint 37 — Brecha B (SLM offline) audit decision:
// `Driving.tsx` no consume Gemini ni ningún wrapper de LLM (es un
// shell de Google Maps + speedometer + SOS dial via `tel:`). No hay
// path AI que cablear con `useSlmOffline`. La voz/dictado de SafeDriving
// vive en `SafeDrivingMode.tsx` y usa Web Speech API (síntesis local,
// sin red). Si en el futuro este page incorpora un panel "asesor de
// manejo" basado en Gemini, ahí va el wire — hoy queda fuera de scope
// para no inventar features. Ver `docs/slm-offline.md`.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { Phone, AlertTriangle, ShieldAlert, CheckCircle2, Loader2, Flame, ChevronRight } from 'lucide-react';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import { useAppMode } from '../contexts/AppModeContext';
import { useProject } from '../contexts/ProjectContext';
import { useSpeedMonitor } from '../services/driving/speedTrigger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import {
  eonetAdapter,
  bboxFromCenter,
  type EonetEvent,
} from '../services/external/index.js';

const containerStyle = {
  width: '100%',
  height: '100%',
};

const DEFAULT_CENTER = { lat: -33.4489, lng: -70.6693 };

/** Color tokens for the speedometer band. Pure function; no React deps. */
function speedColor(kmh: number): string {
  if (kmh <= 80) return 'var(--accent-success, #10b981)';
  if (kmh <= 120) return 'var(--accent-warning, #f59e0b)';
  return 'var(--accent-danger, #ef4444)';
}

export function Driving(): React.ReactElement {
  const { t } = useTranslation();
  const { mode } = useAppMode();
  const { selectedProject } = useProject();
  const speed = useSpeedMonitor(mode === 'driving');
  const { toasts, show, dismiss } = useToast(2500);

  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  const onMapLoad = useCallback((m: google.maps.Map) => setMapInstance(m), []);
  const onMapUnmount = useCallback(() => setMapInstance(null), []);

  const center = useMemo(() => {
    if (selectedProject?.coordinates) return selectedProject.coordinates;
    return DEFAULT_CENTER;
  }, [selectedProject]);

  // Sprint 39 J4c — Wildfire route warning (driver decide; no bloquea).
  // Cita normativa: DS 594 + Chile Driving Safety guidelines.
  // Offline-safe: sessionStorage cache para Sprint 33 D3 / Sprint 35 F3
  // mesh fallback — si fetch falla y hay cache reciente, lo usamos.
  const [wildfires, setWildfires] = useState<EonetEvent[]>([]);
  const [wildfireBannerDismissed, setWildfireBannerDismissed] = useState(false);
  const [showWildfireCitation, setShowWildfireCitation] = useState(false);

  useEffect(() => {
    if (mode !== 'driving') return undefined;
    const bbox = bboxFromCenter(center, 1.2);
    const cacheKey = `driving:eonet:wildfires:${center.lat.toFixed(2)}:${center.lng.toFixed(2)}`;
    let cancelled = false;

    const readCache = (): EonetEvent[] | null => {
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { ts: number; events: EonetEvent[] };
        if (Date.now() - parsed.ts < 60 * 60 * 1000) return parsed.events;
      } catch {
        /* ignore */
      }
      return null;
    };

    eonetAdapter
      .fetchEvents({
        bbox,
        days: 7,
        status: 'open',
        categories: ['wildfires'],
      })
      .then((events) => {
        if (cancelled) return;
        setWildfires(events);
        try {
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({ ts: Date.now(), events }),
          );
        } catch {
          /* storage may be unavailable — non-fatal */
        }
      })
      .catch(() => {
        if (cancelled) return;
        const cached = readCache();
        if (cached) setWildfires(cached);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, center]);

  // Route-level gate. When the user toggles mode back to 'normal' from
  // the ModeSwitcher this redirect kicks them out of the driving screen.
  if (mode !== 'driving') {
    return <Navigate to="/" replace />;
  }

  const speedKmh = Math.round(speed.speedKmh);
  const color = speedColor(speedKmh);
  const phone = selectedProject?.phone?.trim();
  const baseEnabled = Boolean(phone && phone.length > 0);

  const handleNearMiss = (): void => {
    show(t('driving.toast.near_miss'), 'warning');
  };
  const handleIncidente = (): void => {
    show(t('driving.toast.incident'), 'error');
  };
  const handleArrived = (): void => {
    show(t('driving.toast.arrived'), 'success');
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg-canvas, #0a0a0a)' }}
      data-testid="driving-shell"
    >
      {/* Map fills the viewport */}
      <div className="absolute inset-0">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={containerStyle}
            center={center}
            zoom={14}
            onLoad={onMapLoad}
            onUnmount={onMapUnmount}
            options={{
              disableDefaultUI: true,
              zoomControl: false,
              gestureHandling: 'greedy',
            }}
          >
            <Marker position={center} />
          </GoogleMap>
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--fg-muted, #a1a1aa)' }}>
            <Loader2 className="w-10 h-10 animate-spin" />
          </div>
        )}
      </div>

      {/* Speedometer (top-center) */}
      <div className="relative z-10 flex justify-center pt-8 pointer-events-none">
        {/* WCAG 1.4.10 (Reflow) A11Y-019 — `max-w-[280px]` keeps the
            badge inside a 320px viewport (Galaxy Fold cover screen) and
            the responsive `text-5xl sm:text-6xl md:text-7xl` ramp shrinks
            the digits below 640px so they don't push the border off-screen. */}
        <div
          className="px-8 py-4 rounded-3xl backdrop-blur-md max-w-[280px] mx-auto"
          style={{
            background: 'color-mix(in oklab, var(--bg-canvas, #0a0a0a) 70%, transparent)',
            border: `2px solid ${color}`,
          }}
          aria-live="polite"
          aria-label={t('driving.speedometer.aria', { kmh: speedKmh })}
        >
          <div
            className="text-5xl sm:text-6xl md:text-7xl font-black tabular-nums leading-none"
            style={{ color }}
            data-testid="speedometer"
          >
            {speedKmh}
          </div>
          <div
            className="text-[10px] font-black uppercase tracking-widest text-center mt-1"
            style={{ color: 'var(--fg-muted, #a1a1aa)' }}
          >
            {t('driving.speedometer.unit')}{speed.isStale ? t('driving.speedometer.no_signal') : ''}
          </div>
        </div>
      </div>

      {/* Sprint 39 J4c — Wildfire route warning (sutil, no bloquea). */}
      {wildfires.length > 0 && !wildfireBannerDismissed && (
        <div className="relative z-10 mx-4 mt-4 pointer-events-auto">
          <div
            className="rounded-2xl px-4 py-3 backdrop-blur-md border flex items-start gap-3"
            style={{
              background: 'color-mix(in oklab, var(--accent-warning, #f59e0b) 18%, transparent)',
              borderColor: 'var(--accent-warning, #f59e0b)',
            }}
            role="status"
            aria-live="polite"
            data-testid="wildfire-route-warning"
          >
            <Flame
              className="w-5 h-5 mt-0.5 shrink-0"
              style={{ color: 'var(--accent-warning, #f59e0b)' }}
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: 'var(--fg-default, #fafafa)' }}>
                {t('external_events.driving_wildfire_banner', {
                  defaultValue: 'Considerar ruta alternativa por evento natural en zona',
                })}
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--fg-muted, #a1a1aa)' }}>
                {t('external_events.driving_wildfire_normative', {
                  defaultValue: 'Referencia normativa: DS 594 + lineamientos de conducción segura.',
                })}
              </p>
              <button
                type="button"
                onClick={() => setShowWildfireCitation((v) => !v)}
                className="mt-2 min-h-[44px] inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest"
                style={{ color: 'var(--fg-muted, #a1a1aa)' }}
                aria-expanded={showWildfireCitation}
              >
                {t('external_events.citation_toggle', { defaultValue: 'Ver fuente' })}
                <ChevronRight
                  className={`w-3 h-3 transition-transform ${showWildfireCitation ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {showWildfireCitation && (
                <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--fg-muted, #a1a1aa)' }}>
                  External feed reference: EONET event {wildfires[0]?.id}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setWildfireBannerDismissed(true)}
              aria-label={t('external_events.driving_wildfire_dismiss', {
                defaultValue: 'Ocultar aviso',
              })}
              className="w-11 h-11 flex items-center justify-center rounded-full"
              style={{ color: 'var(--fg-muted, #a1a1aa)' }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Base button (bottom-left) */}
      <div className="absolute bottom-28 left-6 z-10">
        {baseEnabled ? (
          <a
            href={`tel:${phone}`}
            className="flex items-center gap-3 px-6 py-5 rounded-2xl shadow-2xl active:scale-95 transition-transform"
            style={{
              background: 'var(--accent-danger, #dc2626)',
              color: 'var(--accent-on-danger, #fff)',
            }}
            aria-label={t('driving.base.call_aria')}
            data-testid="base-button"
          >
            <Phone className="w-7 h-7" aria-hidden="true" />
            <span className="text-lg font-black uppercase tracking-widest">{t('driving.base.label')}</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            title={t('driving.base.disabled_title')}
            className="flex items-center gap-3 px-6 py-5 rounded-2xl opacity-40 cursor-not-allowed"
            style={{
              background: 'var(--accent-danger, #dc2626)',
              color: 'var(--accent-on-danger, #fff)',
            }}
            aria-label={t('driving.base.disabled_aria')}
            data-testid="base-button-disabled"
          >
            <Phone className="w-7 h-7" aria-hidden="true" />
            <span className="text-lg font-black uppercase tracking-widest">{t('driving.base.label')}</span>
          </button>
        )}
      </div>

      {/* Bottom dock — three actions */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10 px-4 py-4 grid grid-cols-3 gap-3"
        style={{
          background: 'color-mix(in oklab, var(--bg-canvas, #0a0a0a) 80%, transparent)',
          borderTop: '1px solid var(--border-subtle, #27272a)',
        }}
      >
        <button
          type="button"
          onClick={handleNearMiss}
          className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl active:scale-95 transition-transform"
          style={{
            background: 'var(--bg-elevated, #18181b)',
            color: 'var(--accent-warning, #f59e0b)',
            border: '1px solid var(--border-subtle, #27272a)',
          }}
        >
          <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          <span className="text-[10px] font-black uppercase tracking-widest">{t('driving.dock.near_miss')}</span>
        </button>
        <button
          type="button"
          onClick={handleIncidente}
          className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl active:scale-95 transition-transform"
          style={{
            background: 'var(--bg-elevated, #18181b)',
            color: 'var(--accent-danger, #ef4444)',
            border: '1px solid var(--border-subtle, #27272a)',
          }}
        >
          <ShieldAlert className="w-6 h-6" aria-hidden="true" />
          <span className="text-[10px] font-black uppercase tracking-widest">{t('driving.dock.incident')}</span>
        </button>
        <button
          type="button"
          onClick={handleArrived}
          className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl active:scale-95 transition-transform"
          style={{
            background: 'var(--bg-elevated, #18181b)',
            color: 'var(--accent-success, #10b981)',
            border: '1px solid var(--border-subtle, #27272a)',
          }}
        >
          <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
          <span className="text-[10px] font-black uppercase tracking-widest">{t('driving.dock.arrived')}</span>
        </button>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default Driving;
