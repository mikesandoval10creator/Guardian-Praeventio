// SPDX-License-Identifier: MIT
//
// Mock photogrammetry adapter — para tests + desarrollo offline.
//
// Simula el ciclo queued → processing → completed con timing
// configurable. Útil porque:
//   - No requiere internet ni Cloud Storage real.
//   - Permite escribir tests deterministas sin docker/Meshroom.
//   - Sirve como fallback cuando el cloud-side está caído.
//
// IMPORTANTE: NO usar en producción. El método `submitJob` no procesa
// nada — solo agenda timers internos. Para producción real wire al
// adapter Meshroom (Cloud Run worker pool con MPL2 license, ver
// SPRINT_20_SPEC.md Brecha C).

import type {
  PhotogrammetryAdapter,
  PhotogrammetryJobInput,
  PhotogrammetryJobResult,
  PhotogrammetryJobStatus,
} from './types';

interface MockTimings {
  /** Cuánto tiempo "queued" antes de procesar (ms). Default 50. */
  queuedDelayMs: number;
  /** Cuánto tiempo "processing" antes de completar (ms). Default 100. */
  processingDelayMs: number;
  /** Probabilidad de que el job termine en 'failed' (0-1). Default 0. */
  failureRate: number;
  /** URL fija que se devuelve como meshUri cuando completed. */
  meshUri: string;
}

const DEFAULT_TIMINGS: MockTimings = {
  queuedDelayMs: 50,
  processingDelayMs: 100,
  failureRate: 0,
  meshUri: 'https://example.invalid/mock-mesh.glb',
};

interface MockJobState extends PhotogrammetryJobResult {
  /** Tiempo (ms epoch) en que pasa de queued → processing. */
  startProcessingAt: number;
  /** Tiempo (ms epoch) en que pasa de processing → completed/failed. */
  completeAt: number;
}

export class MockPhotogrammetryAdapter implements PhotogrammetryAdapter {
  readonly engine = 'mock' as const;
  private readonly jobs: Map<string, MockJobState> = new Map();
  private readonly timings: MockTimings;
  private nextJobIdCounter = 0;

  constructor(timingsOverride: Partial<MockTimings> = {}) {
    this.timings = { ...DEFAULT_TIMINGS, ...timingsOverride };
  }

  /** Generate a deterministic-ish job id. */
  private nextJobId(): string {
    this.nextJobIdCounter += 1;
    return `mock-job-${Date.now()}-${this.nextJobIdCounter}`;
  }

  async submitJob(input: PhotogrammetryJobInput): Promise<{ jobId: string }> {
    const jobId = this.nextJobId();
    const now = Date.now();
    const willFail = Math.random() < this.timings.failureRate;
    const state: MockJobState = {
      jobId,
      status: 'queued',
      createdAt: now,
      engine: 'mock',
      startProcessingAt: now + this.timings.queuedDelayMs,
      completeAt: now + this.timings.queuedDelayMs + this.timings.processingDelayMs,
      meshUri: undefined,
      meshFormat: input.outputFormat ?? 'glb',
      errorMessage: willFail ? 'Mock failure injected by failureRate' : undefined,
      meshSizeBytes: willFail ? undefined : 2_500_000, // ~2.5 MB plausible
      metrics: willFail
        ? undefined
        : {
            framesExtracted: 300,
            featuresMatched: 25_000,
            pointsReconstructed: 80_000,
            trianglesGenerated: 50_000,
            processingDurationS: this.timings.processingDelayMs / 1000,
          },
    };
    this.jobs.set(jobId, state);
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<PhotogrammetryJobResult> {
    const state = this.jobs.get(jobId);
    if (!state) {
      throw new Error(`MockPhotogrammetryAdapter: job ${jobId} not found`);
    }
    const now = Date.now();
    let status: PhotogrammetryJobStatus = state.status;
    if (status === 'queued' && now >= state.startProcessingAt) {
      status = 'processing';
    }
    if (status === 'processing' && now >= state.completeAt) {
      status = state.errorMessage ? 'failed' : 'completed';
    }
    if (status === 'completed') {
      state.meshUri = state.meshUri ?? this.timings.meshUri;
    }
    state.status = status;
    if (status === 'completed' || status === 'failed') {
      state.completedAt = state.completedAt ?? now;
    }
    // Return a defensive copy so callers can't mutate our internal state.
    return {
      jobId: state.jobId,
      status: state.status,
      createdAt: state.createdAt,
      completedAt: state.completedAt,
      meshUri: state.status === 'completed' ? state.meshUri : undefined,
      meshFormat: state.meshFormat,
      meshSizeBytes: state.status === 'completed' ? state.meshSizeBytes : undefined,
      errorMessage: state.status === 'failed' ? state.errorMessage : undefined,
      engine: state.engine,
      metrics: state.status === 'completed' ? state.metrics : undefined,
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    const state = this.jobs.get(jobId);
    if (!state) return; // no-op for unknown jobs
    if (state.status === 'completed' || state.status === 'failed') return; // immutable
    state.status = 'cancelled';
    state.completedAt = Date.now();
  }

  async waitForJob(jobId: string, timeoutMs: number = 5000): Promise<PhotogrammetryJobResult> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.getJobStatus(jobId);
      if (
        result.status === 'completed' ||
        result.status === 'failed' ||
        result.status === 'cancelled'
      ) {
        return result;
      }
      // Poll every 25 ms — fine for mock; production adapter overrides.
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `MockPhotogrammetryAdapter: waitForJob timed out after ${timeoutMs}ms for job ${jobId}`,
    );
  }

  /** Test-only: cuántos jobs están vivos en memoria. */
  __getJobCount(): number {
    return this.jobs.size;
  }

  /** Test-only: limpia el storage interno. */
  __reset(): void {
    this.jobs.clear();
    this.nextJobIdCounter = 0;
  }
}

/** Factory para uso en development por default. */
export function createMockPhotogrammetryAdapter(
  timings: Partial<MockTimings> = {},
): PhotogrammetryAdapter {
  return new MockPhotogrammetryAdapter(timings);
}
