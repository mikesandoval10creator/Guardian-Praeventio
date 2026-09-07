// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  collection: vi.fn(() => ({ path: 'wisdomCapsules' })),
  where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
  limit: vi.fn((value: number) => ({ limit: value })),
  query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
  getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: H.collection,
  where: H.where,
  limit: H.limit,
  query: H.query,
  getDocs: H.getDocs,
}));

vi.mock('../services/firebase', () => ({ db: { name: 'test-db' } }));

import { useWisdomCapsules } from './useWisdomCapsules';

const validDoc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  data: () => ({
    tenantId: 'tenant-a',
    projectId: 'project-a',
    title: 'Uso seguro',
    content: 'Verifica el equipo antes de operar.',
    lat: -33.45,
    lng: -70.66,
    radius: 50,
    ...over,
  }),
});

describe('useWisdomCapsules project/tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.getDocs.mockResolvedValue({ docs: [validDoc('capsule-a')] });
  });

  it('fails closed and performs no read without both tenant and project', async () => {
    const { result } = renderHook(() =>
      useWisdomCapsules({ projectId: null, tenantId: null }),
    );

    await waitFor(() => expect(result.current.capsules).toEqual([]));
    expect(H.getDocs).not.toHaveBeenCalled();
  });

  it('queries by tenant and project with a bounded result and filters malformed docs', async () => {
    H.getDocs.mockResolvedValue({
      docs: [
        validDoc('capsule-a'),
        validDoc('wrong-tenant', { tenantId: 'tenant-b' }),
        validDoc('bad-coordinates', { lat: Number.NaN }),
        validDoc('oversized', { content: 'x'.repeat(10_001) }),
      ],
    });

    const { result } = renderHook(() =>
      useWisdomCapsules({ projectId: 'project-a', tenantId: 'tenant-a' }),
    );

    await waitFor(() => expect(result.current.capsules).toHaveLength(1));
    expect(result.current.capsules[0]?.id).toBe('capsule-a');
    expect(H.collection).toHaveBeenCalledWith(expect.anything(), 'wisdomCapsules');
    expect(H.where).toHaveBeenCalledWith('tenantId', '==', 'tenant-a');
    expect(H.where).toHaveBeenCalledWith('projectId', '==', 'project-a');
    expect(H.limit).toHaveBeenCalledWith(100);
    expect(H.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ field: 'tenantId', value: 'tenant-a' }),
      expect.objectContaining({ field: 'projectId', value: 'project-a' }),
      { limit: 100 },
    );
  });

  it('clears a prior scoped result when scope disappears', async () => {
    const { result, rerender } = renderHook(
      ({ projectId, tenantId }: { projectId: string | null; tenantId: string | null }) =>
        useWisdomCapsules({ projectId, tenantId }),
      { initialProps: { projectId: 'project-a', tenantId: 'tenant-a' } as { projectId: string | null; tenantId: string | null } },
    );

    await waitFor(() => expect(result.current.capsules).toHaveLength(1));
    rerender({ projectId: null, tenantId: null });
    await waitFor(() => expect(result.current.capsules).toEqual([]));
    expect(H.getDocs).toHaveBeenCalledTimes(1);
  });
});
