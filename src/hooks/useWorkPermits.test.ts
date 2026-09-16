import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/firebase', () => ({
  auth: { currentUser: null },
}));

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import { createWorkPermit, signWorkPermit } from './useWorkPermits';

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const validCreate = {
  id: 'wp-1',
  kind: 'altura' as const,
  taskDescription: 'Cambio de luminaria en plataforma.',
  durationHours: 8,
};

describe('useWorkPermits mutators — human API errors', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns a 409 duplicate permit code into an actionable Spanish message', async () => {
    fetchMock.mockResolvedValueOnce(
      response(409, { error: 'permit_id_duplicate', permitId: 'wp-1' }),
    );

    await expect(createWorkPermit('project-1', validCreate)).rejects.toThrow(
      /permiso.*ya existe|revisa.*permiso/i,
    );
  });

  it('preserves a human server reason for a 400 validation error', async () => {
    fetchMock.mockResolvedValueOnce(
      response(400, {
        error: 'validation_error',
        message: 'La duración debe ser mayor que cero.',
      }),
    );

    await expect(signWorkPermit('project-1', 'wp-1')).rejects.toThrow(
      'La duración debe ser mayor que cero.',
    );
  });
});
