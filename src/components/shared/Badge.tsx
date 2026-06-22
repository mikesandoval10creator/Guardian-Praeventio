import type { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type Tone = 'brand' | 'attention' | 'alert' | 'success' | 'neutral';

const TONES: Record<Tone, string> = {
  brand: 'text-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
  attention: 'text-[var(--accent-warning)] bg-[color-mix(in_srgb,var(--accent-warning)_16%,transparent)]',
  alert: 'text-[var(--accent-hazard)] bg-[color-mix(in_srgb,var(--accent-hazard)_16%,transparent)]',
  success: 'text-[var(--accent-success)] bg-[color-mix(in_srgb,var(--accent-success)_16%,transparent)]',
  neutral: 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export default function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
