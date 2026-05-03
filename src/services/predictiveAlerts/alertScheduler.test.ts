// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { evaluateProbes, buildPushPayload } from './alertScheduler';

describe('alertScheduler', () => {
  it('emits scheduled alerts for probes whose forecast crosses threshold with lead time', () => {
    const alerts = evaluateProbes({
      probes: [
        {
          id: 'scaffold-uplift',
          threshold: 30,
          currentValue: 10,
          forecast: (m) => 10 + 2 * m, // crosses at m=10
        },
        {
          id: 'gas-leak-anomaly',
          threshold: 100,
          currentValue: 5,
          forecast: () => 5, // never crosses
        },
      ],
      now: () => new Date('2026-05-02T08:00:00Z'),
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].generatorId).toBe('scaffold-uplift');
    expect(alerts[0].body).toContain('predictiva');
    expect(alerts[0].scheduledAt).toBe('2026-05-02T08:00:00.000Z');
  });

  it('respects custom lead-time threshold (suppresses when too imminent)', () => {
    const alerts = evaluateProbes({
      probes: [
        {
          id: 'structural-wind',
          threshold: 30,
          currentValue: 10,
          forecast: (m) => 10 + 8 * m, // crosses around m=3
        },
      ],
      minLeadTimeMin: 5,
    });
    expect(alerts).toHaveLength(0);
  });

  it('buildPushPayload sets priority high and xpRewardOnAck=30', () => {
    const alerts = evaluateProbes({
      probes: [
        { id: 'dike-hydrostatic', threshold: 30, currentValue: 10, forecast: (m) => 10 + 2 * m },
      ],
    });
    const payload = buildPushPayload(alerts[0]);
    expect(payload.priority).toBe('high');
    expect(payload.data.xpRewardOnAck).toBe(30);
    expect(payload.title).toContain('Praeventio');
  });
});
