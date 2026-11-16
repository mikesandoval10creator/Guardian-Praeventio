// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndustrySelectorWizard } from './IndustrySelectorWizard';
import { getIndustryPreset, buildPresetApplication, listIndustryPresets } from '../../services/industryRules/industryRuleEngine';
vi.mock('../../lib/apiAuth', () => ({ apiAuthHeaders: async () => ({}) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const result = () => ({ preset: getIndustryPreset('GP-MIN'), application: buildPresetApplication('project-a', 'GP-MIN') });
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
async function review() {
  fireEvent.click(await screen.findByTestId('industry-wizard.option-GP-MIN'));
  fireEvent.click(screen.getByTestId('industry-wizard.next'));
}
describe('industry wizard real response decoder', () => {
  it('shows a readable error for an incomplete preset instead of empty safety requirements', async () => {
    const payload = result();
    const { baseEpp: _missing, ...incomplete } = payload.preset;
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ presets: listIndustryPresets() }))
      .mockResolvedValueOnce(reply({ ...payload, preset: incomplete }));
    vi.stubGlobal('fetch', fetchMock);
    const onApplied = vi.fn();
    render(<IndustrySelectorWizard projectId="project-a" onApplied={onApplied} />);
    await review();
    const message = await screen.findByTestId('industry-wizard.preview-error');
    expect(message.textContent).toMatch(/incompleta o no es válida/);
    expect(message.textContent).toMatch(/intenta nuevamente/i);
    expect(message.textContent).not.toMatch(/industry_response_invalid|http_200/);
    expect(screen.getByTestId('industry-wizard.next')).toBeDisabled();
    expect(screen.queryByTestId('industry-wizard.applied-banner')).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
  });
  it('does not call onApplied when the final application payload is malformed', async () => {
    const payload = result();
    const { baseEppToAssign: _missing, ...incomplete } = payload.application;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({ presets: listIndustryPresets() }))
      .mockResolvedValueOnce(reply(payload)).mockResolvedValueOnce(reply({ ...payload, application: incomplete })));
    const onApplied = vi.fn();
    render(<IndustrySelectorWizard projectId="project-a" onApplied={onApplied} />);
    await review();
    await waitFor(() => expect(screen.getByTestId('industry-wizard.next')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('industry-wizard.next'));
    fireEvent.click(screen.getByTestId('industry-wizard.confirm'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/incompleta o no es válida/);
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByTestId('industry-wizard.applied-banner')).toBeNull();
  });
  it('preserves the valid producer DTO through the real client and wizard callback', async () => {
    const payload = result();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({ presets: listIndustryPresets() }))
      .mockResolvedValueOnce(reply(payload)).mockResolvedValueOnce(reply(payload)));
    const onApplied = vi.fn();
    render(<IndustrySelectorWizard projectId="project-a" onApplied={onApplied} />);
    await review();
    await waitFor(() => expect(screen.getByTestId('industry-wizard.next')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('industry-wizard.next'));
    fireEvent.click(screen.getByTestId('industry-wizard.confirm'));
    await screen.findByTestId('industry-wizard.applied-banner');
    expect(onApplied).toHaveBeenCalledWith(payload);
  });
  it.each([404, 409, 500])('keeps HTTP %i as an error rather than an empty valid list', async (status) => {
    const response = reply({ message: 'No se pudo cargar el catálogo. Intenta nuevamente.' }, status);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    render(<IndustrySelectorWizard projectId="project-a" />);
    const message = await screen.findByTestId('industry-wizard.list-error');
    expect(response.status).toBe(status);
    expect(message.textContent).toMatch(/intenta nuevamente/i);
    expect(message.textContent).not.toMatch(/http_|404|409|500/);
    expect(screen.queryByTestId('industry-wizard.option-GP-MIN')).toBeNull();
  });
});
