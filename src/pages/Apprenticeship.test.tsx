// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §244-250 page wrapper tests.
//
// Smoke tests for `<Apprenticeship />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hooks.
//   3. Error state surfaces with message.
//   4. Apprentices column renders cards with level + progress.
//   5. Mentors column renders cards with current/max load.
//   6. Register modal opens, submit calls `registerApprentice` mutation.
//   7. Authorize modal opens, submit calls `authorizeApprentice` mutation.
//
// Hermetic: hooks and contexts are mocked so the test has no fetch,
// no Firestore. Patterns match `LeadershipDecisions.test.tsx` and
// `CorrectiveActions.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Apprenticeship } from './Apprenticeship';
import * as sprintKHooks from '../hooks/useSprintK';
import type {
  ApprenticesResponse,
  MentorAvailabilityResponse,
  ApprenticeRecord,
  MentorAvailabilityEntry,
} from '../hooks/useSprintK';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
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

type ApprenticesMock = {
  data: ApprenticesResponse | null;
  loading: boolean;
  error: Error | null;
};
type MentorsMock = {
  data: MentorAvailabilityResponse | null;
  loading: boolean;
  error: Error | null;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockApprentices: ApprenticesMock;
let mockMentors: MentorsMock;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useApprentices: () => mockApprentices,
  useMentorAvailability: () => mockMentors,
  registerApprentice: vi.fn(),
  authorizeApprentice: vi.fn(),
  recordExposure: vi.fn(),
}));

function emptyApprentices(): ApprenticesMock {
  return { data: { apprentices: [] }, loading: false, error: null };
}
function emptyMentors(): MentorsMock {
  return { data: { mentors: [], maxLoad: 3 }, loading: false, error: null };
}

function apprentice(over: Partial<ApprenticeRecord> & { workerUid: string }): ApprenticeRecord {
  return {
    workerUid: over.workerUid,
    mentorUid: over.mentorUid ?? 'mentor_juan',
    role: over.role ?? 'aprendiz',
    startDate: over.startDate ?? '2026-03-01T00:00:00Z',
    currentLevel: over.currentLevel ?? 'observer',
    taskAuthorizations: over.taskAuthorizations ?? { loto_basico: 'observer' },
    progress: over.progress ?? 33,
    recentExposures: over.recentExposures ?? [],
    createdAt: over.createdAt ?? '2026-03-01T00:00:00Z',
    createdBy: over.createdBy ?? 'admin_uid',
    updatedAt: over.updatedAt,
  };
}

function mentorEntry(
  over: Partial<MentorAvailabilityEntry> & { mentorUid: string },
): MentorAvailabilityEntry {
  return {
    mentorUid: over.mentorUid,
    apprenticeUids: over.apprenticeUids ?? ['app_1'],
    currentLoad: over.currentLoad ?? 1,
    maxLoad: over.maxLoad ?? 3,
    available: over.available ?? true,
    availableSlots: over.availableSlots ?? 2,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockApprentices = emptyApprentices();
  mockMentors = emptyMentors();
});

describe('<Apprenticeship /> page wrapper (Sprint K §244-250)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<Apprenticeship />);
    expect(
      screen.getByTestId('apprenticeship-page-empty'),
    ).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras los hooks cargan', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockApprentices = { data: null, loading: true, error: null };
    render(<Apprenticeship />);
    expect(screen.getByTestId('apprenticeship-loading')).toBeInTheDocument();
  });

  it('muestra el mensaje del error del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockApprentices = {
      data: null,
      loading: false,
      error: new Error('Network down'),
    };
    render(<Apprenticeship />);
    expect(screen.getByTestId('apprenticeship-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza la lista de aprendices con nivel y progreso', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockApprentices = {
      data: {
        apprentices: [
          apprentice({
            workerUid: 'app_pedro',
            currentLevel: 'supervised',
            progress: 66,
          }),
          apprentice({
            workerUid: 'app_maria',
            currentLevel: 'observer',
            progress: 33,
          }),
        ],
      },
      loading: false,
      error: null,
    };
    render(<Apprenticeship />);
    expect(
      screen.getByTestId('apprenticeship-apprentices-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('apprenticeship-apprentice-app_pedro'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('apprenticeship-apprentice-app_maria'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('apprenticeship-progress-app_pedro'),
    ).toHaveTextContent('66%');
    // Level badge text uses LEVEL_META labels.
    expect(
      screen.getByTestId('apprenticeship-level-app_pedro'),
    ).toHaveTextContent(/asistente|supervisado/i);
  });

  it('renderiza los mentores con carga actual y slots disponibles', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockMentors = {
      data: {
        mentors: [
          mentorEntry({
            mentorUid: 'mentor_juan',
            currentLoad: 2,
            availableSlots: 1,
            apprenticeUids: ['a1', 'a2'],
          }),
          mentorEntry({
            mentorUid: 'mentor_full',
            currentLoad: 3,
            availableSlots: 0,
            available: false,
            apprenticeUids: ['b1', 'b2', 'b3'],
          }),
        ],
        maxLoad: 3,
      },
      loading: false,
      error: null,
    };
    render(<Apprenticeship />);
    expect(
      screen.getByTestId('apprenticeship-mentors-list'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('apprenticeship-mentor-mentor_juan'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('apprenticeship-mentor-load-mentor_juan'),
    ).toHaveTextContent('2/3');
    // Full mentor flagged.
    expect(
      screen.getByTestId('apprenticeship-mentor-status-mentor_full'),
    ).toHaveTextContent(/tope/i);
  });

  it('al registrar un aprendiz llama a registerApprentice y cierra el modal', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const registerMock = vi.mocked(sprintKHooks.registerApprentice);
    registerMock.mockResolvedValueOnce(
      apprentice({ workerUid: 'app_new', mentorUid: 'mentor_juan' }),
    );

    render(<Apprenticeship />);
    fireEvent.click(screen.getByTestId('apprenticeship-register-button'));
    expect(
      screen.getByTestId('apprenticeship-register-modal'),
    ).toBeInTheDocument();

    const uidInput = screen.getByTestId(
      'apprenticeship-register-modal-uid',
    ) as HTMLInputElement;
    fireEvent.change(uidInput, { target: { value: 'app_new' } });
    const mentorInput = screen.getByTestId(
      'apprenticeship-register-modal-mentor',
    ) as HTMLInputElement;
    fireEvent.change(mentorInput, { target: { value: 'mentor_juan' } });

    fireEvent.click(
      screen.getByTestId('apprenticeship-register-modal-submit'),
    );

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({
          uid: 'app_new',
          mentorUid: 'mentor_juan',
          role: 'aprendiz',
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('apprenticeship-register-modal'),
      ).not.toBeInTheDocument();
    });
  });

  it('al autorizar una tarea llama a authorizeApprentice con el mentorUid del aprendiz', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockApprentices = {
      data: {
        apprentices: [
          apprentice({
            workerUid: 'app_pedro',
            mentorUid: 'mentor_juan',
            currentLevel: 'observer',
            progress: 33,
          }),
        ],
      },
      loading: false,
      error: null,
    };
    const authorizeMock = vi.mocked(sprintKHooks.authorizeApprentice);
    authorizeMock.mockResolvedValueOnce({
      ok: true,
      workerUid: 'app_pedro',
      taskKind: 'loto_basico',
      toLevel: 'supervised',
      currentLevel: 'supervised',
      progress: 66,
    });

    render(<Apprenticeship />);
    fireEvent.click(
      screen.getByTestId('apprenticeship-authorize-button-app_pedro'),
    );
    expect(
      screen.getByTestId('apprenticeship-authorize-modal'),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByTestId('apprenticeship-authorize-modal-task'),
      { target: { value: 'loto_basico' } },
    );
    fireEvent.change(
      screen.getByTestId('apprenticeship-authorize-modal-evidence'),
      {
        target: {
          value: '10 ejecuciones supervisadas sin incidentes, evaluación OK',
        },
      },
    );
    // Default level option is 'observer'; switch to 'supervised'.
    fireEvent.change(
      screen.getByTestId('apprenticeship-authorize-modal-level'),
      { target: { value: 'supervised' } },
    );

    fireEvent.click(
      screen.getByTestId('apprenticeship-authorize-modal-submit'),
    );

    await waitFor(() => {
      expect(authorizeMock).toHaveBeenCalledWith(
        'p-1',
        'app_pedro',
        expect.objectContaining({
          taskKind: 'loto_basico',
          toLevel: 'supervised',
          signedByUid: 'mentor_juan',
        }),
      );
    });
  });
});
