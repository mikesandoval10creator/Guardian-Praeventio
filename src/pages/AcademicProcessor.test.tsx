// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AcademicProcessor } from './AcademicProcessor';

const mocks = vi.hoisted(() => ({ summarize: vi.fn(), addNode: vi.fn(), projectId: 'p1', uid: 'u1' as string | null }));
vi.mock('../services/geminiService', () => ({ extractAcademicSummary: mocks.summarize }));
vi.mock('../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: mocks.addNode }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: mocks.projectId } }) }));
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: mocks.uid ? { uid: mocks.uid } : null }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_: string, fallback: string) => fallback }) }));
vi.mock('../components/shared/Card', () => ({
  Card: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
  Button: ({ children, disabled, onClick }: React.ComponentProps<'button'>) => (
    <button disabled={disabled} onClick={onClick}>{children}</button>
  ),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.projectId = 'p1'; mocks.uid = 'u1'; });

it('clears the draft on project change and ignores a late response after returning to the original project', async () => {
  let resolve!: (value: string) => void;
  mocks.summarize.mockReturnValueOnce(new Promise<string>((done) => { resolve = done; }));
  const view = render(<AcademicProcessor />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Paper privado A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Extraer Conocimiento' }));
  mocks.projectId = 'p2';
  view.rerender(<AcademicProcessor />);
  const valueOnB = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
  mocks.projectId = 'p1';
  view.rerender(<AcademicProcessor />);
  await act(async () => { resolve('Resumen privado A'); });
  expect(valueOnB).toBe('');
  expect(screen.queryByText('Resumen privado A')).not.toBeInTheDocument();
  expect(mocks.addNode).not.toHaveBeenCalled();
});

it('does not carry an extracted summary over to a different account', async () => {
  mocks.summarize.mockResolvedValueOnce('Resumen privado');
  const view = render(<AcademicProcessor />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Paper privado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Extraer Conocimiento' }));
  await screen.findByText('Resumen privado');
  mocks.uid = 'u2';
  view.rerender(<AcademicProcessor />);
  expect(screen.queryByText('Resumen privado')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
});

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
  expect(screen.queryByRole('button', { name: 'Guardar resumen' })).not.toBeInTheDocument();
  expect(mocks.addNode).not.toHaveBeenCalled();
  fireEvent.click(extract);
  await screen.findByText('Resumen B');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar resumen' })); });
  expect(screen.getByRole('button', { name: 'Pendiente de sincronización' })).toBeDisabled();
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
