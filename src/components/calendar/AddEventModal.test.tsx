// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddEventModal } from './AddEventModal';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), selectedProject: { id: 'p1', name: 'Faena Norte' },
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children, role }: Pick<React.ComponentProps<'div'>, 'children' | 'role'>) => <div role={role}>{children}</div> },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | { projects: string; defaultValue: string }) =>
      typeof fallback === 'string' ? fallback : fallback.defaultValue.replace('{{projects}}', fallback.projects),
  }),
}));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: mocks.selectedProject,
    projects: [{ id: 'p1', name: 'Faena Norte' }, { id: 'p2', name: 'Faena 500' }],
  }),
}));
vi.mock('../../services/firebase', () => ({ db: {}, serverTimestamp: () => 'server-time' }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  where: vi.fn(),
  query: (ref: string) => ref,
  getDocs: mocks.read,
  addDoc: mocks.write,
}));

afterEach(() => {
  cleanup();
  mocks.selectedProject = { id: 'p1', name: 'Faena Norte' };
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

function submitEvent(prepare?: (view: ReturnType<typeof render>) => void) {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  const onClose = vi.fn();
  const view = render(<AddEventModal isOpen onClose={onClose} />);
  prepare?.(view);
  const { container } = view;
  fireEvent.change(screen.getByPlaceholderText('Ej: Inspección de Seguridad'), { target: { value: 'Inspección' } });
  fireEvent.change(screen.getByPlaceholderText('Ej: Sala de Reuniones 1'), { target: { value: 'Taller' } });
  fireEvent.change(screen.getByPlaceholderText('Detalles del evento...'), { target: { value: 'Revisión' } });
  fireEvent.change(container.querySelector('input[type=date]')!, { target: { value: '2026-12-01' } });
  fireEvent.change(container.querySelector('input[type=time]')!, { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar Evento' }));
  return onClose;
}

describe('AddEventModal scheduling conflicts', () => {
  it('abandons a pending save when switching projects and discards the old draft', async () => {
    let release!: (value: { empty: boolean }) => void;
    const pending = new Promise<{ empty: boolean }>((resolve) => { release = resolve; });
    mocks.read.mockReturnValue(pending);
    mocks.write.mockResolvedValue({ id: 'event-1' });
    let view!: ReturnType<typeof render>;
    const onClose = submitEvent((mounted) => { view = mounted; });
    mocks.selectedProject = { id: 'p2', name: 'Faena 500' };
    view.rerender(<AddEventModal isOpen onClose={onClose} />);
    try {
      expect(screen.getByPlaceholderText('Ej: Inspección de Seguridad')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Guardar Evento' })).toBeEnabled();
    } finally {
      await act(async () => { release({ empty: true }); });
    }
    expect(mocks.write).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not save twice when the form is resubmitted during the conflict check', async () => {
    let release!: (value: { empty: boolean }) => void;
    const pending = new Promise<{ empty: boolean }>((resolve) => { release = resolve; });
    mocks.read.mockReturnValue(pending);
    mocks.write.mockResolvedValue({ id: 'event-1' });
    const onClose = submitEvent();
    try {
      const button = screen.getByRole<HTMLButtonElement>('button', { name: /guardando/i });
      fireEvent.submit(button.form!);
    } finally {
      await act(async () => { release({ empty: true }); });
    }
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the conflicting project name even when it resembles an HTTP status', async () => {
    mocks.read.mockImplementation(async (path: string) => ({ empty: path !== 'projects/p2/events' }));
    const onClose = submitEvent();
    expect(await screen.findByText(/a la misma hora en: Faena 500/)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Faena 500');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Guardar Evento' })).toBeEnabled();
  });

  it('explains a denied save without exposing the internal error or clearing the draft', async () => {
    mocks.read.mockResolvedValue({ empty: true });
    mocks.write.mockRejectedValue(Object.assign(new Error('internal diagnostics'), { code: 'permission-denied' }));
    const onClose = submitEvent();
    expect(await screen.findByText('No tienes permiso para agendar en este proyecto. Pide acceso a su administrador.')).toBeVisible();
    expect(screen.queryByText('internal diagnostics')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Inspección')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Guardar Evento' })).toBeEnabled();
  });

  it('saves to the selected project when the slots are free', async () => {
    mocks.read.mockResolvedValue({ empty: true });
    mocks.write.mockResolvedValue({ id: 'event-1' });
    const onClose = submitEvent();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('projects/p1/events', expect.objectContaining({
      title: 'Inspección', projectId: 'p1', date: '2026-12-01', time: '09:00',
    }));
  });
});
