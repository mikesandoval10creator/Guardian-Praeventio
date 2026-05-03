// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { shouldFireWindowed } from './windowedTrigger';

describe('shouldFireWindowed', () => {
  const ctx = { currentValue: 10, threshold: 30, generatorId: 'scaffold-uplift' };

  it('does NOT fire if hazard already present', () => {
    const d = shouldFireWindowed({ ...ctx, currentValue: 35 }, () => 50);
    expect(d.fire).toBe(false);
  });

  it('fires when forecast crosses threshold inside window with sufficient lead time', () => {
    // Linear ramp: 10 + 2 per minute → crosses 30 at minute 10.
    const fn = (m: number) => 10 + 2 * m;
    const d = shouldFireWindowed(ctx, fn, { windowMinutes: 15, minLeadTimeMin: 5 });
    expect(d.fire).toBe(true);
    expect(d.leadTimeMin).toBe(10);
  });

  it('does NOT fire when crossing happens too soon (under minLeadTimeMin)', () => {
    const fn = (m: number) => 10 + 8 * m; // crosses ~ minute 3
    const d = shouldFireWindowed(ctx, fn, { windowMinutes: 15, minLeadTimeMin: 5 });
    expect(d.fire).toBe(false);
    expect(d.leadTimeMin).toBe(3);
  });

  it('does NOT fire when forecast never crosses inside window', () => {
    const d = shouldFireWindowed(ctx, () => 12, { windowMinutes: 15 });
    expect(d.fire).toBe(false);
    expect(d.leadTimeMin).toBe(0);
  });

  it('returns the recommendedAction provided', () => {
    const d = shouldFireWindowed(ctx, () => 50, { recommendedAction: 'Detener obra' });
    expect(d.recommendedAction).toBe('Detener obra');
  });
});
