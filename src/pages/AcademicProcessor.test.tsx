// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AcademicProcessor } from './AcademicProcessor';

const mocks = vi.hoisted(() => ({ summarize: vi.fn(), addNode: vi.fn() }));
vi.mock('../services/geminiService', () => ({ extractAcademicSummary: mocks.summarize }));
vi.mock('../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: mocks.addNode }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: 'p1' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
vi.mock('../components/shared/Card', () => ({
  Card: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
  Button: ({ children, disabled, onClick }: React.ComponentProps<'button'>) => (
    <button disabled={disabled} onClick={onClick}>{children}</button>
  ),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('requires a fresh extraction after editing the source before saving', async () => {
  mocks.summarize.mockResolvedValueOnce('Resumen A').mockResolvedValueOnce('Resumen B');
  mocks.addNode.mockResolvedValue({ id: 'node-b' });
  render(<AcademicProcessor />);
  const source = screen.getByRole('textbox');
  const extract = screen.getByRole('button', { name: 'Extraer Conocimiento' });
  fireEvent.change(source, { target: { value: 'Paper A' } });
  fireEvent.click(extract);
  await screen.findByText('Resumen A');
  fireEvent.change(source, { target: { value: 'Paper B con otro largo' } });
  expect(screen.queryByText('Resumen A')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar en Zettelkasten' })).not.toBeInTheDocument();
  expect(mocks.addNode).not.toHaveBeenCalled();
  fireEvent.click(extract);
  await screen.findByText('Resumen B');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar en Zettelkasten' })); });
  expect(mocks.addNode).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    projectId: 'p1', description: 'Resumen B', metadata: expect.objectContaining({ sourceTextLength: 'Paper B con otro largo'.length }),
  }));
});

it('discards a late summary when the source changed and then returned to its original value', async () => {
  let resolve!: (value: string) => void;
  mocks.summarize.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  render(<AcademicProcessor />);
  const source = screen.getByRole('textbox');
  fireEvent.change(source, { target: { value: 'Paper A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Extraer Conocimiento' }));
  fireEvent.change(source, { target: { value: 'Paper B' } });
  fireEvent.change(source, { target: { value: 'Paper A' } });
  await act(async () => { resolve('Resumen obsoleto'); });
  expect(screen.queryByText('Resumen obsoleto')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Extraer Conocimiento' })).toBeEnabled();
});
