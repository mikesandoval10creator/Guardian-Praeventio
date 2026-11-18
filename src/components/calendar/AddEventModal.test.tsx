// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddEventModal } from './AddEventModal';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));

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
    selectedProject: { id: 'p1', name: 'Faena Norte' },
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
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

function submitEvent() {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  const onClose = vi.fn();
  const { container } = render(<AddEventModal isOpen onClose={onClose} />);
  fireEvent.change(screen.getByPlaceholderText('Ej: Inspección de Seguridad'), { target: { value: 'Inspección' } });
  fireEvent.change(screen.getByPlaceholderText('Ej: Sala de Reuniones 1'), { target: { value: 'Taller' } });
  fireEvent.change(screen.getByPlaceholderText('Detalles del evento...'), { target: { value: 'Revisión' } });
  fireEvent.change(container.querySelector('input[type=date]')!, { target: { value: '2026-12-01' } });
  fireEvent.change(container.querySelector('input[type=time]')!, { target: { value: '09:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar Evento' }));
  return onClose;
}

describe('AddEventModal scheduling conflicts', () => {
  it('shows the conflicting project name even when it resembles an HTTP status', async () => {
    mocks.read.mockImplementation(async (path: string) => ({ empty: path !== 'projects/p2/events' }));
    const onClose = submitEvent();
    expect(await screen.findByText(/a la misma hora en: Faena 500/)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Faena 500');
    expect(mocks.write).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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
