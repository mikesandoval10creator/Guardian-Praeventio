// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventDetailsModal } from './EventDetailsModal';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), projectId: 'p1' }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  motion: { div: ({ children }: React.PropsWithChildren) => <div>{children}</div> },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'es' } }) }));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({
  selectedProject: { id: mocks.projectId }, projects: [{ id: 'p1', name: 'Norte' }],
}) }));
vi.mock('../../services/firebase', () => ({ db: {}, serverTimestamp: () => 'server-time' }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string, id: string) => `${path}/${id}`,
  collection: (_db: unknown, path: string) => path,
  query: (path: string) => path, where: vi.fn(), getDocs: mocks.read, updateDoc: mocks.write, deleteDoc: vi.fn(),
}));

afterEach(() => {
  cleanup();
  mocks.projectId = 'p1';
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

const event = { id: 'event-1', projectId: 'p1', title: 'Inspección', description: 'Revisión', date: '2026-12-01', time: '08:00', location: 'Taller', type: 'Reunión' } as const;

function editEvent() {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  const onClose = vi.fn();
  const view = render(<EventDetailsModal isOpen event={event} onClose={onClose} />);
  fireEvent.click(screen.getByTitle('Editar'));
  const time = screen.getByDisplayValue('08:00');
  fireEvent.change(time, { target: { value: '09:00' } });
  fireEvent.submit(time.closest('form')!);
  expect(mocks.read).toHaveBeenCalledOnce();
  return { ...view, onClose };
}

describe('EventDetailsModal project transitions', () => {
  it('does not start writing an old edit after switching projects during the conflict check', async () => {
    let release!: (value: { docs: [] }) => void;
    mocks.read.mockReturnValue(new Promise<{ docs: [] }>((resolve) => { release = resolve; }));
    const { rerender, onClose } = editEvent();
    mocks.projectId = 'p2';
    rerender(<EventDetailsModal isOpen event={event} onClose={onClose} />);
    await act(async () => { release({ docs: [] }); });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(screen.queryByText('Inspección')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Editar')).not.toBeInTheDocument();
  });

  it('still updates the original event when its project remains selected', async () => {
    mocks.read.mockResolvedValue({ docs: [{ id: event.id }] });
    mocks.write.mockResolvedValue(undefined);
    editEvent();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledExactlyOnceWith('projects/p1/events/event-1', expect.objectContaining({ time: '09:00' })));
  });
});
