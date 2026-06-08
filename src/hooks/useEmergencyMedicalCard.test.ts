// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => {
    store.set(k, v);
  }),
}));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { shareableCard, useEmergencyMedicalCard } from './useEmergencyMedicalCard';

beforeEach(() => store.clear());

describe('shareableCard — the consent gate (single source of truth)', () => {
  it('returns null when the worker has NOT consented (even with data)', () => {
    expect(shareableCard({ shareConsent: false, bloodType: 'O+' })).toBeNull();
  });
  it('returns null when consented but the card is empty', () => {
    expect(shareableCard({ shareConsent: true })).toBeNull();
  });
  it('returns the shareable fields when consented AND there is data', () => {
    expect(
      shareableCard({ shareConsent: true, bloodType: 'O-', allergies: 'Penicilina' }),
    ).toEqual({ bloodType: 'O-', allergies: 'Penicilina' });
  });
});

describe('useEmergencyMedicalCard', () => {
  it('starts empty (no consent), then persists a saved card on-device', async () => {
    const { result } = renderHook(() => useEmergencyMedicalCard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.card.shareConsent).toBe(false);
    expect(result.current.hasShareableCard).toBe(false);

    await act(async () => {
      await result.current.saveCard({ bloodType: 'A+', shareConsent: true });
    });
    expect(result.current.card.bloodType).toBe('A+');
    expect(result.current.card.shareConsent).toBe(true);
    expect(result.current.hasShareableCard).toBe(true);
    expect(result.current.card.updatedAt).toBeTruthy();
    // Persisted to idb-keyval.
    expect(store.get('praeventio:emergency-medical-card')).toMatchObject({ bloodType: 'A+', shareConsent: true });
  });

  it('rehydrates a previously saved card from on-device storage', async () => {
    store.set('praeventio:emergency-medical-card', {
      shareConsent: true,
      bloodType: 'B-',
      allergies: 'Látex',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const { result } = renderHook(() => useEmergencyMedicalCard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.card.bloodType).toBe('B-');
    expect(result.current.hasShareableCard).toBe(true);
  });
});
