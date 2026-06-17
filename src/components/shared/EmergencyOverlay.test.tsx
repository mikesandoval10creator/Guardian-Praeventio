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
let projectMock: { selectedProject: { id: string; name: string } | null } = {
  selectedProject: { id: 'p1', name: 'Mina X' },
};
let firebaseMock: { user: { uid: string; displayName: string | null } | null } = {
  user: { uid: 'u1', displayName: 'Juan' },
};
// Reassigned per test so assertions see a fresh spy (mirrors emergencyMock).
let setDocSpy = vi.fn((..._args: unknown[]) => Promise.resolve());
let addDocSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ id: 'fake' }));

vi.mock('../../contexts/EmergencyContext', () => ({
  useEmergency: () => emergencyMock,
}));

vi.mock('../../contexts/AppModeContext', () => ({
  useAppMode: () => appModeMock,
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => projectMock,
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => firebaseMock,
}));

vi.mock('../../services/firebase', () => ({
  db: {},
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/firestore', () => ({
  // Capture the path so tests can pin WHERE seismic telemetry is written.
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  addDoc: (...args: unknown[]) => addDocSpy(...args),
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ path, id })),
  setDoc: (...args: unknown[]) => setDocSpy(...args),
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
  projectMock = { selectedProject: { id: 'p1', name: 'Mina X' } };
  firebaseMock = { user: { uid: 'u1', displayName: 'Juan' } };
  setDocSpy = vi.fn((..._args: unknown[]) => Promise.resolve());
  addDocSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ id: 'fake' }));
  // Stub geolocation so the check-in's best-effort GPS resolves (a no-op stub
  // would hang the persist Promise).
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: -33.45, longitude: -70.66 } } as GeolocationPosition),
    },
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

  it('exposes the legacy overlay as a named alertdialog (a11y)', () => {
    emergencyMock.isEmergencyActive = true;
    render(<EmergencyOverlay />);
    const dlg = screen.getByRole('alertdialog');
    expect(dlg).toBeTruthy();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toMatch(/Alerta de emergencia/i);
  });

  it('moves focus to "ESTOY A SALVO" when the overlay appears (a11y)', () => {
    emergencyMock.isEmergencyActive = true;
    render(<EmergencyOverlay />);
    const safeBtn = screen.getByText(/ESTOY A SALVO/i).closest('button');
    expect(document.activeElement).toBe(safeBtn);
  });

  it('triage confirmation shows the severity LABEL (not the raw color) with role=status', () => {
    emergencyMock.isEmergencyActive = true;
    render(<EmergencyOverlay />);
    fireEvent.click(screen.getByText('Crítico')); // rojo
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('assertive');
    expect(status.textContent).toMatch(/Reporte Crítico enviado/);
    // The raw color must NOT leak to the user/screen reader.
    expect(screen.queryByText(/Reporte rojo enviado/i)).toBeNull();
  });

  it('triage confirmation maps verde → "Leve"', () => {
    emergencyMock.isEmergencyActive = true;
    render(<EmergencyOverlay />);
    fireEvent.click(screen.getByText('Leve')); // verde
    expect(screen.getByText(/Reporte Leve enviado/i)).toBeTruthy();
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

  // Regression: rules-of-hooks. The auto-monitor early-returns used to sit
  // BEFORE the useState/useEffect hooks, so toggling `emergencyAutoEvent` on a
  // mounted overlay changed the hook count and crashed React with "rendered
  // fewer hooks than expected". Hooks are now hoisted above the returns; this
  // exercises the on→off→on transition on a single instance.
  it('does not crash when emergencyAutoEvent toggles on a mounted overlay', () => {
    emergencyMock.isEmergencyActive = true;
    appModeMock.emergencyAutoEvent = null;
    const { rerender } = render(<EmergencyOverlay />);
    expect(screen.getByText(/ALERTA DE EMERGENCIA/i)).toBeTruthy();

    // Seismic auto-event takes over — must swap cleanly, not throw.
    appModeMock.emergencyAutoEvent = { reason: 'sismo', peakG: 0.22 };
    expect(() => rerender(<EmergencyOverlay />)).not.toThrow();
    expect(screen.getByText(/SISMO DETECTADO/i)).toBeTruthy();

    // …and back to the legacy overlay — the reverse transition is crash-free too.
    appModeMock.emergencyAutoEvent = null;
    expect(() => rerender(<EmergencyOverlay />)).not.toThrow();
    expect(screen.getByText(/ALERTA DE EMERGENCIA/i)).toBeTruthy();
  });

  // Life-safety persistence (B1): the "estoy a salvo" + triage taps used to be
  // stubs ("here we would normally update Firebase"), so the supervisor's
  // evacuation headcount was blind. They now write the canonical
  // projects/{pid}/emergency_checkins/{uid} doc the dashboard reads.
  it('persists "safe" to emergency_checkins (+ GPS) when the worker taps ESTOY A SALVO', async () => {
    emergencyMock.isEmergencyActive = true;
    emergencyMock.emergencyType = 'sismo';
    render(<EmergencyOverlay />);
    await act(async () => {
      fireEvent.click(screen.getByText(/ESTOY A SALVO/i));
    });
    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDocSpy.mock.calls[0] as unknown as [
      { path: string; id: string },
      Record<string, unknown>,
      { merge: boolean },
    ];
    expect(ref.path).toBe('projects/p1/emergency_checkins');
    expect(ref.id).toBe('u1');
    expect(payload).toMatchObject({ projectId: 'p1', workerId: 'u1', status: 'safe' });
    expect(payload.location).toEqual({ lat: -33.45, lng: -70.66 });
    expect(opts).toEqual({ merge: true });
  });

  it('persists a triage level (Crítico → status danger + triageLevel rojo)', async () => {
    emergencyMock.isEmergencyActive = true;
    render(<EmergencyOverlay />);
    await act(async () => {
      fireEvent.click(screen.getByText(/Crítico/i));
    });
    expect(setDocSpy).toHaveBeenCalledTimes(1);
    const payload = setDocSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload).toMatchObject({ workerId: 'u1', status: 'danger', triageLevel: 'rojo' });
  });

  // A4 follow-up (2026-06): seismic telemetry used to write
  // tenants/{window.__GP_TENANT_ID__ || 'default'}/seismic_events — the same
  // never-assigned global that killed systemEngine sync (PR #847), gated by
  // tenant claims no flow mints → every write was PERMISSION_DENIED in prod.
  // Re-scoped to projects/{pid}/seismic_events with the project from context.
  it('persists seismic telemetry to projects/{pid}/seismic_events (project from context)', async () => {
    appModeMock.emergencyAutoEvent = { reason: 'sismo', peakG: 0.31 };
    await act(async () => {
      render(<EmergencyOverlay />);
    });
    expect(addDocSpy).toHaveBeenCalledTimes(1);
    const [collRef, payload] = addDocSpy.mock.calls[0] as unknown as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(collRef.path).toBe('projects/p1/seismic_events');
    expect(payload).toMatchObject({ peakG: 0.31, projectId: 'p1' });
    expect(payload).not.toHaveProperty('tenantId');
    expect(typeof payload.detectedAt).toBe('string');
  });

  it('skips the seismic write cleanly when NO project is selected — overlay still renders', async () => {
    projectMock = { selectedProject: null };
    appModeMock.emergencyAutoEvent = { reason: 'sismo', peakG: 0.2 };
    await act(async () => {
      render(<EmergencyOverlay />);
    });
    // Life-safety UI is never blocked by the missing write target.
    expect(screen.getByText(/SISMO DETECTADO/i)).toBeTruthy();
    expect(addDocSpy).not.toHaveBeenCalled();
  });

  it('does not persist when project or user is absent (guarded)', async () => {
    emergencyMock.isEmergencyActive = true;
    projectMock = { selectedProject: null };
    firebaseMock = { user: null };
    render(<EmergencyOverlay />);
    await act(async () => {
      fireEvent.click(screen.getByText(/ESTOY A SALVO/i));
    });
    expect(setDocSpy).not.toHaveBeenCalled();
  });
});
