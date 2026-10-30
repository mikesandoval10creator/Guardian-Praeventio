import { describe, expect, it, vi } from 'vitest';
import { readPublicLawCandidates } from './publicLawReader.js';
import type { Firestore } from 'firebase-admin/firestore';

describe('public law read-only Firestore boundary', () => {
  it('queries only law document IDs, projects out embeddings, and caps reads', async () => {
    const get = vi.fn(async () => ({ docs: [{ id: 'law-1234-chunk-0', data: () => ({ lawId: '1234', title: 'fixture', content: 'ruido' }) }] }));
    const q = { orderBy: vi.fn(), startAt: vi.fn(), endAt: vi.fn(), select: vi.fn(), limit: vi.fn(), get };
    for (const method of [q.orderBy, q.startAt, q.endAt, q.select, q.limit]) method.mockReturnValue(q);
    const collection = vi.fn(() => q);
    const rows = await readPublicLawCandidates(9999, { collection } as unknown as Firestore);
    expect(collection).toHaveBeenCalledWith('vector_store');
    expect(q.startAt).toHaveBeenCalledWith('law-'); expect(q.endAt).toHaveBeenCalledWith('law-\uf8ff');
    expect(q.limit).toHaveBeenCalledWith(201);
    expect(q.select.mock.calls[0]).not.toContain('embedding');
    expect(q.select.mock.calls[0]).toContain('projectId');
    expect(rows[0].id).toBe('law-1234-chunk-0');
  });
});
