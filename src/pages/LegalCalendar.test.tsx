// @vitest-environment jsdom
//
// Praeventio Guard — page test for `<LegalCalendar />`.
//
// Focus: the server-backed "Próximas obligaciones (servidor)" section wired to
// the real HTTP hook `fetchUpcomingObligations` (orphan
// `src/hooks/useLegalObligations.ts`, mounted here). We assert the page renders
// the REAL server-computed entries, plus the honest empty/error states. The
// local Firestore-store view (`subscribeObligations`) is mocked to an empty
// list so the test isolates the server section.
//
// Hermetic: contexts/hooks/store are mocked — no fetch, no Firestore, no
// router. Matches the patterns used by `DrillsManager.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LegalCalendar } from './LegalCalendar';
import type { UpcomingObligationsResponse } from '../hooks/useLegalObligations';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      // Support both t(key, defaultString) and t(key, { defaultValue, ...vars }).
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      if (fallback && typeof fallback === 'object') {
        let out = String(fallback.defaultValue ?? _k);
        for (const [key, val] of Object.entries(fallback)) {
          if (key === 'defaultValue') continue;
          out = out.replace(`{{${key}}}`, String(val));
        }
        return out;
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

// Local store: keep the legacy view empty so the test isolates the server
// section. `subscribeObligations` fires the callback with [] then returns an
// unsubscribe fn.
vi.mock('../services/legalCalendar/legalCalendarStore', () => ({
  subscribeObligations: vi.fn(
    (
      _projectId: string,
      onData: (list: unknown[]) => void,
    ) => {
      onData([]);
      return () => undefined;
    },
  ),
  saveObligation: vi.fn(async () => undefined),
  ensureCalendarBootstrap: vi.fn(async () => 0),
}));

const fetchUpcomingMock = vi.fn();
vi.mock('../hooks/useLegalObligations', () => ({
  fetchUpcomingObligations: (...args: unknown[]) => fetchUpcomingMock(...args),
}));

function upcomingResponse(
  over: Partial<UpcomingObligationsResponse> = {},
): UpcomingObligationsResponse {
  return {
    windowDays: 30,
    summary: {
      totalObligations: 1,
      overdue: 0,
      inAlertWindow: 1,
      byKind: { audit: 1 } as never,
    },
    entries: [
      {
        id: 'obl_iso45001',
        kind: 'audit',
        label: 'Auditoría ISO 45001 anual',
        legalCitation: 'ISO 45001 cláusula 9.2',
        recurrence: 'annual',
        alertLeadDays: 60,
        nextDueAt: '2026-07-15T00:00:00.000Z',
        daysUntilDue: 25,
        isInAlertWindow: true,
        isOverdue: false,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  fetchUpcomingMock.mockReset();
});

describe('<LegalCalendar /> server-backed upcoming section', () => {
  it('no llama al servidor ni muestra la sección sin proyecto seleccionado', () => {
    mockSelectedProject = null;
    fetchUpcomingMock.mockResolvedValue(upcomingResponse());
    render(<LegalCalendar />);
    expect(fetchUpcomingMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('legal-calendar-server-section'),
    ).not.toBeInTheDocument();
  });

  it('renderiza las obligaciones próximas REALES devueltas por el servidor', async () => {
    mockSelectedProject = { id: 'proj-1', name: 'Faena Norte' };
    fetchUpcomingMock.mockResolvedValue(upcomingResponse());

    render(<LegalCalendar />);

    // The hook is called with the selected project id.
    await waitFor(() => {
      expect(fetchUpcomingMock).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    const list = await screen.findByTestId('legal-calendar-server-list');
    expect(list).toBeInTheDocument();

    const entry = screen.getByTestId(
      'legal-calendar-server-entry-obl_iso45001',
    );
    expect(entry).toBeInTheDocument();
    expect(entry).toHaveTextContent('Auditoría ISO 45001 anual');
    expect(entry).toHaveTextContent('ISO 45001 cláusula 9.2');

    // The real `daysUntilDue` from the server is rendered.
    expect(
      screen.getByTestId('legal-calendar-server-entry-obl_iso45001-due'),
    ).toHaveTextContent('en 25d');

    // Window badge reflects the server-reported windowDays.
    expect(
      screen.getByTestId('legal-calendar-server-window'),
    ).toHaveTextContent('ventana 30d');

    // No empty/error states when there is real data.
    expect(
      screen.queryByTestId('legal-calendar-server-empty'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('legal-calendar-server-error'),
    ).not.toBeInTheDocument();
  });

  it('muestra empty-state honesto cuando el servidor devuelve cero obligaciones', async () => {
    mockSelectedProject = { id: 'proj-2', name: 'Faena Sur' };
    fetchUpcomingMock.mockResolvedValue(
      upcomingResponse({
        entries: [],
        summary: {
          totalObligations: 0,
          overdue: 0,
          inAlertWindow: 0,
          byKind: {} as never,
        },
      }),
    );

    render(<LegalCalendar />);

    const empty = await screen.findByTestId('legal-calendar-server-empty');
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent(/no hay obligaciones próximas/i);

    // Honest: nothing is fabricated — no list rendered.
    expect(
      screen.queryByTestId('legal-calendar-server-list'),
    ).not.toBeInTheDocument();
  });

  it('muestra el mensaje de error real cuando el servidor falla', async () => {
    mockSelectedProject = { id: 'proj-3', name: 'Faena Este' };
    fetchUpcomingMock.mockRejectedValue(new Error('forbidden'));

    render(<LegalCalendar />);

    const errBox = await screen.findByTestId('legal-calendar-server-error');
    expect(errBox).toBeInTheDocument();
    expect(errBox).toHaveTextContent(/forbidden/i);

    expect(
      screen.queryByTestId('legal-calendar-server-list'),
    ).not.toBeInTheDocument();
  });
});
