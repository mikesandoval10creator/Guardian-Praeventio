// @vitest-environment jsdom
//
// Bloque D Rama 2 — DeduplicationPanel render + submit tests (hook mocked).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const detectMock = vi.fn(async (..._args: unknown[]) => ({
  candidates: [
    {
      primaryId: 'record-a',
      duplicateIds: ['record-b'],
      confidence: 0.92,
      reasons: ['email_exact', 'name_fuzzy'],
      recommendedAction: 'suggest_merge',
    },
  ],
}));

vi.mock('../../hooks/useDeduplication', () => ({
  detectRecordDuplicates: (...args: unknown[]) => detectMock(...args),
}));

import { DeduplicationPanel } from './DeduplicationPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<DeduplicationPanel />', () => {
  it('renders the form with submit disabled until both names are set', () => {
    render(<DeduplicationPanel projectId="proj-1" />);
    expect(screen.getByTestId('deduplication-panel')).toBeInTheDocument();
    expect(screen.getByTestId('deduplication-submit')).toBeDisabled();
  });

  it('submits both records via the hook and renders the candidates', async () => {
    render(<DeduplicationPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('deduplication-name-a'), { target: { value: 'Juan Pérez' } });
    fireEvent.change(screen.getByTestId('deduplication-email-a'), { target: { value: 'JP@Example.com' } });
    fireEvent.change(screen.getByTestId('deduplication-name-b'), { target: { value: 'J. Perez' } });
    fireEvent.change(screen.getByTestId('deduplication-email-b'), { target: { value: 'jp@example.com' } });
    fireEvent.click(screen.getByTestId('deduplication-submit'));

    await waitFor(() => expect(detectMock).toHaveBeenCalledTimes(1));
    // Hook receives the projectId + the two normalized records.
    expect(detectMock.mock.calls[0][0]).toBe('proj-1');
    const input = detectMock.mock.calls[0][1] as {
      records: Array<{ id: string; kind: string; name: string; email?: string; createdAt: string }>;
    };
    expect(input.records).toHaveLength(2);
    expect(input.records[0].id).toBe('record-a');
    expect(input.records[0].email).toBe('jp@example.com'); // lowercased
    expect(input.records[1].name).toBe('J. Perez');
    // Record A is created before record B (deterministic anchor).
    expect(Date.parse(input.records[0].createdAt)).toBeLessThan(Date.parse(input.records[1].createdAt));

    const result = await screen.findByTestId('deduplication-result');
    expect(result).toHaveTextContent('Sugerir fusión');
    expect(result).toHaveTextContent('Confianza: 92%');
    expect(result).toHaveTextContent('Email exacto');
  });

  it('renders the error state when the hook rejects', async () => {
    detectMock.mockRejectedValueOnce(new Error('http_401'));
    render(<DeduplicationPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('deduplication-name-a'), { target: { value: 'Juan Pérez' } });
    fireEvent.change(screen.getByTestId('deduplication-name-b'), { target: { value: 'J. Perez' } });
    fireEvent.click(screen.getByTestId('deduplication-submit'));

    const error = await screen.findByTestId('deduplication-error');
    expect(error).toHaveTextContent('http_401');
    expect(screen.queryByTestId('deduplication-result')).toBeNull();
  });
});
