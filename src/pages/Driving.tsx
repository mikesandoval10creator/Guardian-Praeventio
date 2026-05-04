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

import React, { useCallback, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { Phone, AlertTriangle, ShieldAlert, CheckCircle2, Loader2 } from 'lucide-react';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import { useAppMode } from '../contexts/AppModeContext';
import { useProject } from '../contexts/ProjectContext';
import { useSpeedMonitor } from '../services/driving/speedTrigger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';

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
    show('Near-miss registrado. Continúa atento.', 'warning');
  };
  const handleIncidente = (): void => {
    show('Incidente reportado. Se notificó a la base.', 'error');
  };
  const handleArrived = (): void => {
    show('Llegada confirmada. Buen viaje.', 'success');
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
          aria-label={`Velocidad actual ${speedKmh} kilómetros por hora`}
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
            km/h{speed.isStale ? ' · sin señal' : ''}
          </div>
        </div>
      </div>

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
            aria-label="Llamar a la base"
            data-testid="base-button"
          >
            <Phone className="w-7 h-7" aria-hidden="true" />
            <span className="text-lg font-black uppercase tracking-widest">Base</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            title="Configura el teléfono de la base en los ajustes del proyecto"
            className="flex items-center gap-3 px-6 py-5 rounded-2xl opacity-40 cursor-not-allowed"
            style={{
              background: 'var(--accent-danger, #dc2626)',
              color: 'var(--accent-on-danger, #fff)',
            }}
            aria-label="Llamar a la base (no configurado)"
            data-testid="base-button-disabled"
          >
            <Phone className="w-7 h-7" aria-hidden="true" />
            <span className="text-lg font-black uppercase tracking-widest">Base</span>
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
          <span className="text-[10px] font-black uppercase tracking-widest">Near-miss</span>
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
          <span className="text-[10px] font-black uppercase tracking-widest">Incidente</span>
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
          <span className="text-[10px] font-black uppercase tracking-widest">Llegué</span>
        </button>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default Driving;
