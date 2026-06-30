/**
 * ephemeris.ts
 * Pure TypeScript module — no React, no Capacitor, no side effects.
 * Solar and lunar calculations for any latitude/longitude.
 */

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

export type MoonPhase =
  | 'new'
  | 'waxing_crescent'
  | 'first_quarter'
  | 'waxing_gibbous'
  | 'full'
  | 'waning_gibbous'
  | 'last_quarter'
  | 'waning_crescent';

export interface MoonData {
  phase: MoonPhase;
  illumination: number; // 0–100
  lunarDay: number;     // 0–27
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Build a Date on the same calendar day as `base`, at fractional hours (local). */
function hoursToDate(base: Date, hours: number): Date {
  const d = new Date(base);
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  d.setHours(h, m, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// getSunTimes
// ---------------------------------------------------------------------------

/**
 * Compute local sunrise and sunset for a given date and location.
 * Works for any lat/lng worldwide.
 *
 * Returns fallback times when the sun never rises (polar night) or never sets
 * (midnight sun / polar day).
 */
export function getSunTimes(date: Date, lat: number, lng: number): SunTimes {
  const doy = dayOfYear(date);

  // 1. Solar declination (degrees)
  const declDeg = 23.45 * Math.sin(toRad((360 * (284 + doy)) / 365));
  const declRad = toRad(declDeg);
  const latRad = toRad(lat);

  // 2. Hour angle cosine
  const cosHourAngle = -Math.tan(latRad) * Math.tan(declRad);

  // Polar conditions — use sensible fallbacks
  if (cosHourAngle > 1) {
    // Polar night — sun never rises
    // isWinter from perspective of the local hemisphere:
    // Northern hemisphere winter ≈ months 11,0,1 (0-indexed); Southern ≈ 5,6,7
    const month = date.getMonth(); // 0-indexed
    const isWinter = lat >= 0
      ? month >= 10 || month <= 1
      : month >= 4 && month <= 7;
    return {
      sunrise: hoursToDate(date, isWinter ? 7.5 : 6.75),
      sunset:  hoursToDate(date, isWinter ? 18.0 : 19.5),
    };
  }

  if (cosHourAngle < -1) {
    // Midnight sun — sun never sets (polar day)
    const month = date.getMonth();
    const isWinter = lat >= 0
      ? month >= 10 || month <= 1
      : month >= 4 && month <= 7;
    return {
      sunrise: hoursToDate(date, isWinter ? 7.5 : 6.75),
      sunset:  hoursToDate(date, isWinter ? 18.0 : 19.5),
    };
  }

  // 3. Equation of Time (minutes)
  const B = (2 * Math.PI * (doy - 81)) / 365;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // 4. UTC offset of the date object (minutes west → negative hours east)
  const utcOffsetHours = -date.getTimezoneOffset() / 60;

  // 5. Longitude correction: how many hours the location differs from its
  //    timezone reference meridian (utcOffsetHours * 15°).
  const lonCorrection = (lng - utcOffsetHours * 15) / 15;

  // 6. Solar noon in local clock hours
  const solarNoon = 12 - lonCorrection - eot / 60;

  // 7. Hour angle → hours
  const hourAngleDeg = toDeg(Math.acos(cosHourAngle));
  const hourAngleHours = hourAngleDeg / 15;

  const sunriseHours = solarNoon - hourAngleHours;
  const sunsetHours  = solarNoon + hourAngleHours;

  return {
    sunrise: hoursToDate(date, sunriseHours),
    sunset:  hoursToDate(date, sunsetHours),
  };
}

// ---------------------------------------------------------------------------
// getMoonPhase
// ---------------------------------------------------------------------------

const LUNAR_CYCLE = 29.530588853; // synodic month in days
const KNOWN_NEW_MOON_OFFSET = 6.761; // days from J2000 to a known new moon

function normalizedMoonPhase(date: Date): number {
  const j2000 = new Date('2000-01-01T12:00:00Z');
  const daysSince = (date.getTime() - j2000.getTime()) / 86400000;
  let phase = ((daysSince - KNOWN_NEW_MOON_OFFSET) / LUNAR_CYCLE) % 1;
  if (phase < 0) phase += 1;
  return phase;
}

function phaseNameFromNormalized(p: number): MoonPhase {
  if (p < 0.0625) return 'new';
  if (p < 0.1875) return 'waxing_crescent';
  if (p < 0.3125) return 'first_quarter';
  if (p < 0.4375) return 'waxing_gibbous';
  if (p < 0.5625) return 'full';
  if (p < 0.6875) return 'waning_gibbous';
  if (p < 0.8125) return 'last_quarter';
  if (p < 0.9375) return 'waning_crescent';
  return 'new';
}

export function getMoonPhase(date: Date): MoonData {
  const p = normalizedMoonPhase(date);
  const illumination = Math.round((1 - Math.cos(p * 2 * Math.PI)) * 50);
  return {
    phase: phaseNameFromNormalized(p),
    illumination: Math.min(100, Math.max(0, illumination)),
    lunarDay: Math.floor(p * 28),
  };
}

// ---------------------------------------------------------------------------
// getLunarDay
// ---------------------------------------------------------------------------

export function getLunarDay(date: Date): number {
  const p = normalizedMoonPhase(date);
  return Math.floor(p * 28);
}
