// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndustrySelectorWizard } from './IndustrySelectorWizard';
import type { SelectIndustryResponse } from '../../hooks/useIndustryRules';
vi.mock('../../lib/apiAuth', () => ({ apiAuthHeaders: async () => ({}) }));
const catalog = { presets: [{ prefix: 'GP-MIN', label: 'Minería' }] };
const result: SelectIndustryResponse = {
  application: { projectId: 'a', industryPrefix: 'GP-MIN', risksToCreate: [], documentsToGenerate: [], trainingsToSchedule: [], baseEppToAssign: [], regulationsToLink: [], protocolsToActivate: [] },
  preset: { industryPrefix: 'GP-MIN', label: 'Minería', typicalRisks: [], mandatoryDocuments: [], mandatoryTrainings: [], baseEpp: [], applicableRegulations: [], minsalProtocols: [] },
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function enterReview() {
  fireEvent.click(await screen.findByTestId('industry-wizard.option-GP-MIN'));
  fireEvent.click(screen.getByTestId('industry-wizard.next'));
}

describe('industry wizard request ownership', () => {
  it('cancels its catalog request on unmount', async () => {
    let signal: AbortSignal | undefined;
    const list = vi.fn(async (_id: string, s?: AbortSignal) => { signal = s; return catalog; });
    const view = render(<IndustrySelectorWizard projectId="a" listFn={list} />);
    await screen.findByTestId('industry-wizard.option-GP-MIN');
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('cancels an in-flight preview when going back', async () => {
    let signal: AbortSignal | undefined;
    let release!: (value: SelectIndustryResponse) => void;
    const pending = new Promise<SelectIndustryResponse>((resolve) => { release = resolve; });
    const select = vi.fn((_id: string, _input: unknown, _key?: string, s?: AbortSignal) => { signal = s; return pending; });
    const view = render(<IndustrySelectorWizard projectId="a" listFn={async () => catalog} selectFn={select} />);
    await enterReview();
    await waitFor(() => expect(select).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('industry-wizard.back'));
    await act(async () => { release(result); });
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('industry-wizard.step-review')).toBeNull();
    view.unmount();
  });

  it('invalidates an old submission and resets the wizard on project change', async () => {
    let release!: (value: SelectIndustryResponse) => void;
    const pending = new Promise<SelectIndustryResponse>((resolve) => { release = resolve; });
    const list = vi.fn(async () => catalog);
    const select = vi.fn().mockResolvedValueOnce(result).mockReturnValueOnce(pending);
    const onApplied = vi.fn();
    const view = render(<IndustrySelectorWizard projectId="a" listFn={list} selectFn={select} onApplied={onApplied} />);
    await enterReview();
    await waitFor(() => expect(screen.getByTestId('industry-wizard.next')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('industry-wizard.next'));
    fireEvent.click(screen.getByTestId('industry-wizard.confirm'));
    await waitFor(() => expect(select).toHaveBeenCalledTimes(2));
    view.rerender(<IndustrySelectorWizard projectId="b" listFn={list} selectFn={select} onApplied={onApplied} />);
    await act(async () => { release(result); });
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByTestId('industry-wizard.step-select')).toBeTruthy();
    expect(select.mock.calls[1][3]?.aborted).toBe(true);
  });

  it('stops a hung catalog spinner after the deadline and exposes retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<IndustrySelectorWizard projectId="a" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByTestId('industry-wizard.list-loading')).toBeNull();
    expect(screen.getByText(/demoró demasiado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar catálogo' })).toBeTruthy();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(catalog), { status: 200 }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reintentar catálogo' })); });
    expect(screen.getByTestId('industry-wizard.option-GP-MIN')).toBeTruthy();
    expect(screen.queryByTestId('industry-wizard.list-error')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not claim a timed-out submission succeeded or automatically repeat it', async () => {
    const select = vi.fn().mockResolvedValueOnce(result).mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    const onApplied = vi.fn();
    render(<IndustrySelectorWizard projectId="a" listFn={async () => catalog} selectFn={select} onApplied={onApplied} />);
    await enterReview();
    await waitFor(() => expect(screen.getByTestId('industry-wizard.next')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('industry-wizard.next'));
    fireEvent.click(screen.getByTestId('industry-wizard.confirm'));
    expect(await screen.findByText(/No se confirmó la aplicación/)).toBeTruthy();
    expect(onApplied).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('industry-wizard.confirm')).not.toBeDisabled();
  });
});
