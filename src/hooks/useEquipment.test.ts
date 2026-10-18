// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
vi.mock('../services/firebase', () => ({ auth: null }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: async () => 'Bearer test-token' }));
import { useEquipment } from './useEquipment';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ equipment: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => cleanup());
  vi.unstubAllGlobals();
});

describe('useEquipment inventory filters', () => {
  it.each([
    [undefined, '/api/sprint-k/p1/equipment'],
    ['all', '/api/sprint-k/p1/equipment?status=all'],
    ['fuera_servicio', '/api/sprint-k/p1/equipment?status=fuera_servicio'],
  ] as const)('sends the explicit filter %s while preserving the default', async (status, path) => {
    const { result } = renderHook(() => useEquipment('p1', { status }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }));
  });

  it('does not query an inventory without a selected project', () => {
    const { result } = renderHook(() => useEquipment(null, { status: 'all' }));
    expect(result.current.data).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
