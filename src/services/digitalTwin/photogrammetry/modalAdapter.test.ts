// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalAdapter, createModalAdapter } from './modalAdapter';
import type { PhotogrammetryJobInput } from './types';

const sampleInput: PhotogrammetryJobInput = {
  videoUri: 'gs://bucket/video.mp4',
  engine: 'meshroom',
  projectId: 'proj-1',
  userId: 'user-1',
  videoMeta: { durationS: 30, fileSizeBytes: 50_000_000 },
};

const baseConfig = {
  submitUrl: 'https://modal.invalid/submit',
  statusUrl: 'https://modal.invalid/status',
  cancelUrl: 'https://modal.invalid/cancel',
  token: 'test-token-123',
};

type FetchLike = typeof fetch;
type FetchMock = FetchLike & { mock: { calls: unknown[][] } };

function makeFetchMock(
  responses: Array<{ status: number; body?: unknown; text?: string }>,
): { fn: FetchMock; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let idx = 0;
  const impl = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const r = responses[Math.min(idx, responses.length - 1)];
    idx += 1;
    return new Response(
      r.text ?? (r.body !== undefined ? JSON.stringify(r.body) : ''),
      { status: r.status, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const fn = vi.fn(impl) as unknown as FetchMock;
  return { fn, calls };
}

describe('ModalAdapter', () => {
  describe('constructor + fromEnv', () => {
    it('throws if submitUrl missing', () => {
      expect(() => new ModalAdapter({ ...baseConfig, submitUrl: '' })).toThrow(/submitUrl/);
    });

    it('throws if statusUrl missing', () => {
      expect(() => new ModalAdapter({ ...baseConfig, statusUrl: '' })).toThrow(/statusUrl/);
    });

    it('throws if token missing', () => {
      expect(() => new ModalAdapter({ ...baseConfig, token: '' })).toThrow(/token/);
    });

    it('engine reports meshroom (Modal uses Meshroom internally)', () => {
      const a = new ModalAdapter(baseConfig);
      expect(a.engine).toBe('meshroom');
    });

    it('fromEnv returns null when MODAL_TOKEN missing', () => {
      const a = ModalAdapter.fromEnv({
        MODAL_SUBMIT_URL: 'x',
        MODAL_STATUS_URL: 'y',
      });
      expect(a).toBeNull();
    });

    it('fromEnv returns null when MODAL_SUBMIT_URL missing', () => {
      const a = ModalAdapter.fromEnv({ MODAL_STATUS_URL: 'y', MODAL_TOKEN: 't' });
      expect(a).toBeNull();
    });

    it('fromEnv builds adapter when all required vars present', () => {
      const a = ModalAdapter.fromEnv({
        MODAL_SUBMIT_URL: 'https://m.invalid/s',
        MODAL_STATUS_URL: 'https://m.invalid/st',
        MODAL_TOKEN: 'tok',
      });
      expect(a).not.toBeNull();
      expect(a!.engine).toBe('meshroom');
    });

    it('createModalAdapter factory returns adapter conforming to interface', () => {
      const a = createModalAdapter(baseConfig);
      expect(typeof a.submitJob).toBe('function');
      expect(typeof a.getJobStatus).toBe('function');
      expect(typeof a.cancelJob).toBe('function');
      expect(typeof a.waitForJob).toBe('function');
    });
  });

  describe('submitJob', () => {
    let mock: ReturnType<typeof makeFetchMock>;

    beforeEach(() => {
      mock = makeFetchMock([
        { status: 202, body: { jobId: 'modal-abc123', status: 'queued' } },
      ]);
    });

    it('POSTs JSON to submitUrl with Bearer token', async () => {
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      const res = await a.submitJob(sampleInput);
      expect(res.jobId).toBe('modal-abc123');
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].url).toBe(baseConfig.submitUrl);
      const init = mock.calls[0].init!;
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${baseConfig.token}`);
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(init.body as string);
      expect(body.videoUri).toBe(sampleInput.videoUri);
      expect(body.projectId).toBe(sampleInput.projectId);
      expect(body.outputFormat).toBe('glb'); // default
    });

    it('rejects when videoUri missing', async () => {
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await expect(
        a.submitJob({ ...sampleInput, videoUri: '' as unknown as string }),
      ).rejects.toThrow(/videoUri/);
      expect(mock.fn).not.toHaveBeenCalled();
    });

    it('throws on non-2xx response', async () => {
      const failing = makeFetchMock([{ status: 401, text: 'invalid token' }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: failing.fn });
      await expect(a.submitJob(sampleInput)).rejects.toThrow(/401/);
    });

    it('throws when server omits jobId', async () => {
      const odd = makeFetchMock([{ status: 200, body: { status: 'queued' } }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: odd.fn });
      await expect(a.submitJob(sampleInput)).rejects.toThrow(/jobId/);
    });

    it('respects outputFormat override', async () => {
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await a.submitJob({ ...sampleInput, outputFormat: 'gltf' });
      const body = JSON.parse(mock.calls[0].init!.body as string);
      expect(body.outputFormat).toBe('gltf');
    });
  });

  describe('getJobStatus', () => {
    it('appends jobId as query param to statusUrl', async () => {
      const mock = makeFetchMock([
        {
          status: 200,
          body: {
            jobId: 'modal-xyz',
            status: 'processing',
            createdAt: 1_000_000,
            engine: 'meshroom',
          },
        },
      ]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      const r = await a.getJobStatus('modal-xyz');
      expect(r.status).toBe('processing');
      expect(r.engine).toBe('meshroom');
      expect(mock.calls[0].url).toContain('jobId=modal-xyz');
      expect((mock.calls[0].init!.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${baseConfig.token}`,
      );
    });

    it('strips meshUri/metrics when status is not completed', async () => {
      const mock = makeFetchMock([
        {
          status: 200,
          body: {
            jobId: 'j1',
            status: 'processing',
            createdAt: 1,
            meshUri: 'gs://x/y.obj', // server shouldn't send but client must defend
            metrics: { framesExtracted: 100 },
          },
        },
      ]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      const r = await a.getJobStatus('j1');
      expect(r.meshUri).toBeUndefined();
      expect(r.metrics).toBeUndefined();
    });

    it('passes meshUri + metrics when completed', async () => {
      const mock = makeFetchMock([
        {
          status: 200,
          body: {
            jobId: 'j1',
            status: 'completed',
            createdAt: 1,
            completedAt: 2,
            meshUri: 'gs://b/mesh.obj',
            meshFormat: 'obj',
            meshSizeBytes: 12345,
            metrics: { framesExtracted: 60, processingDurationS: 180 },
          },
        },
      ]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      const r = await a.getJobStatus('j1');
      expect(r.status).toBe('completed');
      expect(r.meshUri).toBe('gs://b/mesh.obj');
      expect(r.meshFormat).toBe('obj');
      expect(r.metrics?.framesExtracted).toBe(60);
    });

    it('throws not-found error on 404', async () => {
      const mock = makeFetchMock([{ status: 404, text: 'no such job' }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await expect(a.getJobStatus('ghost')).rejects.toThrow(/not found/);
    });

    it('throws on 500 with body detail', async () => {
      const mock = makeFetchMock([{ status: 500, text: 'meshroom crashed' }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await expect(a.getJobStatus('j2')).rejects.toThrow(/500/);
    });

    it('coerces unknown status into "queued" defensively', async () => {
      const mock = makeFetchMock([
        { status: 200, body: { jobId: 'j', status: 'something-weird', createdAt: 1 } },
      ]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      const r = await a.getJobStatus('j');
      expect(r.status).toBe('queued');
    });

    it('rejects empty jobId', async () => {
      const a = new ModalAdapter({ ...baseConfig });
      await expect(a.getJobStatus('')).rejects.toThrow(/jobId/);
    });
  });

  describe('cancelJob', () => {
    it('POSTs jobId to cancelUrl', async () => {
      const mock = makeFetchMock([{ status: 200, body: { status: 'cancelled' } }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await a.cancelJob('modal-c');
      expect(mock.calls[0].url).toBe(baseConfig.cancelUrl);
      const body = JSON.parse(mock.calls[0].init!.body as string);
      expect(body.jobId).toBe('modal-c');
    });

    it('is no-op when cancelUrl unconfigured', async () => {
      const mock = makeFetchMock([{ status: 200, body: {} }]);
      const a = new ModalAdapter({
        submitUrl: baseConfig.submitUrl,
        statusUrl: baseConfig.statusUrl,
        token: baseConfig.token,
        fetchImpl: mock.fn,
      });
      await expect(a.cancelJob('j')).resolves.toBeUndefined();
      expect(mock.fn).not.toHaveBeenCalled();
    });

    it('treats 404 as no-op', async () => {
      const mock = makeFetchMock([{ status: 404 }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await expect(a.cancelJob('gone')).resolves.toBeUndefined();
    });

    it('throws on 500', async () => {
      const mock = makeFetchMock([{ status: 500, text: 'oops' }]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn });
      await expect(a.cancelJob('j')).rejects.toThrow(/500/);
    });
  });

  describe('waitForJob', () => {
    it('returns once status reaches completed', async () => {
      const mock = makeFetchMock([
        { status: 200, body: { jobId: 'j', status: 'queued', createdAt: 1 } },
        { status: 200, body: { jobId: 'j', status: 'processing', createdAt: 1 } },
        {
          status: 200,
          body: {
            jobId: 'j',
            status: 'completed',
            createdAt: 1,
            completedAt: 5,
            meshUri: 'gs://x/m.obj',
            meshFormat: 'obj',
          },
        },
      ]);
      const a = new ModalAdapter({
        ...baseConfig,
        fetchImpl: mock.fn,
        pollIntervalMs: 1,
      });
      const r = await a.waitForJob('j', 5000);
      expect(r.status).toBe('completed');
      expect(r.meshUri).toBe('gs://x/m.obj');
      expect(mock.fn).toHaveBeenCalledTimes(3);
    });

    it('returns on failed without further polls', async () => {
      const mock = makeFetchMock([
        {
          status: 200,
          body: {
            jobId: 'j',
            status: 'failed',
            createdAt: 1,
            completedAt: 2,
            errorMessage: 'no mesh produced',
          },
        },
      ]);
      const a = new ModalAdapter({ ...baseConfig, fetchImpl: mock.fn, pollIntervalMs: 1 });
      const r = await a.waitForJob('j', 1000);
      expect(r.status).toBe('failed');
      expect(r.errorMessage).toBe('no mesh produced');
      expect(mock.fn).toHaveBeenCalledTimes(1);
    });

    it('times out when status stays processing', async () => {
      const mock = makeFetchMock([
        { status: 200, body: { jobId: 'j', status: 'processing', createdAt: 1 } },
      ]);
      // Simulated clock advances by huge step on each call so the loop exits after
      // a single poll instead of waiting real time.
      let t = 0;
      const a = new ModalAdapter({
        ...baseConfig,
        fetchImpl: mock.fn,
        pollIntervalMs: 1,
        clock: () => {
          t += 100_000;
          return t;
        },
      });
      await expect(a.waitForJob('j', 50)).rejects.toThrow(/timed out/);
    });

    it('keeps polling through transient errors and surfaces last on timeout', async () => {
      const mock = makeFetchMock([
        { status: 500, text: 'transient' },
        { status: 500, text: 'transient again' },
      ]);
      let t = 0;
      const a = new ModalAdapter({
        ...baseConfig,
        fetchImpl: mock.fn,
        pollIntervalMs: 1,
        clock: () => {
          t += 100_000;
          return t;
        },
      });
      await expect(a.waitForJob('j', 50)).rejects.toThrow(/timed out|last error/);
    });
  });
});
