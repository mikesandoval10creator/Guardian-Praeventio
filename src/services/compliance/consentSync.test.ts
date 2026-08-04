// @vitest-environment jsdom
// Praeventio Guard — sincronización del consentimiento de analítica.
//
// La fuente autoritativa del consentimiento es Firestore (compliance_consents,
// vía /api/compliance/consent). El AnalyticsAdapter (síncrono) lee
// localStorage['analytics_opt_out']; este módulo traduce el estado Firestore
// a esa clave para que el opt-out de 'Mis datos' detenga la analítica real.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ANALYTICS_OPT_OUT_STORAGE_KEY,
  analyticsOptOutFromConsents,
  applyAnalyticsConsentToLocalStorage,
} from './consentSync';
import { AnalyticsAdapter } from '../analytics/adapter';
import type { CommonProperties } from '../analytics/types';

describe('consentSync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sin consentimiento registrado → analítica apagada (opt-out)', () => {
    expect(analyticsOptOutFromConsents({})).toBe('1');
    expect(analyticsOptOutFromConsents(undefined)).toBe('1');
  });

  it('consentimiento analytics otorgado → analítica activa', () => {
    expect(
      analyticsOptOutFromConsents({ analytics: { granted: true } }),
    ).toBe('0');
  });

  it('consentimiento analytics revocado → analítica apagada', () => {
    expect(
      analyticsOptOutFromConsents({ analytics: { granted: false } }),
    ).toBe('1');
  });

  it('aplica el estado Firestore a localStorage (fuente autoritativa)', () => {
    applyAnalyticsConsentToLocalStorage({ analytics: { granted: false } });
    expect(localStorage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY)).toBe('1');

    applyAnalyticsConsentToLocalStorage({ analytics: { granted: true } });
    expect(localStorage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY)).toBe('0');
  });

  it('flujo completo: consentimiento revocado → AnalyticsAdapter no emite eventos', async () => {
    // 1) Firestore dice analytics revocado → consentSync traduce a localStorage.
    applyAnalyticsConsentToLocalStorage({ analytics: { granted: false } });

    // 2) El adapter SIN isOptedOut inyectado usa defaultIsOptedOut,
    //    que lee exactamente esa clave (opt-out efectivo en cliente).
    const calls: unknown[] = [];
    const adapter = new AnalyticsAdapter({
      sinks: [
        {
          name: 'test-sink',
          track: async (event) => {
            calls.push(event);
          },
          flush: async () => {},
        },
      ],
      queue: {
        enqueue: async () => 'q1',
        listPending: async () => [],
        clear: async () => 0,
        version: 1,
      },
      getCommonProps: (): CommonProperties => ({
        event_version: '1.0.0',
        app_version: '2026.08.04+test',
        app_env: 'dev',
        app_mode: 'normal-light',
        locale: 'es-CL',
        device_class: 'web-desktop',
        online: true,
        timestamp_iso: '2026-08-04T00:00:00.000Z',
        sample_rate: 1,
      }),
    });

    await adapter.track('auth.user.signed_up', { provider: 'google' } as never);
    expect(calls).toHaveLength(0);
  });
});
