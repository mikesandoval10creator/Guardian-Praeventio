// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmergencyPlanGenerator } from './EmergencyPlanGenerator';

const h = vi.hoisted(() => ({ addNode: vi.fn(), addDoc: vi.fn(), show: vi.fn() }));
vi.mock('../../services/geminiService', () => ({ generateEmergencyPlan: async () => 'Plan sintético' }));
vi.mock('../../contexts/UniversalKnowledgeContext', () => ({ useUniversalKnowledge: () => ({ nodes: [] }) }));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: 'p1', name: 'Faena' } }) }));
vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: h.addNode }) }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toasts: [], show: h.show, dismiss: vi.fn() }) }));
vi.mock('../../services/firebase', () => ({ addDoc: h.addDoc, collection: vi.fn(), db: {}, serverTimestamp: vi.fn() }));
vi.mock('../shared/Card', () => ({ Button: ({ children, disabled, onClick }: React.ComponentProps<'button'>) => (
  <button disabled={disabled} onClick={onClick}>{children}</button>
) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

async function savePlan() {
  render(<EmergencyPlanGenerator />);
  fireEvent.click(screen.getByRole('button', { name: 'Generar Plan' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar plan' }));
}

it('shows that the plan is queued for Zettelkasten only after both save operations succeed', async () => {
  h.addNode.mockResolvedValue({ id: 'node-1' });
  h.addDoc.mockResolvedValue({ id: 'draft-1' });
  await savePlan();
  expect(await screen.findByRole('button', { name: 'Pendiente de sincronización' })).toBeDisabled();
  expect(h.addNode).toHaveBeenCalledOnce();
  expect(h.addDoc).toHaveBeenCalledOnce();
});

it('does not claim a queued node when the writer returns null', async () => {
  h.addNode.mockResolvedValue(null);
  h.addDoc.mockResolvedValue({ id: 'draft-1' });
  await savePlan();
  await waitFor(() => expect(h.show).toHaveBeenCalledWith('No se pudo confirmar que el plan se guardó.', 'error'));
  expect(screen.queryByRole('button', { name: 'Pendiente de sincronización' })).not.toBeInTheDocument();
});
