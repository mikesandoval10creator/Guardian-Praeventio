// @vitest-environment jsdom
//
// Regression: "Escalar a Emergencia Real" from the AI drill simulator must
// pass the selected projectId. EmergencyContext uses it to persist the
// activation packet and fan out FCM; without it only the local alarm fires
// and no responder is notified.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
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

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: { id: 'p1', name: 'Faena Norte' },
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

beforeEach(() => {
  h.triggerEmergency.mockClear();
  h.addNode.mockClear();
});

describe('EmergencySimulator — drill escalation', () => {
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
