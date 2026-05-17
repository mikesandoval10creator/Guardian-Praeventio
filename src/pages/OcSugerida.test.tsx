// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §171-179 OcSugerida smoke tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return _k;
    },
  }),
}));

import { OcSugerida } from './OcSugerida';

function renderPage(initialEntry = '/oc-sugerida') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OcSugerida />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock'),
    });
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  }
  if (!('revokeObjectURL' in URL)) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  }
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('<OcSugerida /> Sprint K §171-179', () => {
  it('smoke: renders inputs, table and export action', () => {
    renderPage();
    expect(screen.getByTestId('oc-sugerida-page')).toBeInTheDocument();
    expect(screen.getByTestId('oc-inputs')).toBeInTheDocument();
    expect(screen.getByTestId('oc-table')).toBeInTheDocument();
    expect(screen.getByTestId('oc-total')).toBeInTheDocument();
    expect(screen.getByTestId('oc-export-csv')).toBeInTheDocument();
  });

  it('honours ?industry & ?workers query params', () => {
    renderPage('/oc-sugerida?industry=GP-MIN&workers=100');
    const ind = screen.getByTestId('oc-industry') as HTMLSelectElement;
    const w = screen.getByTestId('oc-workers') as HTMLInputElement;
    expect(ind.value).toBe('GP-MIN');
    expect(w.value).toBe('100');
  });

  it('recomputes total when worker count changes', () => {
    renderPage('/oc-sugerida?industry=GP-CONS&workers=10');
    const totalBefore = screen.getByTestId('oc-total').textContent ?? '';
    const w = screen.getByTestId('oc-workers') as HTMLInputElement;
    fireEvent.change(w, { target: { value: '100' } });
    const totalAfter = screen.getByTestId('oc-total').textContent ?? '';
    expect(totalAfter).not.toBe(totalBefore);
  });

  it('exports CSV when clicking Exportar CSV', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('oc-export-csv'));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
