// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { MockPhotogrammetryAdapter, createMockPhotogrammetryAdapter } from './mockAdapter';
import type { PhotogrammetryJobInput } from './types';

const sampleInput: PhotogrammetryJobInput = {
  videoUri: 'gs://bucket/video.mp4',
  engine: 'mock',
  projectId: 'proj-1',
  userId: 'user-1',
  videoMeta: { durationS: 30, fileSizeBytes: 50_000_000 },
};

describe('MockPhotogrammetryAdapter', () => {
  let adapter: MockPhotogrammetryAdapter;

  beforeEach(() => {
    adapter = new MockPhotogrammetryAdapter({
      queuedDelayMs: 5,
      processingDelayMs: 10,
    });
  });

  it('submitJob returns a unique jobId', async () => {
    const a = await adapter.submitJob(sampleInput);
    const b = await adapter.submitJob(sampleInput);
    expect(a.jobId).toBeTruthy();
    expect(b.jobId).toBeTruthy();
    expect(a.jobId).not.toBe(b.jobId);
  });

  it('getJobStatus returns queued initially', async () => {
    const slow = new MockPhotogrammetryAdapter({ queuedDelayMs: 1000, processingDelayMs: 0 });
    const { jobId } = await slow.submitJob(sampleInput);
    const status = await slow.getJobStatus(jobId);
    expect(status.status).toBe('queued');
    expect(status.engine).toBe('mock');
    expect(status.meshUri).toBeUndefined();
  });

  it('progresses queued → processing → completed', async () => {
    const { jobId } = await adapter.submitJob(sampleInput);
    const final = await adapter.waitForJob(jobId, 1000);
    expect(final.status).toBe('completed');
    expect(final.meshUri).toBeTruthy();
    expect(final.meshFormat).toBe('glb');
    expect(final.metrics).toBeDefined();
    expect(final.metrics?.framesExtracted).toBeGreaterThan(0);
    expect(final.completedAt).toBeGreaterThanOrEqual(final.createdAt);
  });

  it('respects outputFormat input', async () => {
    const { jobId } = await adapter.submitJob({ ...sampleInput, outputFormat: 'gltf' });
    const final = await adapter.waitForJob(jobId, 1000);
    expect(final.meshFormat).toBe('gltf');
  });

  it('failureRate=1 always returns failed', async () => {
    const failing = new MockPhotogrammetryAdapter({
      queuedDelayMs: 1,
      processingDelayMs: 1,
      failureRate: 1,
    });
    const { jobId } = await failing.submitJob(sampleInput);
    const final = await failing.waitForJob(jobId, 1000);
    expect(final.status).toBe('failed');
    expect(final.errorMessage).toBeTruthy();
    expect(final.meshUri).toBeUndefined();
  });

  it('cancelJob transitions to cancelled', async () => {
    const slow = new MockPhotogrammetryAdapter({ queuedDelayMs: 5000, processingDelayMs: 0 });
    const { jobId } = await slow.submitJob(sampleInput);
    await slow.cancelJob(jobId);
    const after = await slow.getJobStatus(jobId);
    expect(after.status).toBe('cancelled');
  });

  it('cancelJob is no-op on completed jobs', async () => {
    const { jobId } = await adapter.submitJob(sampleInput);
    await adapter.waitForJob(jobId, 1000);
    await adapter.cancelJob(jobId);
    const after = await adapter.getJobStatus(jobId);
    expect(after.status).toBe('completed');
  });

  it('cancelJob on unknown jobId is no-op (does not throw)', async () => {
    await expect(adapter.cancelJob('does-not-exist')).resolves.toBeUndefined();
  });

  it('getJobStatus throws for unknown jobId', async () => {
    await expect(adapter.getJobStatus('does-not-exist')).rejects.toThrow(/not found/);
  });

  it('waitForJob times out when configured short', async () => {
    const slow = new MockPhotogrammetryAdapter({ queuedDelayMs: 5000, processingDelayMs: 0 });
    const { jobId } = await slow.submitJob(sampleInput);
    await expect(slow.waitForJob(jobId, 100)).rejects.toThrow(/timed out/);
  });

  it('factory createMockPhotogrammetryAdapter returns working adapter', async () => {
    const factory = createMockPhotogrammetryAdapter({ queuedDelayMs: 1, processingDelayMs: 1 });
    expect(factory.engine).toBe('mock');
    const { jobId } = await factory.submitJob(sampleInput);
    const final = await factory.waitForJob(jobId, 1000);
    expect(final.status).toBe('completed');
  });

  it('__reset clears internal state', async () => {
    await adapter.submitJob(sampleInput);
    await adapter.submitJob(sampleInput);
    expect(adapter.__getJobCount()).toBe(2);
    adapter.__reset();
    expect(adapter.__getJobCount()).toBe(0);
  });
});
