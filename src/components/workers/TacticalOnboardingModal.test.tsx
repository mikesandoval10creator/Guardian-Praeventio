// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const state = vi.hoisted(() => ({ sequence: 0, save: vi.fn(async (_key: string, _value: unknown) => undefined), enqueue: vi.fn(async (_action: unknown) => undefined), error: vi.fn() }));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: 'project-1', name: 'Fixture project' } }) }));
vi.mock('../../services/firebase', () => ({ db: {}, collection: (_db: unknown, path: string) => ({ path }), doc: () => ({ id: `document-${++state.sequence}` }) }));
vi.mock('../../services/bunker', () => ({ FileStorageService: { saveFile: state.save } }));
vi.mock('../../utils/pwa-offline', () => ({ saveForSync: state.enqueue, saveBunkerKnowledge: state.save }));
vi.mock('../../services/sync/queueIdentity', () => ({ resolveCurrentQueueIdentity: async () => ({ ownerUid: 'owner', tenantId: 'tenant', installationId: 'installation', schemaVersion: 2 }), queueIdentitiesMatch: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b) }));
vi.mock('../../contexts/NotificationContext', () => ({ useNotifications: () => ({ addNotification: state.error }) }));
vi.mock('jspdf', () => ({ default: class { setFontSize() {} text() {} addImage() {} output() { return new Blob(['synthetic PDF fixture'], { type: 'application/pdf' }); } } }));
vi.mock('framer-motion', () => ({ motion: new Proxy({}, { get: (_target, tag: string) => React.forwardRef<HTMLElement, Record<string, unknown>>(function Motion({ initial: _i, animate: _a, exit: _e, transition: _t, ...props }, ref) { return React.createElement(tag, { ...props, ref }); }) }), AnimatePresence: ({ children }: { children: React.ReactNode }) => children }));
import { TacticalOnboardingModal } from './TacticalOnboardingModal';
async function generate() { fireEvent.click(screen.getByRole('button', { name: /proceder a firma/i })); fireEvent.click(screen.getByRole('button', { name: /firmar y generar/i })); await waitFor(() => expect(screen.getByText(/Onboarding Completado/)).toBeInTheDocument()); }
beforeEach(() => { state.sequence = 0; vi.clearAllMocks(); vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA=='); });
afterEach(cleanup);
describe('onboarding PDF persistence scope (not legal/signature validity)', () => {
  it('retries a partial generation with the same document identity and immutable PDF bytes', async () => {
    state.enqueue.mockRejectedValueOnce(new Error('injected queue failure'));
    render(<TacticalOnboardingModal isOpen onClose={() => {}} workerData={{ id: 'worker-1', projectId: 'project-1', name: 'Same Name', role: 'Soldador' }} />);
    fireEvent.click(screen.getByRole('button', { name: /proceder a firma/i }));
    fireEvent.click(screen.getByRole('button', { name: /firmar y generar/i }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    const first = state.save.mock.calls[0][1] as { blob: Blob };
    fireEvent.click(screen.getByRole('button', { name: /firmar y generar/i }));
    await waitFor(() => expect(screen.getByText(/Onboarding Completado/)).toBeInTheDocument());
    const retry = state.save.mock.calls[1][1] as { blob: Blob };
    expect(state.save.mock.calls[1][0]).toBe(state.save.mock.calls[0][0]);
    expect(retry.blob).toBe(first.blob);
  });
  it('queues the five PDFs under stable worker/project document identities consumed by DocsModal', async () => {
    render(<TacticalOnboardingModal isOpen onClose={() => {}} workerData={{ id: 'worker-1', projectId: 'project-1', name: 'Same Name', role: 'Soldador' }} />);
    await generate();
    expect(state.enqueue).toHaveBeenCalledTimes(5);
    const actions = state.enqueue.mock.calls.map(([value]) => value as { collection: string; docId: string; data: { storagePath: string; documentData: { projectId: string; workerId: string; name: string; archived: boolean } } });
    expect(actions.map((a) => a.docId)).toEqual(['document-1', 'document-2', 'document-3', 'document-4', 'document-5']);
    for (const action of actions) {
      expect(action.collection).toBe('projects/project-1/workers/worker-1/documents');
      expect(action.data.storagePath).toMatch(new RegExp(`^projects/project-1/workers/worker-1/documents/${action.docId}/[^/]+\\.pdf$`));
      expect(action.data.documentData).toMatchObject({ projectId: 'project-1', workerId: 'worker-1', archived: false });
      expect(action.data.documentData.name).toMatch(/\.pdf$/);
    }
    expect(new Set(state.save.mock.calls.map(([key]) => key)).size).toBe(5);
    expect(screen.queryByText(/Google Drive/)).not.toBeInTheDocument();
  });
});
