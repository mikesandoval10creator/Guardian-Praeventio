/**
 * `useGeoCountry` — consent-gated GPS country detection hook.
 *
 * Lifecycle:
 *   1. On mount, read consent from localStorage (`praeventio_geo_consent`).
 *   2. If granted: call `detectCountry({ consent: true })` which races
 *      `navigator.geolocation.getCurrentPosition` (5 s timeout) against a
 *      `navigator.language` fallback. Result is recorded in state.
 *   3. If not granted: skip GPS entirely, use language only.
 *   4. `requestConsent()` sets the localStorage flag and re-runs detection.
 *   5. `override(code)` lets the user pick a pack manually (persisted to
 *      `praeventio_country_override`).
 *
 * Privacy: we never persist coordinates, only the resolved country code.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  detectCountry,
  type CountryDetectionResult,
} from '../services/normativa/locationNormativa';
import type { CountryCode } from '../services/normativa/countryPacks';

const CONSENT_KEY = 'praeventio_geo_consent';
const OVERRIDE_KEY = 'praeventio_country_override';

function readConsent(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

function readOverride(): CountryCode | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const valid: CountryCode[] = ['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO'];
    return (valid as string[]).includes(raw) ? (raw as CountryCode) : null;
  } catch {
    return null;
  }
}

export interface UseGeoCountryResult {
  country: CountryCode;
  source: CountryDetectionResult['source'];
  /** True while the geolocation API is in flight. */
  loading: boolean;
  /** Persist consent, then re-run detection. */
  requestConsent: () => Promise<void>;
  /** Persist a manual override (or clear with `null`). */
  override: (code: CountryCode | null) => void;
}

export function useGeoCountry(): UseGeoCountryResult {
  const [country, setCountry] = useState<CountryCode>('ISO');
  const [source, setSource] = useState<CountryDetectionResult['source']>('default');
  const [loading, setLoading] = useState<boolean>(true);

  const runDetection = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const manual = readOverride();
      const consent = readConsent();
      const result = await detectCountry({
        consent,
        manualOverride: manual ?? undefined,
      });
      setCountry(result.code);
      setSource(result.source);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runDetection();
  }, [runDetection]);

  const requestConsent = useCallback(async (): Promise<void> => {
    try {
      localStorage.setItem(CONSENT_KEY, 'granted');
    } catch {
      /* private mode / quota — silent */
    }
    await runDetection();
  }, [runDetection]);

  const override = useCallback(
    (code: CountryCode | null) => {
      try {
        if (code) {
          localStorage.setItem(OVERRIDE_KEY, code);
        } else {
          localStorage.removeItem(OVERRIDE_KEY);
        }
      } catch {
        /* private mode / quota — silent */
      }
      void runDetection();
    },
    [runDetection],
  );

  return { country, source, loading, requestConsent, override };
}
