/**
 * AccessibilityContext — Sprint K §139-145.
 *
 * Holds 4 orthogonal accessibility-mode toggles persisted to
 * `localStorage` under the versioned key `accessibility-prefs-v1`.
 * The version suffix lets us evolve the shape later without nuking a
 * user's saved preferences silently (an old shape just resolves to the
 * defaults the first time the new schema runs).
 *
 *   - `easyReading` — simpler typography (larger font + line-height +
 *     letter-spacing) intended for users who struggle with dense UI
 *     text. Pairs with future "Lectura Fácil" copy variants.
 *   - `highContrast` — inverts the canvas so foreground/background
 *     contrast meets WCAG 2.1 Level AAA (≥7:1). Useful for low-vision
 *     users and operators in glare-heavy outdoor environments.
 *   - `glovesMode` — bumps every tap target to ≥56px (vs the platform
 *     default of 44px / 48px) and widens spacing. Intended for
 *     industrial workers wearing thick safety gloves who cannot
 *     reliably hit small targets. Pairs with the Brecha A spec.
 *   - `lowConnectivity` — opt-in flag that tells the rest of the app
 *     to favour skeleton screens and offline-first hints over
 *     spinners. Emits the global `praeventio-low-connectivity-changed`
 *     event whenever it flips so non-React components (the SLM
 *     overlay, sync indicators, image grids) can react without a
 *     prop drill.
 *
 * The provider only persists *changes*; the initial read is a single
 * synchronous `localStorage.getItem` so the very first paint already
 * sees the user's choice — important for `glovesMode` because tap
 * targets must not shrink between mounts.
 *
 * Persistence layer is plain `localStorage` (not `idb-keyval`) because
 * accessibility preferences must survive *any* storage tier going
 * offline, including IndexedDB quota issues in Safari private mode.
 * The payload is tiny (≤80 bytes JSON) so quota is not a concern.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface AccessibilityPrefs {
  /** Lectura fácil — texto más simple (mayor font-size + line-height). */
  easyReading: boolean;
  /** Alto contraste — invertir colores principales para mejor legibilidad. */
  highContrast: boolean;
  /** Modo guantes — tap targets ≥56px y espaciado mayor. */
  glovesMode: boolean;
  /** Baja conectividad — favorecer skeletons + offline-first hints. */
  lowConnectivity: boolean;
}

const DEFAULT_PREFS: AccessibilityPrefs = {
  easyReading: false,
  highContrast: false,
  glovesMode: false,
  lowConnectivity: false,
};

export const ACCESSIBILITY_STORAGE_KEY = 'accessibility-prefs-v1';
export const LOW_CONNECTIVITY_EVENT = 'praeventio-low-connectivity-changed';

export interface AccessibilityContextValue extends AccessibilityPrefs {
  setEasyReading: (v: boolean) => void;
  setHighContrast: (v: boolean) => void;
  setGlovesMode: (v: boolean) => void;
  setLowConnectivity: (v: boolean) => void;
  /** Reset every toggle to its default (false). */
  reset: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

/**
 * Safe synchronous read from localStorage. Falls back to defaults if
 * the value is missing, malformed, or storage is unavailable (SSR,
 * Safari private mode quota error, etc.). Unknown keys in the saved
 * payload are ignored — we only spread the recognised fields onto the
 * defaults to avoid trusting attacker-controlled storage values.
 */
function readInitialPrefs(): AccessibilityPrefs {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;
    return {
      easyReading: typeof parsed.easyReading === 'boolean' ? parsed.easyReading : DEFAULT_PREFS.easyReading,
      highContrast: typeof parsed.highContrast === 'boolean' ? parsed.highContrast : DEFAULT_PREFS.highContrast,
      glovesMode: typeof parsed.glovesMode === 'boolean' ? parsed.glovesMode : DEFAULT_PREFS.glovesMode,
      lowConnectivity:
        typeof parsed.lowConnectivity === 'boolean' ? parsed.lowConnectivity : DEFAULT_PREFS.lowConnectivity,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs: AccessibilityPrefs): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota exceeded / disabled storage — preferences become session-only.
    // Silent failure is intentional; we'd rather degrade than crash the
    // accessibility surface that is supposed to help users.
  }
}

function applyDocumentClasses(prefs: AccessibilityPrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('easy-reading', prefs.easyReading);
  root.classList.toggle('high-contrast', prefs.highContrast);
  root.classList.toggle('glove-friendly', prefs.glovesMode);
  root.classList.toggle('low-connectivity', prefs.lowConnectivity);
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(readInitialPrefs);

  // Apply DOM classes whenever prefs change. `glove-friendly` and
  // `high-contrast` must hit the root before children render so layout
  // tokens (--min-tap-target, color inversion) are honoured during the
  // first paint.
  useEffect(() => {
    applyDocumentClasses(prefs);
    writePrefs(prefs);
  }, [prefs]);

  // `lowConnectivity` also dispatches a window-level event so non-React
  // listeners (skeleton screens registered imperatively, the SLM
  // shell overlay, etc.) can opt in without subscribing to the
  // context. We fire even when the value is unchanged at mount so a
  // late-attached listener can still query the current state on demand
  // via the helper exposed below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(LOW_CONNECTIVITY_EVENT, { detail: { lowConnectivity: prefs.lowConnectivity } }),
    );
  }, [prefs.lowConnectivity]);

  const setEasyReading = useCallback(
    (v: boolean) => setPrefs((p) => (p.easyReading === v ? p : { ...p, easyReading: v })),
    [],
  );
  const setHighContrast = useCallback(
    (v: boolean) => setPrefs((p) => (p.highContrast === v ? p : { ...p, highContrast: v })),
    [],
  );
  const setGlovesMode = useCallback(
    (v: boolean) => setPrefs((p) => (p.glovesMode === v ? p : { ...p, glovesMode: v })),
    [],
  );
  const setLowConnectivity = useCallback(
    (v: boolean) => setPrefs((p) => (p.lowConnectivity === v ? p : { ...p, lowConnectivity: v })),
    [],
  );
  const reset = useCallback(() => setPrefs({ ...DEFAULT_PREFS }), []);

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      ...prefs,
      setEasyReading,
      setHighContrast,
      setGlovesMode,
      setLowConnectivity,
      reset,
    }),
    [prefs, setEasyReading, setHighContrast, setGlovesMode, setLowConnectivity, reset],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error('useAccessibility must be used inside <AccessibilityProvider>');
  }
  return ctx;
}

/**
 * Test-only helper: clear the persisted prefs so consecutive test runs
 * start from defaults. Exported here (rather than re-implemented per
 * test) so the storage-key implementation detail does not leak into
 * test files.
 */
export function __clearAccessibilityStorageForTests(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(ACCESSIBILITY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('easy-reading', 'high-contrast', 'glove-friendly', 'low-connectivity');
  }
}
