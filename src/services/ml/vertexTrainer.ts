// SPDX-License-Identifier: MIT
// Sprint 32 Bucket VV — Vertex AI custom training scaffold.
//
// This module is a STUB intentionally. Vertex AutoML Tabular training jobs
// cost real money (USD per node-hour) and we don't want a CI run, a unit
// test, or a developer accidentally typing `npm run train` to spin one up.
//
// To activate the real Vertex pipeline you need BOTH of these env vars set:
//   • VERTEX_TRAINING_ENABLED=true
//   • BIGQUERY_TRAINING_DATASET=<gcp project>.<dataset>.<table>
// plus the same VERTEX_PROJECT_ID + VERTEX_LOCATION used by `vertexAdapter`.
//
// When wiring the real version (Sprint 33+) replace `runStubbedTraining`
// with a `@google-cloud/aiplatform` `JobServiceClient.createCustomJob`
// call, pulling the source rows from the BigQuery dataset listed above.
// Until then this stub returns a deterministic-shape response so the
// dashboard, the API endpoint, and the audit trail can be built and
// tested end-to-end without burning Vertex budget.

/**
 * Inputs for `trainFailureProbabilityModel`. `tenantId` is used as the
 * BigQuery row filter and as the model display-name prefix.
 */
export interface TrainFailureProbabilityInput {
  tenantId: string;
  /** IoT device class — narrows the training corpus. */
  deviceKind: string;
  /** How many days of historical telemetry to include. 30..365. */
  daysOfHistory: number;
}

export type VertexTrainingStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface VertexTrainingJobResult {
  jobId: string;
  /** Stable ID — same shape Vertex uses, but mocked. */
  mockedModelId: string;
  status: VertexTrainingStatus;
  note: string;
  /** ISO-8601 timestamp the job was queued at. */
  queuedAt: string;
  /** Echoed back so the dashboard can show provenance. */
  input: TrainFailureProbabilityInput;
}

/** Class of errors thrown by `trainFailureProbabilityModel`. */
export class VertexTrainerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_INPUT'
      | 'NOT_ENABLED'
      | 'BIGQUERY_NOT_CONFIGURED'
      | 'UPSTREAM',
  ) {
    super(message);
    this.name = 'VertexTrainerError';
  }
}

/**
 * Validate the input shape. Centralised so the API endpoint and the
 * dashboard get identical error messages.
 */
function validateInput(input: TrainFailureProbabilityInput): void {
  if (!input.tenantId || typeof input.tenantId !== 'string') {
    throw new VertexTrainerError(
      'vertexTrainer: tenantId is required',
      'INVALID_INPUT',
    );
  }
  if (!input.deviceKind || typeof input.deviceKind !== 'string') {
    throw new VertexTrainerError(
      'vertexTrainer: deviceKind is required',
      'INVALID_INPUT',
    );
  }
  if (
    !Number.isFinite(input.daysOfHistory) ||
    input.daysOfHistory < 30 ||
    input.daysOfHistory > 365
  ) {
    throw new VertexTrainerError(
      'vertexTrainer: daysOfHistory must be between 30 and 365',
      'INVALID_INPUT',
    );
  }
}

/**
 * Adapter-style availability flag. The dashboard reads this to decide
 * whether to show the "Run real training" button.
 */
export function isVertexTrainingAvailable(): boolean {
  return (
    process.env.VERTEX_TRAINING_ENABLED === 'true' &&
    Boolean(process.env.BIGQUERY_TRAINING_DATASET) &&
    Boolean(process.env.VERTEX_PROJECT_ID)
  );
}

/**
 * Stub training entry point. Returns a queued-shape response without
 * issuing any GCP calls. ALL test and dev runs land here; the real
 * pipeline only kicks in when the env flags above are set.
 */
export async function trainFailureProbabilityModel(
  input: TrainFailureProbabilityInput,
): Promise<VertexTrainingJobResult> {
  validateInput(input);

  // ───────────────────────────────────────────────────────────────────
  // REAL-PIPELINE GUARD.
  // When you flip VERTEX_TRAINING_ENABLED=true you MUST also implement
  // the real branch below. For now we throw so a misconfigured deploy
  // (env flag flipped but code not wired) fails loud instead of silently
  // returning a fake jobId.
  // ───────────────────────────────────────────────────────────────────
  if (process.env.VERTEX_TRAINING_ENABLED === 'true') {
    if (!process.env.BIGQUERY_TRAINING_DATASET) {
      throw new VertexTrainerError(
        'vertexTrainer: VERTEX_TRAINING_ENABLED=true requires BIGQUERY_TRAINING_DATASET',
        'BIGQUERY_NOT_CONFIGURED',
      );
    }
    // TODO Sprint 33: replace this throw with the real
    // `@google-cloud/aiplatform` JobServiceClient.createCustomJob call.
    throw new VertexTrainerError(
      'vertexTrainer: real Vertex training not yet implemented; remove ' +
        'VERTEX_TRAINING_ENABLED until Sprint 33 ships the real pipeline.',
      'NOT_ENABLED',
    );
  }

  // Stub branch — deterministic-shape response.
  const queuedAt = new Date().toISOString();
  const slug = `${input.tenantId}-${input.deviceKind}-${input.daysOfHistory}d`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  const jobId = `vertex-train-stub-${slug}-${Date.now()}`;
  const mockedModelId = `mock-failure-prob-${slug}`;
  return {
    jobId,
    mockedModelId,
    status: 'queued',
    note:
      'Vertex training stub — wire real cuando VERTEX_PROJECT_ID + ' +
      'BIGQUERY_TRAINING_DATASET + VERTEX_TRAINING_ENABLED estén listos ' +
      'y el budget esté aprobado.',
    queuedAt,
    input,
  };
}
