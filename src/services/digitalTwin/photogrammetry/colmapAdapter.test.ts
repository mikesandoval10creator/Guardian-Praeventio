// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ColmapAdapter } from './colmapAdapter';
import type { PhotogrammetryJobInput } from './types';

const sampleInput: PhotogrammetryJobInput = {
  videoUri: 'gs://bucket/path/video.mp4',
  engine: 'colmap',
  projectId: 'proj-1',
  userId: 'user-1',
  videoMeta: { durationS: 30, fileSizeBytes: 50_000_000 },
};

/** Helper to build a minimal Response-like value the adapter expects. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body ?? ''),
  } as unknown as Response;
}

function textResponse(text: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

describe('ColmapAdapter.fromEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when env vars are missing', () => {
    delete process.env.PHOTOGRAMMETRY_WORKER_URL;
    delete process.env.PHOTOGRAMMETRY_WORKER_TOKEN;
    expect(ColmapAdapter.fromEnv()).toBeNull();
  });

  it('returns null when only the URL is set', () => {
    process.env.PHOTOGRAMMETRY_WORKER_URL = 'https://example.invalid';
    delete process.env.PHOTOGRAMMETRY_WORKER_TOKEN;
    expect(ColmapAdapter.fromEnv()).toBeNull();
  });

  it('returns null when only the token is set', () => {
    delete process.env.PHOTOGRAMMETRY_WORKER_URL;
    process.env.PHOTOGRAMMETRY_WORKER_TOKEN = 'tok';
    expect(ColmapAdapter.fromEnv()).toBeNull();
  });

  it('returns an adapter when both env vars are set', () => {
    process.env.PHOTOGRAMMETRY_WORKER_URL = 'https://example.invalid';
    process.env.PHOTOGRAMMETRY_WORKER_TOKEN = 'tok';
    const adapter = ColmapAdapter.fromEnv();
    expect(adapter).not.toBeNull();
    expect(adapter?.engine).toBe('colmap');
  });
});

describe('ColmapAdapter HTTP behavior', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let adapter: ColmapAdapter;

  beforeEach(() => {
    fetchMock = vi.fn();
    adapter = new ColmapAdapter({
      workerUrl: 'https://worker.invalid/',
      token: 'super-secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
      pollIntervalMs: 5,
    });
  });

  it('submitJob POSTs to /jobs with bearer token + project payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobId: 'colmap-abc' }, 202));
    const result = await adapter.submitJob(sampleInput);
    expect(result.jobId).toBe('colmap-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://worker.invalid/jobs'); // trailing slash trimmed
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer super-secret');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ videoUri: sampleInput.videoUri, projectId: sampleInput.projectId });
  });

  it('submitJob throws when worker returns 4xx', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('bad token', 401));
    await expect(adapter.submitJob(sampleInput)).rejects.toThrow(/401/);
  });

  it('submitJob throws when worker returns 5xx', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('boom', 500));
    await expect(adapter.submitJob(sampleInput)).rejects.toThrow(/500/);
  });

  it('submitJob throws when response body is missing jobId', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 202));
    await expect(adapter.submitJob(sampleInput)).rejects.toThrow(/missing jobId/);
  });

  it('getJobStatus maps worker response to PhotogrammetryJobResult', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        jobId: 'colmap-abc',
        status: 'completed',
        createdAt: 1_000_000,
        completedAt: 1_600_000,
        meshUri: 'https://signed.example/glb',
        errorMessage: null,
      }),
    );
    const result = await adapter.getJobStatus('colmap-abc');
    expect(result.jobId).toBe('colmap-abc');
    expect(result.status).toBe('completed');
    expect(result.createdAt).toBe(1_000_000);
    expect(result.completedAt).toBe(1_600_000);
    expect(result.meshUri).toBe('https://signed.example/glb');
    expect(result.meshFormat).toBe('glb');
    expect(result.errorMessage).toBeUndefined();
    expect(result.engine).toBe('colmap');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://worker.invalid/jobs/colmap-abc');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer super-secret');
  });

  it('getJobStatus surfaces failed status with errorMessage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        jobId: 'colmap-abc',
        status: 'failed',
        createdAt: 1_000_000,
        completedAt: 1_300_000,
        meshUri: null,
        errorMessage: 'sparse reconstruction failed',
      }),
    );
    const result = await adapter.getJobStatus('colmap-abc');
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('sparse reconstruction failed');
    expect(result.meshUri).toBeUndefined();
  });

  it('getJobStatus throws on worker 5xx', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('oops', 502));
    await expect(adapter.getJobStatus('colmap-abc')).rejects.toThrow(/502/);
  });

  it('cancelJob POSTs /jobs/{id}/cancel and accepts 204', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('', 204));
    await adapter.cancelJob('colmap-abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://worker.invalid/jobs/colmap-abc/cancel');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer super-secret');
  });

  it('cancelJob is no-op when worker returns 404', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('not found', 404));
    await expect(adapter.cancelJob('missing')).resolves.toBeUndefined();
  });

  it('cancelJob throws on non-404 errors', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('forbidden', 403));
    await expect(adapter.cancelJob('colmap-abc')).rejects.toThrow(/403/);
  });

  it('waitForJob polls until status is terminal', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          jobId: 'j',
          status: 'queued',
          createdAt: 1,
          completedAt: null,
          meshUri: null,
          errorMessage: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jobId: 'j',
          status: 'processing',
          createdAt: 1,
          completedAt: null,
          meshUri: null,
          errorMessage: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jobId: 'j',
          status: 'completed',
          createdAt: 1,
          completedAt: 100,
          meshUri: 'https://signed.example/glb',
          errorMessage: null,
        }),
      );
    const result = await adapter.waitForJob('j', 5_000);
    expect(result.status).toBe('completed');
    expect(result.meshUri).toBe('https://signed.example/glb');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('waitForJob throws on timeout', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        jobId: 'j',
        status: 'processing',
        createdAt: 1,
        completedAt: null,
        meshUri: null,
        errorMessage: null,
      }),
    );
    await expect(adapter.waitForJob('j', 30)).rejects.toThrow(/timed out/);
  });
});

describe('ColmapAdapter constructor validation', () => {
  it('throws without workerUrl', () => {
    expect(
      () =>
        new ColmapAdapter({
          workerUrl: '',
          token: 't',
          fetchImpl: vi.fn() as unknown as typeof fetch,
        }),
    ).toThrow(/workerUrl/);
  });

  it('throws without token', () => {
    expect(
      () =>
        new ColmapAdapter({
          workerUrl: 'https://x.invalid',
          token: '',
          fetchImpl: vi.fn() as unknown as typeof fetch,
        }),
    ).toThrow(/token/);
  });
});
