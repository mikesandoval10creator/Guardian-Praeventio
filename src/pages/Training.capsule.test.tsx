// @vitest-environment jsdom
// Real Training page and HTTP client; provider and persistence boundaries are mocked.
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Training } from './Training';

// Animation timing is outside this DTO regression; keep real DOM and handlers.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  motion: { div: ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => <div {...props} /> },
}));
const mocks = vi.hoisted(() => ({ addDoc: vi.fn(), addNode: vi.fn(), fetch: vi.fn(), project: { id: 'project-a' } }));
vi.mock('../services/firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeaders: async () => ({}) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => path,
  where: vi.fn(), doc: vi.fn(), updateDoc: vi.fn(), setDoc: vi.fn(),
  addDoc: (...args: unknown[]) => mocks.addDoc(...args),
}));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mocks.project }) }));
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: { uid: 'worker-a', displayName: 'Ana' } }) }));
vi.mock('../contexts/UniversalKnowledgeContext', () => ({ useUniversalKnowledge: () => ({ nodes: [], loading: false }) }));
vi.mock('../hooks/useFirestoreCollection', () => ({ useFirestoreCollection: () => ({ data: [], loading: false }) }));
vi.mock('../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: mocks.addNode }) }));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../hooks/useMicrotraining', () => ({
  useMicrotrainingCatalog: () => ({ data: null }),
  useMicrotrainingRecommendation: () => ({ data: null }),
  useMicrotrainingCerts: () => ({ data: null, refetch: vi.fn() }), submitMicrotrainingSession: vi.fn(),
}));
vi.mock('../components/shared/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('../components/gamification/FindTheGuardian', () => ({ FindTheGuardian: () => null }));
vi.mock('../components/etl/CsvImportExportModal', () => ({ CsvImportExportModal: () => null }));
vi.mock('../components/spacedRepetition/SpacedRepetitionReviewQueue', () => ({ SpacedRepetitionReviewQueue: () => null }));
vi.mock('../components/safety/SafetyCapsules', () => ({ SafetyCapsules: () => null }));
vi.mock('../components/roleOnboarding/OnboardingTrackProgressPanel', () => ({ OnboardingTrackProgressPanel: () => null }));
vi.mock('../utils/trainingCertificate', () => ({ generateTrainingCertificate: vi.fn() }));
vi.mock('../services/gamificationService', () => ({ awardPoints: vi.fn() }));
vi.mock('../utils/pwa-offline', () => ({ saveForSync: vi.fn() }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : _key }) }));

const response = { title: 'Revisa tu entorno', content: 'Observa antes de comenzar.', keyTip: 'Mantén libre la ruta.', duration: '1 minuto' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.project = { id: 'project-a' };
  mocks.addDoc.mockResolvedValue({ id: 'capsule-storage-id' });
  mocks.addNode.mockResolvedValue('node-id');
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ result: response }), { status: 200 }));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function generate() {
  render(<Training />);
  fireEvent.click(screen.getByRole('button', { name: /cápsula/i }));
}

describe('Training capsule contract', () => {
  it('renders the real object response as explicit fields and persists a versioned DTO', async () => {
    await generate();
    expect(await screen.findByText(response.content)).toBeTruthy();
    expect(screen.getByText(response.title)).toBeTruthy();
    expect(screen.getByText(response.keyTip)).toBeTruthy();
    expect(screen.getByText(response.duration)).toBeTruthy();
    await waitFor(() => expect(mocks.addNode).toHaveBeenCalledTimes(1));
    expect(mocks.addDoc).toHaveBeenCalledWith('projects/project-a/training_capsules', {
      ...response, schemaVersion: 1, projectId: 'project-a', userId: 'worker-a', userName: 'Ana', createdAt: expect.any(String),
    });
    expect(mocks.addNode.mock.calls[0][0].metadata).toEqual(expect.objectContaining({ ...response, schemaVersion: 1, capsuleId: 'capsule-storage-id', userId: 'worker-a' }));
  });

  it('accepts legacy text without inventing a key tip or duration', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ result: 'Texto heredado.' }), { status: 200 }));
    await generate();
    expect(await screen.findByText('Texto heredado.')).toBeTruthy();
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalled());
    expect(mocks.addDoc.mock.calls[0][1]).toEqual(expect.objectContaining({ schemaVersion: 1, content: 'Texto heredado.', keyTip: '', duration: '' }));
  });

  it('rejects malformed provider data without saving and offers a readable retry', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ result: { ...response, content: { nested: 'invalid' } } }), { status: 200 }));
    await generate();
    expect((await screen.findByRole('alert')).textContent).toMatch(/intenta nuevamente/i);
    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(mocks.addNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /cápsula/i }));
    expect(await screen.findByText(response.content)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('uses the same validated DTO in the SafetyCapsules consumer', async () => {
    const { SafetyCapsules } = await vi.importActual<{ SafetyCapsules: React.ComponentType }>('../components/safety/SafetyCapsules');
    render(<SafetyCapsules />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar cápsula de seguridad' }));
    expect(await screen.findByText(response.title)).toBeTruthy();
    expect(screen.getByText(/Observa antes de comenzar/)).toBeTruthy();
    expect(screen.getByText(response.keyTip)).toBeTruthy();
  });

  it('shows a readable error in SafetyCapsules when the DTO is invalid', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ result: null }), { status: 200 }));
    const { SafetyCapsules } = await vi.importActual<{ SafetyCapsules: React.ComponentType }>('../components/safety/SafetyCapsules');
    render(<SafetyCapsules />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar cápsula de seguridad' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/intenta nuevamente/i);
  });

  it('does not claim saved training when persistence fails', async () => {
    mocks.addDoc.mockRejectedValueOnce(new Error('private persistence detail'));
    await generate();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Capacitación completada con éxito/)).toBeNull();
    expect(screen.queryByText(/Cápsula guardada/)).toBeNull();
    expect(mocks.addNode).not.toHaveBeenCalled();
  });

  it('does not report a graph record when addNode returns null', async () => {
    mocks.addNode.mockResolvedValueOnce(null);
    await generate();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Cápsula guardada/)).toBeNull();
  });

  it('ignores an old project response instead of displaying or persisting it', async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    mocks.fetch.mockReturnValueOnce(pending);
    const view = render(<Training />);
    fireEvent.click(screen.getByRole('button', { name: /cápsula/i }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    mocks.project = { id: 'project-b' };
    view.rerender(<Training />);
    await act(async () => { resolve(new Response(JSON.stringify({ result: response }), { status: 200 })); });
    expect(screen.queryByText(response.content)).toBeNull();
    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(mocks.addNode).not.toHaveBeenCalled();
  });
});
