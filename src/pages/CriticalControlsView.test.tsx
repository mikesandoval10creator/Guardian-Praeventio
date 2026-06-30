// @vitest-environment jsdom
//
// Praeventio Guard — <CriticalControlsView /> failure-mode library panel.
//
// Verifies the reference panel renders the REAL summary returned by
// useFailureLibrarySummary (GET /controls/failures/summary) with honest
// empty/error states — the counts come from the engine, never fabricated.
//
// Hermetic: only the network-boundary hook + the contexts/store are mocked.
// The page, the HCA catalog engine and <BarrierAnalysisCard /> are real code.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CriticalControlsView } from './CriticalControlsView';
import type { FailureLibrarySummaryResponse } from '../hooks/useControlComparator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let out = typeof fallback === 'string' ? fallback : _k;
      const merged =
        opts && typeof opts === 'object'
          ? opts
          : fallback && typeof fallback === 'object'
            ? fallback
            : undefined;
      if (typeof fallback === 'object' && fallback && 'defaultValue' in fallback) {
        out = String((fallback as { defaultValue: string }).defaultValue);
      }
      if (merged) {
        for (const [key, val] of Object.entries(merged)) {
          if (key === 'defaultValue') continue;
          out = out.replace(`{{${key}}}`, String(val));
        }
      }
      return out;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u-1' } }),
}));

vi.mock('../services/criticalControls/controlValidationsStore', () => ({
  subscribeControlValidations: (_p: string, onData: (l: unknown[]) => void) => {
    onData([]);
    return () => {};
  },
  saveControlValidation: vi.fn(),
}));

type SummaryState = {
  data: FailureLibrarySummaryResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockSummary: SummaryState;
vi.mock('../hooks/useControlComparator', () => ({
  useFailureLibrarySummary: () => mockSummary,
}));

const loaded = (data: FailureLibrarySummaryResponse | null): SummaryState => ({
  data,
  loading: false,
  error: null,
  refetch: () => {},
});

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  mockSummary = loaded(null);
});

describe('<CriticalControlsView /> failure-mode library panel', () => {
  it('renders the real summary counts when the library has entries', () => {
    mockSummary = loaded({
      summary: {
        totalEntries: 7,
        byFailureMode: { degradation: 4, bypass: 3 },
        byControlKind: { engineering: 5, administrative: 2 },
        byFrequencyTier: { common: 6, rare: 1 },
      },
    });

    render(<CriticalControlsView />);

    expect(screen.getByTestId('critical-controls.failure-library')).toBeInTheDocument();
    const content = screen.getByTestId('critical-controls.failure-library.content');
    // Real total from the engine, not a fabricated constant.
    expect(content).toHaveTextContent('7 modos de falla documentados');
    // A real breakdown key + count is surfaced.
    expect(content).toHaveTextContent('degradation');
    expect(content).toHaveTextContent('4');
  });

  it('shows an honest empty state when the library has no entries (no fabrication)', () => {
    mockSummary = loaded({
      summary: {
        totalEntries: 0,
        byFailureMode: {},
        byControlKind: {},
        byFrequencyTier: {},
      },
    });

    render(<CriticalControlsView />);

    expect(
      screen.getByTestId('critical-controls.failure-library.empty'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('critical-controls.failure-library.content'),
    ).not.toBeInTheDocument();
  });

  it('shows an honest error state when the summary fetch fails', () => {
    mockSummary = { data: null, loading: false, error: new Error('http_500'), refetch: () => {} };

    render(<CriticalControlsView />);

    expect(
      screen.getByTestId('critical-controls.failure-library.error'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('critical-controls.failure-library.content'),
    ).not.toBeInTheDocument();
  });
});
