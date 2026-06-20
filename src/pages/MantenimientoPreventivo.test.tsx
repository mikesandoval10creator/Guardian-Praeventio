// @vitest-environment jsdom
//
// Phase 5 "make real" — verifies MantenimientoPreventivo mounts the
// previously-orphaned <HorometroEntryForm /> over its REAL backend endpoint
// (POST /api/sprint-k/:projectId/horometro/reading, horometro.ts:245).
//
// The form itself is rendered for real (not a sentinel). Only the network
// boundary (`global.fetch`) and the auth-header helper are mocked, so the test
// exercises the real submit path of `recordHorometroReading` and asserts that
// the POST hits the correct URL with the correct JSON payload + idempotency
// key. `useEquipment` is mocked to return a real Equipment object so the page
// can resolve the selection without its own fetch; `MaintenanceTaskList` (which
// owns a separate endpoint) is mocked to a sentinel — it is not under test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react';
import type { Equipment } from '../services/equipment/equipmentQrService';

let selected: { id: string; name: string } | null = {
  id: 'proj-1',
  name: 'Faena Norte',
};

const EQUIPMENT: Equipment = {
  id: 'eq-77',
  code: 'GH-04',
  type: 'gruahorquilla',
  brand: 'Toyota',
  model: '8FG25',
  status: 'operativo',
  criticality: 'high',
  riskCategories: ['caida', 'aplastamiento'],
  requiresPreUseChecklist: true,
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: selected }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

const refetch = vi.fn();
vi.mock('../hooks/useEquipment', () => ({
  useEquipment: () => ({
    data: { equipment: [EQUIPMENT] },
    loading: false,
    error: null,
    refetch,
  }),
}));

// MaintenanceTaskList owns the separate maintenance-tasks endpoint; sentinel it
// so this test stays scoped to the horometro reading submit.
vi.mock('../components/horometro/MaintenanceTaskList', () => ({
  MaintenanceTaskList: ({
    projectId,
    equipmentId,
  }: {
    projectId: string;
    equipmentId: string;
  }) => (
    <div data-testid="maintenance-task-list">
      TASKS::{projectId}::{equipmentId}
    </div>
  ),
}));

// Auth boundary: the real recordHorometroReading() builds headers from this.
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
  apiAuthHeader: async () => 'Bearer test-token',
}));

import { MantenimientoPreventivo } from './MantenimientoPreventivo';

const fetchMock = vi.fn();

beforeEach(() => {
  cleanup();
  selected = { id: 'proj-1', name: 'Faena Norte' };
  refetch.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<MantenimientoPreventivo /> — orphan HorometroEntryForm mount', () => {
  it('shows the select-a-project empty state when no project is selected', () => {
    selected = null;
    render(<MantenimientoPreventivo />);
    expect(
      screen.getByTestId('mantenimiento-preventivo-page-empty'),
    ).toBeTruthy();
  });

  it('selecting an equipment reveals the task list and the register-reading button', () => {
    render(<MantenimientoPreventivo />);
    fireEvent.change(screen.getByTestId('maintenance-equipment-select'), {
      target: { value: 'eq-77' },
    });
    expect(screen.getByTestId('maintenance-task-list').textContent).toContain(
      'proj-1::eq-77',
    );
    expect(screen.getByTestId('maintenance-open-reading')).toBeTruthy();
    // Form not open yet.
    expect(screen.queryByTestId('horometro-entry-eq-77')).toBeNull();
  });

  it('opens the real HorometroEntryForm and submits a reading with the correct POST payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        reading: { id: 'r1', hours: 1234.5 },
        flow: { ok: true, crossesDetected: 0 },
      }),
    });

    render(<MantenimientoPreventivo />);
    fireEvent.change(screen.getByTestId('maintenance-equipment-select'), {
      target: { value: 'eq-77' },
    });
    fireEvent.click(screen.getByTestId('maintenance-open-reading'));

    // The REAL form is now rendered (its own data-testid).
    const form = await screen.findByTestId('horometro-entry-eq-77');
    expect(form).toBeTruthy();

    // Fill the real inputs and submit.
    fireEvent.change(screen.getByTestId('horometro-hours-input'), {
      target: { value: '1234.5' },
    });
    fireEvent.change(screen.getByTestId('horometro-notes-input'), {
      target: { value: 'Cambio de turno' },
    });
    fireEvent.click(screen.getByTestId('horometro-submit'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sprint-k/proj-1/horometro/reading');
    expect(init.method).toBe('POST');
    // Idempotency key present (anti double-record).
    expect(typeof init.headers['Idempotency-Key']).toBe('string');
    expect(init.headers['Idempotency-Key'].length).toBeGreaterThan(0);
    expect(init.headers.Authorization).toBe('Bearer test-token');

    const payload = JSON.parse(init.body);
    expect(payload).toEqual({
      equipmentId: 'eq-77',
      hours: 1234.5,
      source: 'qr_entry',
      notes: 'Cambio de turno',
    });

    // Success surface from the real form + parent refetch fired.
    await screen.findByTestId('horometro-result-eq-77');
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not submit when hours are empty (real form validation gate)', async () => {
    render(<MantenimientoPreventivo />);
    fireEvent.change(screen.getByTestId('maintenance-equipment-select'), {
      target: { value: 'eq-77' },
    });
    fireEvent.click(screen.getByTestId('maintenance-open-reading'));
    await screen.findByTestId('horometro-entry-eq-77');

    // Submit button is disabled with empty hours; clicking is a no-op.
    fireEvent.click(screen.getByTestId('horometro-submit'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
