// @vitest-environment node
//
// TZ pin: the ephemeris calculations use `date.getTimezoneOffset()` to derive
// the UTC offset. On UTC CI (offset = 0) the "local hours" assertions for
// Santiago (UTC-3 / UTC-4) would land 3-4 hours earlier than expected, failing
// the sunrise/sunset window checks.  Pinning to America/Santiago makes the
// Date objects behave identically in CI and in local dev regardless of the
// host OS timezone.
process.env.TZ = 'America/Santiago';

import { describe, it, expect } from 'vitest';
import { getSunTimes, getMoonPhase, getLunarDay } from './ephemeris';

// ---------------------------------------------------------------------------
// getSunTimes
// ---------------------------------------------------------------------------

describe('getSunTimes', () => {
  it('Santiago winter solstice: sunrise 07:00-08:30, sunset 17:30-18:30', () => {
    // 2024-06-21 — Southern hemisphere winter solstice
    // Test uses a fixed UTC date; getHours() on the returned Date reflects local
    // time relative to the TZ offset embedded in the JS runtime.
    // We pass the date in local Chilean time (UTC-4 in winter DST off).
    const date = new Date('2024-06-21T12:00:00');
    const { sunrise, sunset } = getSunTimes(date, -33.45, -70.67);

    const srH = sunrise.getHours() + sunrise.getMinutes() / 60;
    const ssH = sunset.getHours() + sunset.getMinutes() / 60;

    expect(srH).toBeGreaterThanOrEqual(7.0);
    expect(srH).toBeLessThanOrEqual(8.5);
    expect(ssH).toBeGreaterThanOrEqual(17.5);
    expect(ssH).toBeLessThanOrEqual(18.5);
  });

  it('Santiago summer solstice: sunrise before 07:30, sunset after 19:30', () => {
    // 2024-12-21 — Southern hemisphere summer solstice
    const date = new Date('2024-12-21T12:00:00');
    const { sunrise, sunset } = getSunTimes(date, -33.45, -70.67);

    const srH = sunrise.getHours() + sunrise.getMinutes() / 60;
    const ssH = sunset.getHours() + sunset.getMinutes() / 60;

    expect(srH).toBeLessThan(7.5);
    expect(ssH).toBeGreaterThan(19.5);
  });

  it('Equator on equinox: ~12 hours of daylight (±30 min), sunset after sunrise', () => {
    // 2024-03-20 — vernal equinox. lng=0, so use UTC date to get consistent
    // getTimezoneOffset() behaviour regardless of test-runner TZ: the formula
    // uses lng and utcOffsetHours together, so absolute clock hours vary by TZ.
    // What IS invariant: daylight duration ≈ 12 h at the equator on an equinox.
    const date = new Date('2024-03-20T12:00:00');
    const { sunrise, sunset } = getSunTimes(date, 0, 0);

    const daylightMs = sunset.getTime() - sunrise.getTime();
    const daylightH = daylightMs / 3600000;

    // Daylight at equator on equinox: 12 h ± 30 min
    expect(daylightH).toBeGreaterThan(11.5);
    expect(daylightH).toBeLessThan(12.5);
    expect(sunset.getTime()).toBeGreaterThan(sunrise.getTime());
  });

  it('Polar day (Arctic, lat=70, June 21): returns valid fallback Date objects', () => {
    // cosHourAngle < -1 → midnight sun → fallback branch
    const date = new Date('2024-06-21T12:00:00Z');
    const { sunrise, sunset } = getSunTimes(date, 70, 25);

    expect(sunrise).toBeInstanceOf(Date);
    expect(sunset).toBeInstanceOf(Date);
    expect(isNaN(sunrise.getTime())).toBe(false);
    expect(isNaN(sunset.getTime())).toBe(false);
    // Fallback sunset must be after fallback sunrise
    expect(sunset.getTime()).toBeGreaterThan(sunrise.getTime());
  });
});

// ---------------------------------------------------------------------------
// getMoonPhase — illumination
// ---------------------------------------------------------------------------

describe('getMoonPhase', () => {
  it('known full moon 2024-01-25: illumination 90–100', () => {
    const date = new Date('2024-01-25');
    const { illumination } = getMoonPhase(date);
    expect(illumination).toBeGreaterThanOrEqual(90);
    expect(illumination).toBeLessThanOrEqual(100);
  });

  it('known new moon 2024-01-11: illumination 0–10', () => {
    const date = new Date('2024-01-11');
    const { illumination } = getMoonPhase(date);
    expect(illumination).toBeGreaterThanOrEqual(0);
    expect(illumination).toBeLessThanOrEqual(10);
  });

  it('returns a valid phase string from all 8 categories', () => {
    const validPhases = new Set([
      'new',
      'waxing_crescent',
      'first_quarter',
      'waxing_gibbous',
      'full',
      'waning_gibbous',
      'last_quarter',
      'waning_crescent',
    ]);

    // Sample 8 evenly-spaced points across a lunar cycle (~29.5 days)
    const baseDate = new Date('2024-01-11'); // near new moon
    const seenPhases = new Set<string>();

    for (let i = 0; i < 8; i++) {
      const d = new Date(baseDate.getTime() + i * 3.7 * 86400000);
      const { phase } = getMoonPhase(d);
      expect(validPhases.has(phase)).toBe(true);
      seenPhases.add(phase);
    }

    // We should see at least 4 distinct phases in 8 samples across the cycle
    expect(seenPhases.size).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// getLunarDay
// ---------------------------------------------------------------------------

describe('getLunarDay', () => {
  it('returns an integer 0–27 for arbitrary dates', () => {
    const testDates = [
      new Date('2024-01-01'),
      new Date('2024-06-15'),
      new Date('2024-12-31'),
      new Date('2000-01-01'),
      new Date('2030-07-04'),
    ];

    for (const d of testDates) {
      const day = getLunarDay(d);
      expect(Number.isInteger(day)).toBe(true);
      expect(day).toBeGreaterThanOrEqual(0);
      expect(day).toBeLessThanOrEqual(27);
    }
  });
});
