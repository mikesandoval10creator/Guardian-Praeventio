import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import {
  startEmergencyMonitor,
  type EmergencyTriggerEvent,
} from '../services/emergency/autoTrigger';

/**
 * Guardian Praeventio — 4-mode UX infrastructure.
 *
 * Modes (see BRAND.md):
 *   - normal    : daily use; respects `appearance` (light/dark/auto).
 *   - driving   : automotive cognitive profile; auto-flips day/night via CSS.
 *   - emergency : SOS overlay; max contrast; auto-expires after 1 h when
 *                 triggered by the auto-monitor (manual switch never
 *                 expires automatically).
 *
 * Persistence: only `mode` + `appearance` are stored under
 * `gp.appmode.v1`. Emergency state is intentionally event-driven — never
 * persisted — so a hard reload can never resurrect a stale emergency.
 */

export type AppMode = 'normal' | 'driving' | 'emergency';
export type AppAppearance = 'light' | 'dark' | 'auto';

interface PersistedState {
  mode: AppMode;
  appearance: AppAppearance;
}

interface AppModeContextValue {
  mode: AppMode;
  appearance: AppAppearance;
  setMode: (m: AppMode) => void;
  setAppearance: (a: AppAppearance) => void;
  emergencyAutoExpiresAt: Date | null;
  /**
   * Sprint 14 — set whenever the auto-monitor fires emergency mode. `null`
   * when emergency was switched manually via `setMode('emergency')`. The
   * EmergencyOverlay reads this to pick sismo vs climate vs company copy.
   */
  emergencyAutoEvent: EmergencyTriggerEvent | null;
  dismissEmergency: () => void;
}

const STORAGE_KEY = 'gp.appmode.v1';
const EMERGENCY_AUTO_TTL_MS = 60 * 60 * 1000; // 1h

const AppModeContext = createContext<AppModeContextValue | null>(null);

const DEFAULT_STATE: PersistedState = {
  mode: 'normal',
  appearance: 'auto',
};

function loadPersisted(): PersistedState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const mode: AppMode =
      parsed.mode === 'driving' || parsed.mode === 'emergency' || parsed.mode === 'normal'
        ? parsed.mode
        : 'normal';
    const appearance: AppAppearance =
      parsed.appearance === 'light' ||
      parsed.appearance === 'dark' ||
      parsed.appearance === 'auto'
        ? parsed.appearance
        : 'auto';
    // Defensive: never resurrect emergency from storage.
    return { mode: mode === 'emergency' ? 'normal' : mode, appearance };
  } catch {
    return DEFAULT_STATE;
  }
}

function persist(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    // Never persist emergency.
    const safe: PersistedState = {
      mode: state.mode === 'emergency' ? 'normal' : state.mode,
      appearance: state.appearance,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // Storage may be unavailable (private mode, quota). Non-fatal.
  }
}

function resolveAppearanceIsDark(appearance: AppAppearance): boolean {
  if (appearance === 'dark') return true;
  if (appearance === 'light') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Removes any mode-related class from <html> so they cannot stack. */
function clearModeClasses(root: HTMLElement): void {
  root.classList.remove('dark', 'driving', 'emergency', 'driving-force-day');
}

export function AppModeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const initial = loadPersisted();
  const [mode, setModeState] = useState<AppMode>(initial.mode);
  const [appearance, setAppearanceState] = useState<AppAppearance>(initial.appearance);
  const [emergencyAutoExpiresAt, setEmergencyAutoExpiresAt] = useState<Date | null>(null);
  const [emergencyAutoEvent, setEmergencyAutoEvent] = useState<EmergencyTriggerEvent | null>(null);

  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply <html> classes whenever mode/appearance changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    clearModeClasses(root);

    if (mode === 'driving') {
      root.classList.add('driving');
    } else if (mode === 'emergency') {
      root.classList.add('emergency');
    } else {
      // mode === 'normal' — apply dark when appearance resolves to dark
      if (resolveAppearanceIsDark(appearance)) {
        root.classList.add('dark');
      }
    }
  }, [mode, appearance]);

  // React to system appearance changes when appearance === 'auto'.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (mode !== 'normal' || appearance !== 'auto') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => {
      const root = document.documentElement;
      if (mq.matches) root.classList.add('dark');
      else root.classList.remove('dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode, appearance]);

  // Auto-expire emergency 1h after the auto-trigger fired.
  useEffect(() => {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (mode === 'emergency' && emergencyAutoExpiresAt) {
      const ms = emergencyAutoExpiresAt.getTime() - Date.now();
      if (ms <= 0) {
        setModeState('normal');
        setEmergencyAutoExpiresAt(null);
      } else {
        expiryTimerRef.current = setTimeout(() => {
          setModeState('normal');
          setEmergencyAutoExpiresAt(null);
        }, ms);
      }
    }
    return () => {
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [mode, emergencyAutoExpiresAt]);

  // Mirror state into a ref so the auto-monitor callback (which captures
  // the FIRST render's closures) can still read the current `mode`.
  const modeRef = useRef<AppMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Mount the auto-emergency monitor once.
  useEffect(() => {
    const cleanup = startEmergencyMonitor((evt) => {
      const previous = modeRef.current;
      setModeState('emergency');
      setEmergencyAutoExpiresAt(new Date(Date.now() + EMERGENCY_AUTO_TTL_MS));
      setEmergencyAutoEvent(evt ?? null);
      void trackModeSwitch(previous, 'emergency', 'auto_emergency');

      // Sprint 32 audit W1 — broadcast the trigger so EmergencyAutoBridge can
      // call triggerEmergency() (which fans out to supervisors via FCM). We
      // dispatch via window CustomEvent rather than coupling AppModeContext
      // to EmergencyContext, since AppModeContext can mount above the
      // EmergencyProvider in some test trees.
      if (typeof window !== 'undefined' && evt) {
        try {
          window.dispatchEvent(
            new CustomEvent('gp:emergency-auto-trigger', { detail: evt }),
          );
        } catch {
          /* CustomEvent unsupported (older Safari Extension contexts) — ignore */
        }
      }
    });
    return cleanup;
  }, []);

  const setMode = useCallback((m: AppMode): void => {
    const previous = modeRef.current;
    setModeState(m);
    // Manual switches never carry an auto-expiry.
    if (m !== 'emergency') {
      setEmergencyAutoExpiresAt(null);
      setEmergencyAutoEvent(null);
    } else {
      // Manual emergency entry: clear any stale auto-event so the overlay
      // falls back to its generic copy.
      setEmergencyAutoEvent(null);
    }
    persist({ mode: m, appearance });
    void trackModeSwitch(previous, m, 'manual');
  }, [appearance]);

  const setAppearance = useCallback((a: AppAppearance): void => {
    setAppearanceState(a);
    persist({ mode, appearance: a });
  }, [mode]);

  const dismissEmergency = useCallback((): void => {
    setModeState('normal');
    setEmergencyAutoExpiresAt(null);
    setEmergencyAutoEvent(null);
    persist({ mode: 'normal', appearance });
  }, [appearance]);

  const value: AppModeContextValue = {
    mode,
    appearance,
    setMode,
    setAppearance,
    emergencyAutoExpiresAt,
    emergencyAutoEvent,
    dismissEmergency,
  };

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be used inside <AppModeProvider>');
  return ctx;
}

// Fire-and-forget analytics for mode transitions. Dynamic import keeps the
// SSR / unit-test path free of the analytics dependency and matches the
// orchestrator's pattern. Self-transitions (a→a) are skipped because they
// represent re-renders, not real user-visible mode changes.
async function trackModeSwitch(
  from: AppMode,
  to: AppMode,
  trigger: 'manual' | 'auto_emergency' | 'auto_driving' | 'auto_appearance',
): Promise<void> {
  if (from === to) return;
  try {
    const { analytics } = await import('../services/analytics');
    analytics.track('app.mode.switched', {
      from_mode: from,
      to_mode: to,
      trigger_kind: trigger,
    });
  } catch { /* analytics never blocks UX */ }
}
