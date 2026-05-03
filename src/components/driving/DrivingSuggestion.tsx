// Praeventio Guard — Sprint 12.
//
// `<DrivingSuggestion>` is mounted at app scope (next to FallDetectionMonitor
// in App.tsx) and watches `useSpeedMonitor` while the user is in normal
// mode. If sustained speed >20 km/h is observed for >30 s, a single non-
// blocking toast is surfaced offering a one-tap switch into driving mode.
//
// Why a separate component (not an effect inside AppModeContext):
//   • Keeps AppModeContext free of speed-monitor + toast wiring (other
//     agents touching AppModeContext for Sprint 13/14 should not have to
//     reason about this).
//   • Gives us a clean unmount/cleanup contract — when mode flips to
//     'driving' or 'emergency', the component returns null and the
//     useSpeedMonitor watch is torn down.
//
// Behavior:
//   • The trigger is "sustained" — not the first sample. We require two
//     consecutive ticks above 20 km/h spaced ≥30s apart before showing
//     the toast. This filters one-off GPS jitter.
//   • Once shown, the suggestion is debounced for 10 minutes — we never
//     want to spam a driver who repeatedly accelerated past 20 km/h then
//     dropped (e.g. urban stop-and-go) with the same prompt.
//   • The toast button calls `setMode('driving')` and navigates to /driving.

import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '../../contexts/AppModeContext';
import { useSpeedMonitor } from '../../services/driving/speedTrigger';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../shared/ToastContainer';

const SPEED_THRESHOLD_KMH = 20;
const SUSTAINED_MS = 30_000;
const DEBOUNCE_MS = 10 * 60_000; // 10 min

export function DrivingSuggestion(): React.ReactElement | null {
  const { mode, setMode } = useAppMode();
  const speed = useSpeedMonitor(mode === 'normal');
  const navigate = useNavigate();
  const { toasts, show, dismiss } = useToast(8000);

  // Wall-clock when speed first crossed the threshold in the current run.
  const aboveSinceRef = useRef<number | null>(null);
  // Wall-clock when the toast was last shown — used for debounce.
  const lastShownRef = useRef<number>(0);

  useEffect(() => {
    if (mode !== 'normal') {
      aboveSinceRef.current = null;
      return;
    }
    if (speed.isStale) {
      aboveSinceRef.current = null;
      return;
    }
    const above = speed.speedKmh > SPEED_THRESHOLD_KMH;
    if (!above) {
      aboveSinceRef.current = null;
      return;
    }
    if (aboveSinceRef.current === null) {
      aboveSinceRef.current = Date.now();
      return;
    }
    const elapsed = Date.now() - aboveSinceRef.current;
    if (elapsed < SUSTAINED_MS) return;

    const sinceLast = Date.now() - lastShownRef.current;
    if (sinceLast < DEBOUNCE_MS) return;

    lastShownRef.current = Date.now();
    show('¿Activar modo conducción? Toca para activarlo.', 'info');
    // Reset window so we don't immediately re-trigger if speed stays high.
    aboveSinceRef.current = Date.now();
  }, [mode, speed.speedKmh, speed.isStale, show]);

  // Render only the toast container — pure passive UI.
  if (mode !== 'normal') return null;

  // Wrap toasts so the user can tap to activate. We piggy-back on the
  // standard ToastContainer rather than ship a bespoke surface.
  const handleDismiss = (id: string): void => {
    // Treat dismiss-while-active-suggestion as opt-in: if the most recent
    // toast was the suggestion, we read intent from a button click, not
    // a swipe-away. The default ToastContainer dispatches dismiss either
    // way, so we expose a separate "Activar" button alongside.
    dismiss(id);
  };

  const handleActivate = (): void => {
    setMode('driving');
    navigate('/driving');
    toasts.forEach((t) => dismiss(t.id));
  };

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={handleDismiss} />
      {toasts.length > 0 && (
        <div
          className="fixed bottom-24 right-4 z-[9999] pointer-events-auto"
          role="region"
          aria-label="Sugerencia de modo conducción"
        >
          <button
            type="button"
            onClick={handleActivate}
            className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg"
            style={{
              background: 'var(--accent-primary, #2563eb)',
              color: 'var(--accent-on-primary, #fff)',
            }}
          >
            Activar conducción
          </button>
        </div>
      )}
    </>
  );
}

export default DrivingSuggestion;
