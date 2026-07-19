// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteBookViewer } from './SiteBookViewer.js';
import { NewEntryForm } from './NewEntryForm.js';
import type { SiteBookEntry } from '../../services/siteBook/siteBookService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function entry(over: Partial<SiteBookEntry> & { folio: string; year: number; sequenceNumber: number }): SiteBookEntry {
  return {
    id: `id-${over.folio}`,
    projectId: 'p1',
    kind: over.kind ?? 'inspection',
    occurredAt: over.occurredAt ?? '2026-05-11T10:00:00Z',
    recordedAt: '2026-05-11T10:05:00Z',
    recordedByUid: 'u1',
    recordedByRole: 'supervisor',
    description: over.description ?? 'Inspección de rutina sector A.',
    status: over.status ?? 'open',
    // Spread `over` LAST so folio/year/sequenceNumber from the caller
    // override our defaults instead of being overwritten by the spread.
    // The original `folio: over.folio` early in the object literal was
    // dead code — the trailing `...over` always shadowed it.
    ...over,
  };
}

describe('<SiteBookViewer />', () => {
  it('empty state', () => {
    render(<SiteBookViewer entries={[]} />);
    expect(screen.getByTestId('sitebook-viewer-empty')).toBeInTheDocument();
  });

  it('ordena por año + sequenceNumber desc', () => {
    render(
      <SiteBookViewer
        entries={[
          entry({ folio: 'SB-2026-000001', year: 2026, sequenceNumber: 1 }),
          entry({ folio: 'SB-2026-000005', year: 2026, sequenceNumber: 5 }),
          entry({ folio: 'SB-2025-000100', year: 2025, sequenceNumber: 100 }),
        ]}
      />,
    );
    const items = screen.getAllByTestId(/^sitebook-entry-/);
    expect(items[0].getAttribute('data-testid')).toBe('sitebook-entry-SB-2026-000005');
    expect(items[1].getAttribute('data-testid')).toBe('sitebook-entry-SB-2026-000001');
    expect(items[2].getAttribute('data-testid')).toBe('sitebook-entry-SB-2025-000100');
  });

  it('onEntryClick dispara con la entrada', () => {
    const onClick = vi.fn();
    render(
      <SiteBookViewer
        entries={[entry({ folio: 'SB-2026-000001', year: 2026, sequenceNumber: 1 })]}
        onEntryClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('sitebook-entry-SB-2026-000001'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('muestra badge "corrects" si la entrada corrige otra', () => {
    render(
      <SiteBookViewer
        entries={[
          entry({
            folio: 'SB-2026-000002',
            year: 2026,
            sequenceNumber: 2,
            correctsEntryFolio: 'SB-2026-000001',
          }),
        ]}
      />,
    );
    expect(screen.getByText(/Corrige/i)).toBeInTheDocument();
  });
});

describe('<NewEntryForm />', () => {
  it('submit deshabilitado hasta descripción mínima', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NewEntryForm projectId="p1" recordedByUid="u1" recordedByRole="supervisor" onSubmit={onSubmit} />,
    );
    const submit = screen.getByTestId('sitebook-submit');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('sitebook-description'), 'Hola corto');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('sitebook-description'), ' ahora supera el largo mínimo del cuerpo.');
    expect(submit).not.toBeDisabled();
  });

  it('submit válido llama onSubmit con payload correcto', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NewEntryForm projectId="p1" recordedByUid="u1" recordedByRole="supervisor" onSubmit={onSubmit} />,
    );
    await user.type(
      screen.getByTestId('sitebook-description'),
      'Inspección de rutina, todo conforme. Sector A nivel 3.',
    );
    await user.type(screen.getByTestId('sitebook-location'), 'Sector A');
    await user.type(screen.getByTestId('sitebook-involved'), 'w1, w2');
    fireEvent.submit(screen.getByTestId('sitebook-new-entry-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.projectId).toBe('p1');
    expect(payload.description).toContain('Inspección');
    expect(payload.location).toBe('Sector A');
    expect(payload.involvedWorkerUids).toEqual(['w1', 'w2']);
  });

  it('error de submit se muestra al usuario', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('folio_conflict'));
    render(
      <NewEntryForm projectId="p1" recordedByUid="u1" recordedByRole="supervisor" onSubmit={onSubmit} />,
    );
    await user.type(
      screen.getByTestId('sitebook-description'),
      'Descripción válida para test de error.',
    );
    fireEvent.submit(screen.getByTestId('sitebook-new-entry-form'));
    const err = await screen.findByTestId('sitebook-error');
    expect(err).toHaveTextContent(/folio ya existe/i);
  });

  it('onCancel dispara al click cancelar', async () => {
    const onCancel = vi.fn();
    render(
      <NewEntryForm
        projectId="p1"
        recordedByUid="u1"
        recordedByRole="supervisor"
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('sitebook-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
