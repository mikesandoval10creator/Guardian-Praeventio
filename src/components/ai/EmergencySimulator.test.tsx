// @vitest-environment jsdom
//
// Regression: "Escalar a Emergencia Real" from the AI drill simulator must
// pass the selected projectId. EmergencyContext uses it to persist the
// activation packet and fan out FCM; without it only the local alarm fires
// and no responder is notified.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  projectId: 'p1' as string | null,
  uid: 'worker-1',
  triggerEmergency: vi.fn(async () => undefined),
  addNode: vi.fn(async () => undefined),
  scenario: {
    title: 'Incendio en bodega',
    type: 'Incendio',
    description: 'Humo denso en el sector norte.',
    location: 'Bodega norte',
    coordinates: { x: 10, y: 20 },
    criticality: 'Crítica',
    responseSteps: ['Evacuar', 'Llamar a brigada'],
    requiredEPP: ['Casco', 'Máscara'],
    emergencyContacts: ['Brigada interna'],
  },
}));

vi.mock('../../contexts/EmergencyContext', () => ({
  useEmergency: () => ({
    isEmergencyActive: false,
    emergencyType: null,
    triggerEmergency: h.triggerEmergency,
    resolveEmergency: vi.fn(),
  }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: { uid: h.uid } }) }));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: h.projectId ? { id: h.projectId, name: 'Faena' } : null,
    projects: [],
    setSelectedProject: vi.fn(),
    createProject: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock('../../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({ nodes: [], loading: false }),
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ addNode: h.addNode }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../services/geminiService', () => ({
  generateEmergencyScenario: vi.fn(async () => h.scenario),
}));

// Plain elements: the real motion wrappers schedule animation frames that
// outlive the test and show up as an async leak under detectAsyncLeaks.
vi.mock('framer-motion', () => ({
  motion: {
    div: (props: Record<string, unknown>) => {
      const {
        children,
        initial: _initial,
        animate: _animate,
        exit: _exit,
        transition: _transition,
        ...rest
      } = props;
      return React.createElement('div', rest, children as React.ReactNode);
    },
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { EmergencySimulator } from './EmergencySimulator';
import { generateEmergencyScenario } from '../../services/geminiService';

beforeEach(() => {
  h.projectId = 'p1';
  h.uid = 'worker-1';
  h.triggerEmergency.mockClear();
  h.addNode.mockClear();
});

describe('EmergencySimulator — drill escalation', () => {
  it.each(['project', 'account', 'missing project'])('discards a ready drill after changing %s', async (change) => {
    const view = render(<EmergencySimulator />);
    fireEvent.click(screen.getByRole('button', { name: /Generar Simulacro Dinámico/i }));
    await screen.findByRole('button', { name: /Escalar a Emergencia Real/i });

    if (change === 'project') h.projectId = 'p2';
    else if (change === 'account') h.uid = 'worker-2';
    else h.projectId = null;
    view.rerender(<EmergencySimulator />);

    expect(screen.queryByRole('heading', { name: h.scenario.title })).toBeNull();
    expect(screen.queryByRole('button', { name: /Escalar a Emergencia Real/i })).toBeNull();
    expect(h.triggerEmergency).not.toHaveBeenCalled();
    expect(h.addNode).not.toHaveBeenCalled();
  });

  it('ignores a late drill response even after returning to the original project', async () => {
    let finish!: (scenario: typeof h.scenario) => void;
    vi.mocked(generateEmergencyScenario).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(<EmergencySimulator />);
    fireEvent.click(screen.getByRole('button', { name: /Generar Simulacro Dinámico/i }));
    h.projectId = 'p2';
    view.rerender(<EmergencySimulator />);
    h.projectId = 'p1';
    view.rerender(<EmergencySimulator />);
    expect(screen.getByRole('button', { name: /Generar Simulacro Dinámico/i })).toBeEnabled();
    await act(async () => { finish(h.scenario); });

    expect(screen.queryByRole('button', { name: /Escalar a Emergencia Real/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Generar Simulacro Dinámico/i }));
    expect(await screen.findByRole('button', { name: /Escalar a Emergencia Real/i })).toBeEnabled();
  });

  it('dispatches and records only one escalation while the drill record is pending', async () => {
    let finish!: () => void;
    h.addNode.mockReturnValueOnce(new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
    render(<EmergencySimulator />);
    fireEvent.click(screen.getByRole('button', { name: /Generar Simulacro Dinámico/i }));
    const escalate = await screen.findByRole('button', { name: /Escalar a Emergencia Real/i });

    try {
      fireEvent.click(escalate);
      fireEvent.click(escalate);
      expect(h.triggerEmergency).toHaveBeenCalledTimes(1);
      expect(h.addNode).toHaveBeenCalledTimes(1);
      expect(escalate).toBeDisabled();
    } finally {
      await act(async () => { finish(); });
    }

    fireEvent.click(screen.getByRole('button', { name: /Generar Simulacro Dinámico/i }));
    expect(await screen.findByRole('button', { name: /Escalar a Emergencia Real/i })).toBeEnabled();
  });

  it('escalates with the selected projectId so the real emergency is delivered', async () => {
    render(<EmergencySimulator />);

    fireEvent.click(
      screen.getByRole('button', { name: /Generar Simulacro Dinámico/i }),
    );

    const escalate = await screen.findByRole('button', {
      name: /Escalar a Emergencia Real/i,
    });
    fireEvent.click(escalate);

    await waitFor(() => {
      expect(h.triggerEmergency).toHaveBeenCalledWith('incendio', 'p1');
    });
    expect(h.addNode).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
    );
  });
});
