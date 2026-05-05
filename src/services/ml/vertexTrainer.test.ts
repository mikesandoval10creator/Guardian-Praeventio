// SPDX-License-Identifier: MIT
// Sprint 32 Bucket VV — vertexTrainer stub tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  trainFailureProbabilityModel,
  isVertexTrainingAvailable,
  VertexTrainerError,
} from './vertexTrainer.js';

const ORIGINAL_ENV = { ...process.env };

describe('vertexTrainer (Sprint 32 VV stub)', () => {
  beforeEach(() => {
    delete process.env.VERTEX_TRAINING_ENABLED;
    delete process.env.BIGQUERY_TRAINING_DATASET;
    delete process.env.VERTEX_PROJECT_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns a queued mocked job with the documented shape', async () => {
    const result = await trainFailureProbabilityModel({
      tenantId: 'tenant-a',
      deviceKind: 'wearable',
      daysOfHistory: 90,
    });
    expect(result.status).toBe('queued');
    expect(result.jobId).toMatch(/^vertex-train-stub-/);
    expect(result.mockedModelId).toBe('mock-failure-prob-tenant-a-wearable-90d');
    expect(result.note).toMatch(/stub/i);
    expect(typeof result.queuedAt).toBe('string');
    // ISO-8601-ish.
    expect(Number.isFinite(Date.parse(result.queuedAt))).toBe(true);
    expect(result.input.tenantId).toBe('tenant-a');
  });

  it('rejects invalid daysOfHistory with INVALID_INPUT', async () => {
    await expect(
      trainFailureProbabilityModel({
        tenantId: 'tenant-a',
        deviceKind: 'wearable',
        daysOfHistory: 5,
      }),
    ).rejects.toMatchObject({
      name: 'VertexTrainerError',
      code: 'INVALID_INPUT',
    });
  });

  it('rejects when real-pipeline flag is on but BigQuery dataset is missing', async () => {
    process.env.VERTEX_TRAINING_ENABLED = 'true';
    // BIGQUERY_TRAINING_DATASET intentionally NOT set.
    let caught: unknown;
    try {
      await trainFailureProbabilityModel({
        tenantId: 'tenant-a',
        deviceKind: 'wearable',
        daysOfHistory: 90,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VertexTrainerError);
    expect((caught as VertexTrainerError).code).toBe('BIGQUERY_NOT_CONFIGURED');
  });

  it('isVertexTrainingAvailable reflects env flags', () => {
    expect(isVertexTrainingAvailable()).toBe(false);
    process.env.VERTEX_TRAINING_ENABLED = 'true';
    process.env.BIGQUERY_TRAINING_DATASET = 'p.d.t';
    process.env.VERTEX_PROJECT_ID = 'praeventio-prod';
    expect(isVertexTrainingAvailable()).toBe(true);
  });
});
