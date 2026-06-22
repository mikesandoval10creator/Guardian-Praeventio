// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SunTracker } from './SunTracker';

// Mock ephemeris so we can control day/night
vi.mock('../../lib/ephemeris', () => {
  const NOON = new Date();
  NOON.setHours(12, 0, 0, 0);
  const SUNRISE = new Date(); SUNRISE.setHours(7, 0, 0, 0);
  const SUNSET  = new Date(); SUNSET.setHours(20, 0, 0, 0);
  const MIDNIGHT_PAST = new Date(); MIDNIGHT_PAST.setHours(0, 0, 0, 0);
  const MIDNIGHT_TOMORROW = new Date(); MIDNIGHT_TOMORROW.setDate(MIDNIGHT_TOMORROW.getDate() + 1); MIDNIGHT_TOMORROW.setHours(0, 0, 0, 0);

  return {
    getSunTimes: vi.fn(() => ({ sunrise: SUNRISE, sunset: SUNSET })),
    getMoonPhase: vi.fn(() => ({ phase: 'full', illumination: 99, lunarDay: 14 })),
    getLunarDay: vi.fn(() => 14),
  };
});

describe('SunTracker', () => {
  it('renders the sun-tracker container', () => {
    render(<SunTracker lat={-33.45} lng={-70.67} />);
    expect(screen.getByTestId('sun-tracker')).toBeInTheDocument();
  });

  it('shows Amanecer or Ocaso event label', () => {
    render(<SunTracker lat={-33.45} lng={-70.67} />);
    const label = screen.getByText(/Amanecer|Ocaso/);
    expect(label).toBeInTheDocument();
  });

  it('shows sunrise and sunset times', () => {
    render(<SunTracker lat={-33.45} lng={-70.67} />);
    // At least one time string should appear (HH:MM format)
    const times = screen.getAllByText(/\d{2}:\d{2}/);
    expect(times.length).toBeGreaterThanOrEqual(2);
  });
});
