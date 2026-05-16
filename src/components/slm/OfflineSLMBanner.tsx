// Sprint 20 — Bucket Lambda — T-1.5
//
// `<OfflineSLMBanner>` is the persistent visual cue that the device is
// running on the local Small Language Model because the network is
// unreachable. It announces:
//
//   • the offline state,
//   • the count of consultations queued for later reconciliation against
//     the canonical server LLM,
//   • a link that fires `gp-slm-show-queue` so a parent can display the
//     reconciliation queue without coupling the banner to a router.
//
// Mode-aware rendering. The visual treatment shifts across the four UX
// modes declared in `BRAND.md` + `src/index.css`:
//
//   • normal-light / normal-dark — soft amber warning surface,
//   • driving                    — same amber surface but full-width and
//                                  with bumped typography for glanceability,
//   • emergency                  — high-contrast operational alarm using
//                                  the project's coral hazard token; signals
//                                  "you are on your own, act with care".
//
// Why custom events for "Ver cola": this component is intentionally
// decoupled from `react-router-dom`. The same banner must work inside
// the driving overlay, the emergency overlay, and the normal layout —
// none of which share the same router context. Custom events let any
// ancestor listen with a one-liner.
//
// Accessibility: rendered as `role="status"` + `aria-live="polite"`. The
// motion enter/exit is mediated by `framer-motion` so screen readers see
// the final state via aria-live, and motion-reduced users still get the
// announcement (only the visual transform is suppressed by user agent
// settings further upstream).

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, ListChecks } from 'lucide-react';

/**
 * Discrete UX mode the banner can render in. Mirrors the 4 design modes
 * from `BRAND.md` rather than the runtime `AppMode` from
 * `AppModeContext` — runtime "normal" splits into light/dark for the
 * banner to pick the right surface.
 */
export type OfflineBannerMode =
  | 'normal-light'
  | 'normal-dark'
  | 'driving'
  | 'emergency';

export interface OfflineSLMBannerProps {
  /**
   * Number of offline sessions currently waiting in the local queue for
   * later reconciliation. Negative values are clamped to zero in the
   * rendered copy.
   */
  pendingCount: number;
  /**
   * Visual mode override. When omitted, the banner reads from a sibling
   * AppMode context if available; otherwise it falls back to
   * `normal-light`. Pass explicitly inside isolated render trees (tests,
   * storybook).
   */
  mode?: OfflineBannerMode;
  /**
   * Render the banner whatever `navigator.onLine` says. Tests use this
   * to skip the online check; production code should leave it false.
   */
  forceVisible?: boolean;
  /**
   * Test seam — overrides the default custom-event dispatch for the
   * "Ver cola" link. Production callers should let this default.
   */
  onShowQueue?: () => void;
}

/** Custom event name parents listen for to surface the offline queue. */
export const SLM_SHOW_QUEUE_EVENT = 'gp-slm-show-queue';

/**
 * Per-mode visual contract. Centralized here so the JSX body stays
 * focused on layout and the variant-specific colors live in one
 * inspectable record. No hex literals — all classes resolve to the
 * project's semantic / scaled tokens declared in `index.css`.
 */
interface ModeStyle {
  /** Wrapper surface (background + border + text color baseline). */
  wrapper: string;
  /** Icon color override. */
  icon: string;
  /** "Ver cola" link tone. */
  link: string;
  /** Layout span — driving mode goes full-width across the viewport. */
  layout: string;
  /** Type ramp — driving mode bumps the body up for glanceability. */
  type: string;
}

const MODE_STYLES: Record<OfflineBannerMode, ModeStyle> = {
  'normal-light': {
    wrapper: 'bg-amber-100 border border-amber-500 text-amber-900',
    icon: 'text-amber-700',
    link: 'text-amber-900 hover:bg-amber-200/70',
    layout: 'rounded-2xl px-4 py-3 mx-auto max-w-3xl',
    type: 'text-sm',
  },
  'normal-dark': {
    wrapper: 'bg-amber-900 border border-amber-500 text-amber-100',
    icon: 'text-amber-300',
    link: 'text-amber-100 hover:bg-amber-800/60',
    layout: 'rounded-2xl px-4 py-3 mx-auto max-w-3xl',
    type: 'text-sm',
  },
  driving: {
    wrapper:
      'bg-amber-100 dark:bg-amber-900 border-y border-amber-500 text-amber-900 dark:text-amber-100',
    icon: 'text-amber-700 dark:text-amber-300',
    link: 'text-amber-900 dark:text-amber-100 hover:bg-amber-200/70 dark:hover:bg-amber-800/60',
    layout: 'w-full px-6 py-4',
    type: 'text-base sm:text-lg font-semibold tracking-wide',
  },
  emergency: {
    wrapper: 'bg-coral-700 border border-coral-500 text-white',
    icon: 'text-white',
    link: 'text-white hover:bg-coral-600',
    layout: 'rounded-xl px-4 py-3 mx-auto max-w-3xl',
    type: 'text-sm font-semibold',
  },
};

/**
 * Inline style fallback for the coral surface — Tailwind v4 in this
 * codebase does not declare a coral palette in `@theme`, so we map the
 * `bg-coral-*` and `border-coral-*` classes used above to the project's
 * `--color-brand-coral` brand token at the ancestor level. This keeps
 * the JSX semantic (no hex hardcoded) while still rendering correctly
 * in environments that have not regenerated atomic classes for those
 * specific shades.
 *
 * Returns the inline style object for the given mode, or `undefined`
 * for non-coral modes.
 */
function inlineStyleFor(mode: OfflineBannerMode): React.CSSProperties | undefined {
  if (mode !== 'emergency') return undefined;
  return {
    backgroundColor: 'var(--color-brand-coral)',
    borderColor: 'var(--color-brand-coral)',
  };
}

/**
 * Detect whether the device is offline. SSR-safe — treated as "online"
 * when `navigator` is unavailable.
 */
function useIsOffline(): boolean {
  const [offline, setOffline] = React.useState<boolean>(() => {
    if (typeof navigator === 'undefined') return false;
    return navigator.onLine === false;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const update = (): void =>
      setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return offline;
}

export function OfflineSLMBanner({
  pendingCount,
  mode = 'normal-light',
  forceVisible = false,
  onShowQueue,
}: OfflineSLMBannerProps): React.ReactElement | null {
  const isOffline = useIsOffline();
  const visible = forceVisible || isOffline;
  const safePending = Math.max(0, Math.floor(pendingCount));
  const style = MODE_STYLES[mode];

  const handleShowQueue = (): void => {
    if (onShowQueue) {
      onShowQueue();
      return;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(SLM_SHOW_QUEUE_EVENT, {
          detail: { pendingCount: safePending },
        }),
      );
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="offline-slm-banner"
          role="status"
          aria-live="polite"
          data-testid="offline-slm-banner"
          data-mode={mode}
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={inlineStyleFor(mode)}
          className={`${style.wrapper} ${style.layout}`}
        >
          <div className="flex items-center gap-3">
            <WifiOff
              className={`shrink-0 w-5 h-5 ${style.icon}`}
              aria-hidden="true"
            />
            <p className={`flex-1 ${style.type}`}>
              Sin red &middot; Modo offline activo &middot; {safePending} consultas en cola
            </p>
            <button
              type="button"
              onClick={handleShowQueue}
              data-testid="offline-slm-banner-show-queue"
              className={`
                shrink-0 inline-flex items-center gap-1.5
                rounded-lg px-3 py-1 text-xs sm:text-sm font-semibold
                transition-colors
                focus:outline-none focus:ring-2 focus:ring-current focus:ring-offset-1
                ${style.link}
              `}
            >
              <ListChecks className="w-4 h-4" aria-hidden="true" />
              Ver cola
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default OfflineSLMBanner;
