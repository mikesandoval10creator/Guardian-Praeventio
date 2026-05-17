// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §74-78 page wrapper tests.
//
// Smoke tests for `<EmergencyBrigade />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state surfaces the hook message.
//   4. Renders full brigade snapshot (members + resources + green banner).
//   5. Renders rose banner when multiple gaps exist.
//   6. Add brigadista modal opens and submits.
//   7. Add recurso modal opens and submits.
//
// The component mocks the Sprint K hook and project/online contexts so
// the test is hermetic — no Firestore, no fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmergencyBrigade } from './EmergencyBrigade';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      // Single overloaded `t()` — fallback can be a string OR an options
      // object (defaultValue + interpolations) when called like
      // `t('key', { defaultValue, count })`.
      const interpolate = (str: string, vars: Record<string, unknown>) => {
        let out = str;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(`{{${k}}}`, String(v));
        }
        return out;
      };
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') return interpolate(fallback, opts);
        return fallback;
      }
      if (fallback && typeof fallback === 'object') {
        const def = fallback.defaultValue;
        if (typeof def === 'string') return interpolate(def, fallback);
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockHookData: any = null;
let mockHookLoading = false;
let mockHookError: Error | null = null;
const mockRefetch = vi.fn();
const mockAddMember = vi.fn();
const mockAddResource = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useEmergencyBrigade: () => ({
    data: mockHookData,
    loading: mockHookLoading,
    error: mockHookError,
    refetch: mockRefetch,
  }),
  addBrigadeMember: (...args: unknown[]) => mockAddMember(...args),
  addBrigadeResource: (...args: unknown[]) => mockAddResource(...args),
  inspectResource: vi.fn(),
}));

function fullSnapshot() {
  return {
    members: [
      {
        id: 'm-1',
        workerUid: 'worker-leader',
        role: 'brigade_chief' as const,
        trainedAt: '2026-01-15T00:00:00Z',
        trainingValidYears: 2,
        active: true,
      },
      {
        id: 'm-2',
        workerUid: 'worker-first-aid',
        role: 'first_aid' as const,
        trainedAt: '2026-02-10T00:00:00Z',
        trainingValidYears: 2,
        active: true,
      },
      {
        id: 'm-3',
        workerUid: 'worker-fire',
        role: 'fire_response' as const,
        trainedAt: '2026-03-01T00:00:00Z',
        trainingValidYears: 2,
        active: true,
      },
    ],
    resources: [
      {
        id: 'r-1',
        kind: 'extinguisher' as const,
        location: 'Pasillo norte',
        lastInspectedAt: '2026-04-01T00:00:00Z',
        nextExpirationAt: '2027-04-01T00:00:00Z',
        operational: true,
      },
      {
        id: 'r-2',
        kind: 'aed' as const,
        location: 'Recepción',
        lastInspectedAt: '2026-04-15T00:00:00Z',
        nextExpirationAt: '2027-04-15T00:00:00Z',
        operational: true,
      },
    ],
    brigade: {
      totalMembers: 3,
      byRole: {
        brigade_chief: 1,
        first_aid: 1,
        fire_response: 1,
        evacuation_coordinator: 0,
        communications: 0,
      },
      uncoveredRoles: [],
      expiredTrainings: [],
      meetsMinimum: true,
    },
    resourceReadiness: {
      totalResources: 2,
      byKind: {
        extinguisher: 1,
        first_aid_kit: 0,
        aed: 1,
        eyewash: 0,
        safety_shower: 0,
        fire_hose: 0,
        spill_kit: 0,
      },
      operational: 2,
      needingAttention: [],
      operationalPercent: 100,
    },
    readinessLevel: 'green' as const,
  };
}

function gapSnapshot() {
  const base = fullSnapshot();
  return {
    ...base,
    members: [base.members[0]],
    brigade: {
      ...base.brigade,
      totalMembers: 1,
      byRole: {
        brigade_chief: 1,
        first_aid: 0,
        fire_response: 0,
        evacuation_coordinator: 0,
        communications: 0,
      },
      uncoveredRoles: ['first_aid', 'fire_response'],
      meetsMinimum: false,
    },
    resourceReadiness: {
      ...base.resourceReadiness,
      needingAttention: [base.resources[0]],
      operationalPercent: 50,
    },
    readinessLevel: 'rose' as const,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockHookData = null;
  mockHookLoading = false;
  mockHookError = null;
  mockRefetch.mockReset();
  mockAddMember.mockReset();
  mockAddResource.mockReset();
});

describe('<EmergencyBrigade /> page wrapper (§74-78)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<EmergencyBrigade />);
    expect(
      screen.getByTestId('emergency-brigade-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookLoading = true;
    render(<EmergencyBrigade />);
    expect(
      screen.getByTestId('emergency-brigade-loading'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookError = new Error('Network down');
    render(<EmergencyBrigade />);
    expect(
      screen.getByTestId('emergency-brigade-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza la brigada completa con banner verde', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookData = fullSnapshot();
    render(<EmergencyBrigade />);
    expect(screen.getByTestId('emergency-brigade-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('emergency-brigade-banner-green'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('emergency-brigade-members-section'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('emergency-brigade-resources-section'),
    ).toBeInTheDocument();
    // Both resources rendered.
    expect(
      screen.getByTestId('emergency-brigade-resource-r-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('emergency-brigade-resource-r-2'),
    ).toBeInTheDocument();
  });

  it('renderiza banner rose cuando hay múltiples brechas', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookData = gapSnapshot();
    render(<EmergencyBrigade />);
    expect(
      screen.getByTestId('emergency-brigade-banner-rose'),
    ).toBeInTheDocument();
    // Roles sin cubrir muestran el chip "Brecha".
    expect(screen.getAllByText(/brecha/i).length).toBeGreaterThan(0);
  });

  it('abre el modal de brigadista y envía el formulario', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookData = fullSnapshot();
    mockAddMember.mockResolvedValue({ ok: true, id: 'new-m' });
    render(<EmergencyBrigade />);
    fireEvent.click(screen.getByTestId('emergency-brigade-add-member-btn'));
    expect(
      screen.getByTestId('brigade-add-member-modal'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('brigade-add-member-uid'), {
      target: { value: 'new-worker-uid' },
    });
    fireEvent.click(screen.getByTestId('brigade-add-member-submit'));
    await waitFor(() => {
      expect(mockAddMember).toHaveBeenCalled();
    });
    const args = mockAddMember.mock.calls[0];
    expect(args[0]).toBe('p-1');
    expect(args[1].workerUid).toBe('new-worker-uid');
    expect(args[1].role).toBe('brigade_chief');
  });

  it('abre el modal de recurso y envía el formulario', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockHookData = fullSnapshot();
    mockAddResource.mockResolvedValue({ ok: true, id: 'new-r' });
    render(<EmergencyBrigade />);
    fireEvent.click(screen.getByTestId('emergency-brigade-add-resource-btn'));
    expect(
      screen.getByTestId('brigade-add-resource-modal'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('brigade-add-resource-location'), {
      target: { value: 'Sala eléctrica B' },
    });
    fireEvent.click(screen.getByTestId('brigade-add-resource-submit'));
    await waitFor(() => {
      expect(mockAddResource).toHaveBeenCalled();
    });
    const args = mockAddResource.mock.calls[0];
    expect(args[0]).toBe('p-1');
    expect(args[1].location).toBe('Sala eléctrica B');
    expect(args[1].kind).toBe('extinguisher');
  });
});
