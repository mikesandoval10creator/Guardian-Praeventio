// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { handleFireSpreadMessage } from '../../workers/fireSpreadWorker';
const h = vi.hoisted(() => ({ projectId: 'p1', emergency: vi.fn(), addNode: vi.fn() }));
vi.mock('../../contexts/UniversalKnowledgeContext', () => ({ useUniversalKnowledge: () => ({ nodes: [] }) }));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: h.projectId } }) }));
vi.mock('../../contexts/EmergencyContext', () => ({ useEmergency: () => ({ triggerEmergency: h.emergency }) }));
vi.mock('../../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode: h.addNode }) }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => false }));
vi.mock('../../services/geminiService', () => ({ generateEmergencyScenario: vi.fn() }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  motion: { div: ({ initial: _i, animate: _a, exit: _e, transition: _t, ...props }: Record<string, unknown>) => React.createElement('div', props) },
}));
import { EmergencySimulator } from './EmergencySimulator';
beforeEach(() => { vi.clearAllMocks(); h.projectId = 'p1'; });
afterEach(async () => { await act(async () => cleanup()); vi.unstubAllGlobals(); vi.useRealTimers(); });
function start() {
  const worker = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() });
  vi.stubGlobal('Worker', vi.fn(function () { return worker; }));
  const view = render(<EmergencySimulator />);
  fireEvent.click(screen.getByRole('button', { name: /Simulación de Propagación/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar simulación' }));
  expect(screen.getByRole('status').textContent).toMatch(/Calculando el modelo/);
  return { worker, view, reply: () => handleFireSpreadMessage(worker.postMessage.mock.calls[0][0]) };
}
describe('EmergencySimulator bounded local propagation', () => {
  it('renders the actual worker-model result without dispatching an emergency', async () => {
    const { worker, reply } = start();
    await act(async () => { worker.dispatchEvent(new MessageEvent('message', { data: reply() })); });
    expect(await screen.findByRole('img', { name: 'Línea de tiempo del área en combustión' })).toBeTruthy();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(h.emergency).not.toHaveBeenCalled();
    expect(h.addNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Simulación de Propagación/i }));
    fireEvent.click(screen.getByRole('button', { name: /Simulación de Propagación/i }));
    expect(screen.getByRole('img', { name: 'Línea de tiempo del área en combustión' })).toBeTruthy();
    expect(screen.queryByText(/Simulación cancelada/)).toBeNull();
  });
  it('cancels explicitly and never renders an ignored late worker reply', async () => {
    const { worker, reply } = start();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar simulación' }));
    await act(async () => { worker.dispatchEvent(new MessageEvent('message', { data: reply() })); });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toMatch(/Simulación cancelada/);
    expect(screen.queryByRole('img', { name: 'Línea de tiempo del área en combustión' })).toBeNull();
  });
  it('cancels the previous project computation and discards its late reply', async () => {
    const { worker, view, reply } = start();
    h.projectId = 'p2';
    view.rerender(<EmergencySimulator />);
    await act(async () => { worker.dispatchEvent(new MessageEvent('message', { data: reply() })); });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img', { name: 'Línea de tiempo del área en combustión' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ejecutar simulación' })).not.toBeDisabled();
  });
  it('cancels stale computations when parameters change', async () => {
    const { worker, reply } = start();
    fireEvent.change(screen.getByLabelText(/Tiempo total de simulación/i), { target: { value: '60' } });
    await act(async () => { worker.dispatchEvent(new MessageEvent('message', { data: reply() })); });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img', { name: 'Línea de tiempo del área en combustión' })).toBeNull();
  });
  it('reports timeout clearly and leaves no success chart or endless spinner', async () => {
    vi.useFakeTimers();
    const { worker } = start();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('alert').textContent).toMatch(/Reduce el horizonte/);
    expect(screen.queryByRole('img', { name: 'Línea de tiempo del área en combustión' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ejecutar simulación' })).not.toBeDisabled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('runs propagation in an owned worker rather than directly on the UI thread', () => {
    const worker = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() });
    const factory = vi.fn(function () { return worker; });
    vi.stubGlobal('Worker', factory);
    const view = render(<EmergencySimulator />);
    fireEvent.click(screen.getByRole('button', { name: /Simulación de Propagación/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar simulación' }));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ tMax: 30 }));
    view.unmount();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('visibly caps the requested training horizon rather than passing 10000 minutes to Euler', () => {
    render(<EmergencySimulator />);
    fireEvent.click(screen.getByRole('button', { name: /Simulación de Propagación/i }));
    const horizon = screen.getByLabelText(/Tiempo total de simulación/i);
    fireEvent.change(horizon, { target: { value: '10000' } });
    expect(horizon).toHaveValue(240);
    expect(horizon).toHaveAttribute('max', '240');
  });
});
