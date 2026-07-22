export type HealthVerificationStatus = 'pending' | 'provisional' | 'verified';
export type HealthAccessChannel = 'qr' | 'directory';
export type HealthAccessDurationBucket = 'under_1h' | '1_to_24h' | '1_to_7d';
export type HealthAccessOutcomeCode =
  | 'success'
  | 'cancelled'
  | 'not_eligible'
  | 'webauthn_failed'
  | 'expired'
  | 'revoked'
  | 'service_unavailable';

export interface HealthAnalyticsProperties {
  country?: 'CL';
  verification_status?: HealthVerificationStatus;
  channel?: HealthAccessChannel;
  duration_bucket?: HealthAccessDurationBucket;
  outcome_code?: HealthAccessOutcomeCode;
}

const VERIFICATION_STATUSES = new Set<HealthVerificationStatus>([
  'pending',
  'provisional',
  'verified',
]);
const CHANNELS = new Set<HealthAccessChannel>(['qr', 'directory']);
const DURATION_BUCKETS = new Set<HealthAccessDurationBucket>([
  'under_1h',
  '1_to_24h',
  '1_to_7d',
]);
const OUTCOME_CODES = new Set<HealthAccessOutcomeCode>([
  'success',
  'cancelled',
  'not_eligible',
  'webauthn_failed',
  'expired',
  'revoked',
  'service_unavailable',
]);

/**
 * Runtime privacy boundary for the Health Vault funnel. Unknown keys and
 * free-form values are discarded, so clinical context and identifiers never
 * reach an analytics sink even when a caller passes an unsafe object.
 */
export function buildHealthAnalyticsProperties(
  input: Record<string, unknown>,
): HealthAnalyticsProperties {
  const output: HealthAnalyticsProperties = {};
  if (input.country === 'CL') output.country = 'CL';
  if (VERIFICATION_STATUSES.has(input.verification_status as HealthVerificationStatus)) {
    output.verification_status = input.verification_status as HealthVerificationStatus;
  }
  if (CHANNELS.has(input.channel as HealthAccessChannel)) {
    output.channel = input.channel as HealthAccessChannel;
  }
  if (DURATION_BUCKETS.has(input.duration_bucket as HealthAccessDurationBucket)) {
    output.duration_bucket = input.duration_bucket as HealthAccessDurationBucket;
  }
  if (OUTCOME_CODES.has(input.outcome_code as HealthAccessOutcomeCode)) {
    output.outcome_code = input.outcome_code as HealthAccessOutcomeCode;
  }
  return output;
}

export function bucketHealthAccessDuration(durationMs: number): HealthAccessDurationBucket {
  if (durationMs < 60 * 60 * 1000) return 'under_1h';
  if (durationMs <= 24 * 60 * 60 * 1000) return '1_to_24h';
  return '1_to_7d';
}
