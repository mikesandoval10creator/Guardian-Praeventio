// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExcelImportPreview } from './ExcelImportPreview.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<ExcelImportPreview />', () => {
  it('valida y muestra counts', () => {
    render(
      <ExcelImportPreview
        kind="workers"
        rows={[
          { rowNumber: 2, data: { fullName: 'María', rut: '11.111.111-1' } },
          { rowNumber: 3, data: { fullName: 'Pedro' } }, // sin rut
        ]}
      />,
    );
    expect(screen.getByTestId('xls-valid-count').textContent).toMatch(/1/);
    expect(screen.getByTestId('xls-issue-count').textContent).toMatch(/1/);
  });

  it('muestra issues list', () => {
    render(
      <ExcelImportPreview
        kind="workers"
        rows={[{ rowNumber: 5, data: { fullName: 'X' } }]}
      />,
    );
    expect(screen.getByTestId('xls-issues-list')).toBeInTheDocument();
    expect(screen.getByTestId('xls-issues-list').textContent).toMatch(/Fila 5/);
  });

  it('botón commit dispara con cleanRows', () => {
    const onCommit = vi.fn();
    render(
      <ExcelImportPreview
        kind="workers"
        rows={[{ rowNumber: 2, data: { fullName: 'María', rut: '11.111.111-1' } }]}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByTestId('xls-commit'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toHaveLength(1);
  });

  it('onCancel dispara', () => {
    const onCancel = vi.fn();
    render(
      <ExcelImportPreview
        kind="workers"
        rows={[]}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('xls-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
