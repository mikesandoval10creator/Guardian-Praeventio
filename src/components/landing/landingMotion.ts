/**
 * Landing entrance motion that never gates paint.
 *
 * Chrome only reports an element as a Largest Contentful Paint candidate once
 * it is actually painted, and an element animated from `opacity: 0` is not
 * painted until the animation crosses the visibility threshold. On the
 * anonymous landing page the hero headline is the LCP element, so an opacity
 * gate pushed the LCP timestamp to the END of the entrance animation.
 *
 * Measured on the production build (`vite preview`):
 *   with `opacity: 0`    -> LCP 1324 ms (FCP 192 ms)
 *   without the gate     -> LCP  532 ms (FCP 168 ms)
 *
 * Under Lighthouse's simulated slow-4G the same gap was the dominant part of
 * the 12.4 s FCP-to-LCP interval the report flagged as "Element render
 * delay".
 *
 * The entrance is therefore expressed with a TRANSFORM ONLY: the element is
 * fully opaque from the first frame and merely slides into place. The visual
 * intent is preserved; the paint is not held hostage.
 *
 * `prefers-reduced-motion` removes the motion entirely, as before.
 */
import type { MotionProps } from 'framer-motion';

interface EnterOptions {
  /** Delay in seconds before the entrance starts. */
  delay: number;
  /** Vertical travel in pixels. */
  distance?: number;
  /** Duration of the entrance in seconds. */
  duration?: number;
}

/**
 * Build the framer-motion props for a landing entrance.
 *
 * `initial` deliberately omits `opacity`: the element must be opaque on the
 * first painted frame so it can win the LCP slot immediately.
 *
 * `reduced` accepts `null` because framer-motion's `useReducedMotion()` returns
 * `null` until the media query resolves; only an explicit `true` disables the
 * motion.
 */
export function landingEnter(
  reduced: boolean | null,
  { delay, distance = 24, duration = 0.7 }: EnterOptions,
): MotionProps {
  if (reduced) return {};

  return {
    initial: { y: distance },
    animate: { y: 0 },
    transition: { duration, delay, ease: 'easeOut' },
  };
}
