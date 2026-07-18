// @vitest-environment jsdom
//
// Praeventio Guard — OLA 1 SIF precursors page tests.
//
// Behavioral coverage for <SifPrecursors />: renders the (real) SIFAlert with
// pending precursors and wires the executive-review + notify-mandante buttons
// to their audited hook wrappers, refetching on success. Plus no-project,
// loading, and error states + action-failure feedback.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SifPrecursors } from './SifPrecursors';
import type { SIFAlertItem } from '../components/sif/SIFAlert';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));

let mockSelectedProject: { id: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

type Pending = { data: { precursors: SIFAlertItem[] } | null; loading: boolean; error: Error | null; refetch: () => void };
let mockPending: Pending;
const refetch = vi.fn();
const recordSifExecutiveReview = vi.fn();
const recordSifMandanteNotification = vi.fn();

vi.mock('../hooks/useSif', () => ({
  useSifPendingReview: () => mockPending,
  recordSifExecutiveReview: (...a: unknown[]) => recordSifExecutiveReview(...a),
  recordSifMandanteNotification: (...a: unknown[]) => recordSifMandanteNotification(...a),
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

function precursor(over: Partial<SIFAlertItem> = {}): SIFAlertItem {
  return {
    id: 'sif-1',
    kind: 'energia_liberada',
    potential: 'fatal',
    rationale: ['Energía liberada cerca de un trabajador'],
    executiveReviewRequired: true,
    mandanteNotificationRequired: true,
    occurredAt: '2026-06-14T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedProject = { id: 'proj-1' };
  mockPending = { data: { precursors: [] }, loading: false, error: null, refetch };
  recordSifExecutiveReview.mockResolvedValue(undefined);
  recordSifMandanteNotification.mockResolvedValue(undefined);
});

describe('<SifPrecursors />', () => {
  it('no project → no-project state', () => {
    mockSelectedProject = null;
    render(<SifPrecursors />);
    expect(screen.getByTestId('sifPage.noProject')).toBeTruthy();
  });

  it('loading → spinner', () => {
    mockPending = { data: null, loading: true, error: null, refetch };
    render(<SifPrecursors />);
    expect(screen.getByTestId('sifPage.loading')).toBeTruthy();
  });

  it('error → error state (not silent)', () => {
    mockPending = { data: null, loading: false, error: new Error('http_500'), refetch };
    render(<SifPrecursors />);
    expect(screen.getByTestId('sifPage.error')).toBeTruthy();
  });

  it('empty precursors → SIFAlert empty state', () => {
    render(<SifPrecursors />);
    expect(screen.getByTestId('sif-alert-empty')).toBeTruthy();
  });

  it('executive-review click → records review (audited hook) + refetches', async () => {
    mockPending = { data: { precursors: [precursor()] }, loading: false, error: null, refetch };
    render(<SifPrecursors />);
    fireEvent.click(screen.getByTestId('sif-review-sif-1'));
    await waitFor(() => expect(recordSifExecutiveReview).toHaveBeenCalledWith('proj-1', 'sif-1', {}));
    expect(refetch).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('sifPage.feedback').textContent).toMatch(/registrada/i));
  });

  it('notify-mandante click → records notification (audited hook) + refetches', async () => {
    mockPending = { data: { precursors: [precursor()] }, loading: false, error: null, refetch };
    render(<SifPrecursors />);
    fireEvent.click(screen.getByTestId('sif-notify-sif-1'));
    await waitFor(() => expect(recordSifMandanteNotification).toHaveBeenCalledWith('proj-1', 'sif-1'));
    expect(refetch).toHaveBeenCalled();
  });

  it('action failure → error feedback, no crash', async () => {
    mockPending = { data: { precursors: [precursor()] }, loading: false, error: null, refetch };
    recordSifExecutiveReview.mockRejectedValueOnce(new Error('forbidden'));
    render(<SifPrecursors />);
    fireEvent.click(screen.getByTestId('sif-review-sif-1'));
    await waitFor(() => expect(screen.getByTestId('sifPage.feedback').textContent).toMatch(/no tienes permiso/i));
  });
});
