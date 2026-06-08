// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../../hooks/useWakeLock', () => ({
  useWakeLock: () => ({ requestWakeLock: vi.fn(), releaseWakeLock: vi.fn() }),
}));

import { TriageBeacon } from './TriageBeacon';

afterEach(cleanup);

describe('TriageBeacon', () => {
  it('renders the explicit severity a man-down passes (GRAVE — no impact force exists)', () => {
    render(<TriageBeacon workerId="w1" severity="GRAVE" />);
    expect(screen.getByText('GRAVE')).toBeTruthy();
  });

  it('the explicit severity OVERRIDES the impactForce-derived one', () => {
    // impactForce 30 would compute CRÍTICO; the explicit ESTABLE must win.
    render(<TriageBeacon workerId="w1" impactForce={30} severity="ESTABLE" />);
    expect(screen.getByText('ESTABLE')).toBeTruthy();
    expect(screen.queryByText('CRÍTICO')).toBeNull();
  });

  it('shows the blood type only when provided (consent-gated upstream)', () => {
    render(<TriageBeacon workerId="w1" severity="GRAVE" bloodType="O-" allergies="Penicilina" />);
    expect(screen.getByText('O-')).toBeTruthy();
    expect(screen.getByText(/Penicilina/)).toBeTruthy();
  });

  it('falls back to "?" for blood type when the worker did not share it', () => {
    render(<TriageBeacon workerId="w1" severity="GRAVE" />);
    // "Sangre: ?" — nothing leaks when there is no consented data.
    expect(screen.getAllByText('?').length).toBeGreaterThan(0);
  });
});
