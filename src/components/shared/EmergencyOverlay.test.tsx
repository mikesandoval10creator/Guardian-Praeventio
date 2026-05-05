// @vitest-environment jsdom
//
// Sprint 25 — Bucket NN: tests for EmergencyOverlay.
//
// The overlay depends on EmergencyContext + AppModeContext + Firebase.
// We mock all of them so the test stays focused on render-level invariants:
// when does it appear, which variant renders, and how does it dismiss.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';

// Mutable mock state — re-assigned per test.
let emergencyMock = {
  isEmergencyActive: false as boolean,
  emergencyType: 'sismo' as string | null,
  resolveEmergency: vi.fn(),
  triggerEmergency: vi.fn(),
};
let appModeMock: {
  emergencyAutoEvent: { reason: string; peakG?: number; climateSubType?: string } | null;
  dismissEmergency: () => void;
} = {
  emergencyAutoEvent: null,
  dismissEmergency: vi.fn(),
};

vi.mock('../../contexts/EmergencyContext', () => ({
  useEmergency: () => emergencyMock,
}));

vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => appModeMock,
}));

vi.mock('../../services/firebase', () => ({
  db: {},
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: vi.fn(() => Promise.resolve({ id: 'fake' })),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { EmergencyOverlay } from './EmergencyOverlay';

beforeEach(() => {
  emergencyMock = {
    isEmergencyActive: false,
    emergencyType: 'sismo',
    resolveEmergency: vi.fn(),
    triggerEmergency: vi.fn(),
  };
  appModeMock = {
    emergencyAutoEvent: null,
    dismissEmergency: vi.fn(),
  };
  // Stub geolocation so component effects don't throw.
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn() },
  });
  // Stub speechSynthesis.
  (global as any).window.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => [],
  };
  (global as any).SpeechSynthesisUtterance = function () {
    return { onend: null, lang: '', rate: 1, pitch: 1, volume: 1 };
  } as unknown as typeof SpeechSynthesisUtterance;
  (global as any).window.SpeechSynthesisUtterance = (global as any).SpeechSynthesisUtterance;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmergencyOverlay', () => {
  it('renders nothing when no emergency state is active', () => {
    const { container } = render(<EmergencyOverlay />);
    // No active state, no auto-event → no overlay visible.
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('renders the legacy overlay when isEmergencyActive=true', () => {
    emergencyMock.isEmergencyActive = true;
    emergencyMock.emergencyType = 'sismo';
    render(<EmergencyOverlay />);
    expect(screen.getByText(/ALERTA DE EMERGENCIA/i)).toBeTruthy();
  });

  it('renders the seismic auto-overlay variant when reason=sismo', () => {
    appModeMock.emergencyAutoEvent = { reason: 'sismo', peakG: 0.18 };
    render(<EmergencyOverlay />);
    expect(screen.getByText(/SISMO DETECTADO/i)).toBeTruthy();
    expect(screen.getByText(/Agáchate/i)).toBeTruthy();
  });

  it('renders a different climate variant when reason=climate', () => {
    appModeMock.emergencyAutoEvent = { reason: 'climate', climateSubType: 'storm' };
    render(<EmergencyOverlay />);
    expect(screen.getByText(/TORMENTA DETECTADA/i)).toBeTruthy();
    // Confirm seismic copy is NOT present (different variant).
    expect(screen.queryByText(/Agáchate/i)).toBeNull();
  });

  it('auto-expires the seismic overlay after the duration', () => {
    vi.useFakeTimers();
    appModeMock.emergencyAutoEvent = { reason: 'sismo', peakG: 0.2 };
    const dismissSpy = vi.fn();
    appModeMock.dismissEmergency = dismissSpy;
    render(<EmergencyOverlay />);
    expect(dismissSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(31_000); // > 30s seismic auto-dismiss
    });
    expect(dismissSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('dismisses the climate overlay when the user clicks "Entendido"', () => {
    const dismissSpy = vi.fn();
    appModeMock.emergencyAutoEvent = { reason: 'climate', climateSubType: 'extreme_heat' };
    appModeMock.dismissEmergency = dismissSpy;
    render(<EmergencyOverlay />);
    fireEvent.click(screen.getByText(/Entendido/i));
    expect(dismissSpy).toHaveBeenCalled();
  });

  it('seismic auto-overlay is keyboard-focusable (button + aria-label)', () => {
    appModeMock.emergencyAutoEvent = { reason: 'sismo', peakG: 0.15 };
    render(<EmergencyOverlay />);
    const btn = screen.getByLabelText(/Cerrar alerta sísmica/i);
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON');
  });
});
