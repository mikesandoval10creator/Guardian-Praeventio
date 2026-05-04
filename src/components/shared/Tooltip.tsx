// Sprint 20 sixteenth-wave (Bucket D — A11Y-015): WCAG-compliant tooltip
// primitive that closes the last `partial` row in `WCAG_findings.md`.
//
// Why a wrapper rather than `title=`: the browser's native `title`
// attribute fails WCAG 2.1 AA 1.4.13 (Content on Hover or Focus): it
// vanishes on slight cursor movement (not "persistent"), cannot be
// dismissed without losing hover (not "dismissable"), and is invisible
// to keyboard-only users (not "focus-triggered"). Radix's tooltip
// satisfies all three pillars + provides the `Esc` shortcut.
//
// Usage:
//   <Tooltip content="Centro de Sincronización">
//     <button aria-label="Centro de Sincronización">…</button>
//   </Tooltip>
//
// `aria-label` on the trigger remains the primary semantic announcement
// for screen readers; the tooltip is visual polish only.
import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /**
   * Delay before the tooltip appears on hover (ms). Keyboard focus
   * shows the tooltip immediately regardless of this value (radix
   * default behavior).
   */
  delayMs?: number;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/**
 * Project-wide tooltip primitive. Uses the brand petroleum-800
 * (`#061f2d`) bubble + white text — the petroleum hex is pinned here
 * because the Tailwind `bg-petroleum-*` utilities are not configured in
 * `index.css` (the project uses CSS vars `--accent-primary`,
 * `--bg-elevated`, etc., and raw hex bracket notation in className).
 * The pinned hex matches `BRAND.md` Petroleum-800 (the structural
 * neutral, never-as-accent color), keeping the tooltip readable in all
 * 4 modes (normal-light/dark, driving-day/night, emergency).
 */
export function Tooltip({
  content,
  children,
  delayMs = 300,
  side = 'top',
}: TooltipProps) {
  return (
    <RT.Provider delayDuration={delayMs}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content
            side={side}
            sideOffset={6}
            // Inline style pins the petroleum hex; Tailwind class is
            // kept for layout (rounded, padding, type scale, shadow,
            // max-width) so the bubble survives mode switches without
            // a token rewire.
            style={{ backgroundColor: '#061f2d', color: '#ffffff' }}
            className="rounded-md px-3 py-2 text-xs shadow-lg max-w-xs z-[60]"
          >
            {content}
            <RT.Arrow style={{ fill: '#061f2d' }} />
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  );
}
