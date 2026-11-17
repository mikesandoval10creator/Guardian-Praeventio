// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareChange, submitForReview } from '../services/changeMgmt/operationalChangeService';
import { OperationalChanges } from './OperationalChanges';

const runtime = vi.hoisted(() => ({
  project: { id: 'A', name: 'Alpha' } as { id: string; name: string } | null,
  user: { uid: 'hse', customClaims: { role: 'prevencionista' } } as { uid: string; customClaims?: { role: string } } | null,
  onChanges: undefined as ((changes: any[]) => void) | undefined,
}));
const api = vi.hoisted(() => ({
  decide: vi.fn(async () => ({})),
  revert: vi.fn(async () => ({})),
  verify: vi.fn(async () => ({})),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback: unknown) => typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key) }),
}));
vi.mock('../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: runtime.user, userRole: 'prevencionista' }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: runtime.project }) }));
vi.mock('../services/changeMgmt/operationalChangeStore', () => ({
  subscribeChanges: (_projectId: string, next: (changes: any[]) => void) => {
    runtime.onChanges = next;
    return vi.fn();
  },
}));
vi.mock('../services/changeMgmt/operationalChangeApi', () => ({
  declareChangeApi: vi.fn(), acknowledgeChangeApi: vi.fn(), submitChangeApi: vi.fn(),
  decideChangeApi: api.decide, activateChangeApi: vi.fn(), verifyChangeApi: api.verify,
  revertChangeApi: api.revert,
}));

function fixture() {
  return submitForReview(declareChange({
    projectId: 'A', kind: 'procedure', whatChanged: 'Cambiar procedimiento de izaje',
    previousValue: 'v1', newValue: 'v2', rationale: 'Validación preventiva del procedimiento',
    impact: 'low', affectedWorkerUids: [], declaredByUid: 'creator', declaredByRole: 'supervisor',
    effectiveFrom: '2026-05-25T08:00:00Z', now: new Date('2026-05-24T10:00:00Z'),
  }), 'creator', new Date('2026-05-24T11:00:00Z'));
}

beforeEach(() => {
  runtime.project = { id: 'A', name: 'Alpha' };
  runtime.user = { uid: 'hse', customClaims: { role: 'prevencionista' } };
  runtime.onChanges = undefined;
  api.decide.mockReset().mockImplementation(async () => ({}));
  api.revert.mockReset().mockImplementation(async () => ({}));
  api.verify.mockReset().mockImplementation(async () => ({}));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('OperationalChanges project scope', () => {
  it('invalidates an approval modal when selected project changes A → B', () => {
    const change = fixture();
    const view = render(<OperationalChanges />);
    const staleProjectAListener = runtime.onChanges;
    act(() => runtime.onChanges?.([change]));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    runtime.project = { id: 'B', name: 'Beta' };
    view.rerender(<OperationalChanges />);
    act(() => {
      staleProjectAListener?.([change]);
      runtime.onChanges?.([change]);
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Cambiar procedimiento de izaje')).toBeNull();
    expect(api.decide).not.toHaveBeenCalled();
  });

  it('does not resurrect project A action after A → B → A', () => {
    const view = render(<OperationalChanges />);
    act(() => runtime.onChanges?.([fixture()]));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    runtime.project = { id: 'B', name: 'Beta' };
    view.rerender(<OperationalChanges />);
    runtime.project = { id: 'A', name: 'Alpha' };
    view.rerender(<OperationalChanges />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.decide).not.toHaveBeenCalled();
  });

  it('does not submit an MOC action twice while the first confirmation is in flight', async () => {
    let releaseDecision!: () => void;
    const pendingDecision = new Promise<Record<string, never>>(resolve => {
      releaseDecision = () => resolve({});
    });
    api.decide.mockReturnValue(pendingDecision);
    const view = render(<OperationalChanges />);
    act(() => runtime.onChanges?.([fixture()]));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Aprobación preventiva suficiente' } });
    const confirm = within(dialog).getByRole('button', { name: 'Aprobar' });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(api.decide).toHaveBeenCalledTimes(1);
    await act(async () => { releaseDecision(); await pendingDecision; });
    view.unmount();
  });

  it.each([
    { kind: 'reject', label: 'Rechazar', status: 'pending_review' },
    { kind: 'revert', label: 'Revertir', status: 'in_effect' },
    { kind: 'verify', label: 'Verificar efectividad', status: 'in_effect' },
  ] as const)('invalidates the $kind modal on project change', ({ label, status }) => {
    const change = { ...fixture(), status };
    const view = render(<OperationalChanges />);
    act(() => runtime.onChanges?.([change]));
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    runtime.project = { id: 'B', name: 'Beta' };
    view.rerender(<OperationalChanges />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.decide).not.toHaveBeenCalled();
    expect(api.revert).not.toHaveBeenCalled();
    expect(api.verify).not.toHaveBeenCalled();
  });
});
