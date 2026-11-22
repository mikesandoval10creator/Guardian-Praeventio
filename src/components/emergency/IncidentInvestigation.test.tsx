// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IncidentInvestigation } from './IncidentInvestigation';

const { investigate, addNode } = vi.hoisted(() => ({ investigate: vi.fn(), addNode: vi.fn() }));
vi.mock('../../services/geminiService', () => ({ investigateIncidentWithAI: investigate }));
vi.mock('../../contexts/UniversalKnowledgeContext', () => ({ useUniversalKnowledge: () => ({ nodes: [] }) }));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: 'p1' } }) }));
vi.mock('../../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ addNode }) }));
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));

it('explains an analysis failure, preserves the form, and clears the message on retry', async () => {
  investigate.mockRejectedValueOnce(new Error('internal provider details')).mockResolvedValueOnce({
    summary: 'Resultado de prueba', immediateCauses: [], rootCauses: [], correctiveActions: [],
  });
  render(<IncidentInvestigation />);
  const title = screen.getByRole('textbox', { name: 'Título del Incidente' });
  const description = screen.getByRole('textbox', { name: 'Descripción / Relato' });
  fireEvent.change(title, { target: { value: 'Incidente de prueba' } });
  fireEvent.change(description, { target: { value: 'Relato de prueba' } });
  const start = () => act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Investigación IA' }));
  });
  await start();
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo analizar el incidente. Inténtalo de nuevo.');
  expect(screen.queryByText('internal provider details')).not.toBeInTheDocument();
  expect(title).toHaveValue('Incidente de prueba');
  expect(description).toHaveValue('Relato de prueba');
  await start();
  expect(screen.getByText('Resultado de prueba')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(investigate).toHaveBeenLastCalledWith('Incidente de prueba', 'Relato de prueba', '');
  expect(addNode).not.toHaveBeenCalled();
});

it.each([0, 1])('requires a fresh analysis after editing field %i', async (field) => {
  investigate.mockResolvedValueOnce({
    summary: 'Análisis anterior', immediateCauses: [], rootCauses: [], correctiveActions: [],
  });
  render(<IncidentInvestigation />);
  const fields = screen.getAllByRole('textbox');
  fireEvent.change(fields[0], { target: { value: 'Incidente de prueba' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Investigación IA' }));
  });
  expect(screen.getByRole('button', { name: 'Guardar en Red Neuronal' })).toBeEnabled();
  fireEvent.change(fields[field], { target: { value: 'Datos corregidos' } });
  expect(screen.queryByRole('button', { name: 'Guardar en Red Neuronal' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Iniciar Investigación IA' })).toBeEnabled();
});
