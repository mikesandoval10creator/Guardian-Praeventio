// @vitest-environment jsdom
//
// Praeventio Guard — <ProjectSetup /> page wrapper tests.
//
// Verifies the end-to-end wire of the "industry preset" flow on the
// routed page:
//   1. Empty state when no project is selected (honest — no card, no
//      fabricated data).
//   2. The wizard loads the REAL preset catalog (GET .../industry/list,
//      mocked at the hook boundary) and lets the user pick one.
//   3. Applying the preset calls the REAL select endpoint
//      (POST .../industry/select, mocked at the hook boundary) and the
//      returned PresetApplication is rendered through <IndustryPresetCard />.
//
// Hermetic: only the network boundary (`useIndustryRules` HTTP wrappers)
// and `ProjectContext` are mocked — the wizard reducer, the card, and the
// page wiring run for real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectSetup } from './ProjectSetup';
import type {
  IndustryListResponse,
  SelectIndustryResponse,
} from '../hooks/useIndustryRules';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

// Network boundary: the wizard's defaultList/defaultSelect call these.
const listMock = vi.fn<(projectId: string) => Promise<IndustryListResponse>>();
const selectMock =
  vi.fn<
    (
      projectId: string,
      input: { industryPrefix: string },
      idempotencyKey?: string,
    ) => Promise<SelectIndustryResponse>
  >();

vi.mock('../hooks/useIndustryRules', () => ({
  listIndustryPresetsRemote: (projectId: string) => listMock(projectId),
  selectIndustryRemote: (
    projectId: string,
    input: { industryPrefix: string },
    idempotencyKey?: string,
  ) => selectMock(projectId, input, idempotencyKey),
}));

const SELECT_RESPONSE: SelectIndustryResponse = {
  application: {
    projectId: 'p-1',
    industryPrefix: 'GP-MIN',
    risksToCreate: [
      { riskType: 'silice', severity: 'high' },
      { riskType: 'ruido', severity: 'medium' },
    ],
    documentsToGenerate: ['Plan Emergencia', 'RIOHS'],
    trainingsToSchedule: ['rescate_minero'],
    baseEppToAssign: ['Casco', 'Máscara sílice'],
    regulationsToLink: ['DS 132', 'DS 594'],
    protocolsToActivate: ['PREXOR_silice'],
  },
  preset: {
    industryPrefix: 'GP-MIN',
    label: 'Minería (GP-MIN)',
    typicalRisks: ['silice', 'ruido'],
    mandatoryDocuments: ['Plan Emergencia', 'RIOHS'],
    mandatoryTrainings: ['rescate_minero'],
    baseEpp: ['Casco', 'Máscara sílice'],
    applicableRegulations: ['DS 132', 'DS 594'],
    minsalProtocols: ['PREXOR_silice'],
  },
};

beforeEach(() => {
  mockSelectedProject = null;
  listMock.mockReset();
  selectMock.mockReset();
  listMock.mockResolvedValue({
    presets: [
      { prefix: 'GP-MIN', label: 'Minería (GP-MIN)' },
      { prefix: 'GP-CONS', label: 'Construcción (GP-CONS)' },
    ],
  });
  selectMock.mockResolvedValue(SELECT_RESPONSE);
});

describe('<ProjectSetup /> page wrapper', () => {
  it('renderiza empty-state honesto cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<ProjectSetup />);
    expect(
      screen.getByTestId('project-setup-page-empty'),
    ).toBeInTheDocument();
    // No card / no wizard when there is no project.
    expect(screen.queryByTestId('industry-wizard')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('industryRules.card'),
    ).not.toBeInTheDocument();
  });

  it('monta el wizard y carga el catálogo real de presets', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    render(<ProjectSetup />);
    expect(screen.getByTestId('project-setup-page')).toBeInTheDocument();
    expect(screen.getByTestId('industry-wizard')).toBeInTheDocument();
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith('p-1');
    });
    // Options from the GET .../industry/list response render.
    expect(
      await screen.findByTestId('industry-wizard.option-GP-MIN'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('industry-wizard.option-GP-CONS'),
    ).toBeInTheDocument();
  });

  it('al aplicar el preset llama al select real y monta <IndustryPresetCard /> con la PresetApplication devuelta', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    render(<ProjectSetup />);

    // Step 1: pick GP-MIN.
    fireEvent.click(
      await screen.findByTestId('industry-wizard.option-GP-MIN'),
    );
    // The "next" button enables once a prefix is selected.
    await waitFor(() => {
      expect(screen.getByTestId('industry-wizard.next')).not.toBeDisabled();
    });
    // Step 2: go to review (triggers preview select call).
    fireEvent.click(screen.getByTestId('industry-wizard.next'));
    await waitFor(() => {
      expect(selectMock).toHaveBeenCalled();
    });
    expect(selectMock.mock.calls[0][0]).toBe('p-1');
    expect(selectMock.mock.calls[0][1]).toEqual({ industryPrefix: 'GP-MIN' });
    // Wait for the review step to settle (preview loaded → next enabled).
    await waitFor(() => {
      expect(
        screen.getByTestId('industry-wizard.step-review'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('industry-wizard.next')).not.toBeDisabled();
    });
    // Step 3: go to confirm.
    fireEvent.click(screen.getByTestId('industry-wizard.next'));
    // Apply.
    fireEvent.click(await screen.findByTestId('industry-wizard.confirm'));

    // The card mounts with REAL applied data once onApplied fires.
    const card = await screen.findByTestId('industryRules.card');
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId('project-setup-applied')).toBeInTheDocument();
    expect(screen.getByTestId('industryRules.card.title')).toHaveTextContent(
      'Minería',
    );
    expect(screen.getByTestId('industryRules.card.projectId')).toHaveTextContent(
      'p-1',
    );
    // Real risks / docs / regs from the PresetApplication.
    expect(screen.getByTestId('industryRules.card.risks').textContent).toContain(
      'silice',
    );
    expect(
      screen.getByTestId('industryRules.card.documents').textContent,
    ).toContain('RIOHS');
    expect(screen.getByTestId('industryRules.card.regs').textContent).toContain(
      'DS 132',
    );
  });
});
