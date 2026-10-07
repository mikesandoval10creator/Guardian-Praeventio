import { describe, expect, it, vi } from 'vitest';
import { clearFirestoreProject } from './firestoreEmulatorClear';

const url = 'http://127.0.0.1:8080/emulator/v1/projects/test-project/databases/(default)/documents';

describe('clearFirestoreProject', () => {
  it('retries a transient emulator conflict before succeeding', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(new Response('active transaction', { status: 409 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await expect(clearFirestoreProject(url, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed with the emulator response after bounded conflict retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('active transaction', { status: 409, statusText: 'Conflict' }),
    );

    await expect(clearFirestoreProject(url, fetcher)).rejects.toThrow(
      '409 Conflict: active transaction',
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-conflict error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('bad project', { status: 404, statusText: 'Not Found' }),
    );

    await expect(clearFirestoreProject(url, fetcher)).rejects.toThrow('404 Not Found');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
