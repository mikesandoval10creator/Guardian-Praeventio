// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.8 page wrapper tests.
//
// Smoke tests for `<Inbox />` page:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Items rendered through the panel sub-component.
//   4. Offline chip.
//   5. Hook error surfaces with message.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Inbox } from './Inbox';
import type { InboxResponse } from '../hooks/useSprintK';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
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
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockUseInbox: {
  data: InboxResponse | null;
  loading: boolean;
  error: Error | null;
};

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useInbox: () => mockUseInbox,
  // F.9 hook also wired in the page; tests don't assert the gap card
  // so the mock returns a null/empty result and the page hides it.
  useDataQuality: () => ({ data: null, loading: false, error: null }),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockUseInbox = {
    data: null,
    loading: false,
    error: null,
  };
});

describe('<Inbox /> page wrapper (Fase F.8)', () => {
  it('renderiza empty-state cuando no hay proyecto', () => {
    mockSelectedProject = null;
    render(<Inbox />);
    expect(screen.getByTestId('inbox-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockUseInbox = { data: null, loading: true, error: null };
    render(<Inbox />);
    expect(screen.getByTestId('inbox-loading')).toBeInTheDocument();
  });

  it('muestra summary con total y overdue interpolados', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockUseInbox = {
      data: {
        items: [],
        summary: {
          total: 7,
          byUrgency: { urgent: 1, high: 2, medium: 3, low: 1 },
          byKind: {},
          overdueCount: 2,
        },
      },
      loading: false,
      error: null,
    };
    render(<Inbox />);
    // Match within the page subtitle specifically (panel may also render
    // a summary with the same numbers; we anchor on the wrapper-only
    // sub-string "Pendientes ordenados por urgencia").
    const subtitle = screen.getByText(/Pendientes ordenados por urgencia/);
    expect(subtitle.textContent).toMatch(/7 ítems/i);
    expect(subtitle.textContent).toMatch(/2 vencidos/i);
  });

  it('muestra offline chip cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockIsOnline = false;
    mockUseInbox = {
      data: {
        items: [],
        summary: { total: 0, byUrgency: { urgent: 0, high: 0, medium: 0, low: 0 }, byKind: {}, overdueCount: 0 },
      },
      loading: false,
      error: null,
    };
    render(<Inbox />);
    expect(screen.getByTestId('inbox-offline-chip')).toBeInTheDocument();
  });

  it('muestra error del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena' };
    mockUseInbox = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<Inbox />);
    expect(screen.getByTestId('inbox-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });
});
