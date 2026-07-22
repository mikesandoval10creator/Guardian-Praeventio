/**
 * Analytics — public barrel (ninth wave, Bucket D).
 *
 * Re-exports the adapter, sinks, queue, and types so call sites import
 * from `services/analytics` rather than reaching into individual files.
 *
 * The default singleton `analytics` is constructed here with the
 * sentry-breadcrumb sink (prod default until a real backend is picked,
 * see TRACKING_PLAN §9) plus the console sink (visible in dev). Tests
 * that need to assert on emitted events should construct their own
 * `AnalyticsAdapter` with a sink stub — see `adapter.test.ts`.
 *
 * Runtime boundary (15th wave, Bucket D): server code MUST import
 * `serverAnalytics` directly from `./serverAdapter` (or via the
 * re-export below) rather than the browser `analytics` singleton. The
 * browser singleton imports `idb` (IndexedDB wrapper) at module load and
 * reads `localStorage` / `navigator` from `defaultGetCommonProps`, so
 * reaching it from a Node runtime would either crash at boot or pull
 * useless browser shims into the server bundle. The server adapter
 * mirrors the same `track` / `flush` surface but uses Node primitives
 * only (stdout JSON sink + Sentry breadcrumb sink + in-memory bounded
 * queue).
 */

import { AnalyticsAdapter } from './adapter';
import { defaultAnalyticsQueue } from './queue';
import { consoleSink, sentryBreadcrumbSink } from './sinks';

export { AnalyticsAdapter, userIdHash } from './adapter';
export type { AnalyticsAdapterOptions } from './adapter';
export {
  defaultAnalyticsQueue,
  __resetAnalyticsQueueForTests,
} from './queue';
export type { AnalyticsQueue, QueuedAnalyticsEvent } from './queue';
export { consoleSink, noopSink, sentryBreadcrumbSink } from './sinks';
export { bucketHealthAccessDuration, buildHealthAnalyticsProperties } from './healthPrivacy';
export type {
  HealthAccessChannel,
  HealthAccessDurationBucket,
  HealthAccessOutcomeCode,
  HealthAnalyticsProperties,
  HealthVerificationStatus,
} from './healthPrivacy';
export {
  createInMemoryAnalyticsQueue,
  createServerAnalytics,
  serverAnalytics,
  serverSentryBreadcrumbSink,
  stdoutJsonSink,
} from './serverAdapter';
export type {
  QueuedAnalyticsEventInMemory,
  ServerAnalytics,
  ServerAnalyticsOptions,
  ServerAnalyticsQueue,
} from './serverAdapter';
export type {
  AppBackgroundedProperties,
  AppModeName,
  AppModeSwitchedProperties,
  AppModeTriggerKind,
  AppOpenedProperties,
  ArchiveReason,
  AuthProvider,
  AuthRoleGrantedProperties,
  AuthRoleRevokedProperties,
  AuthUserSignedInProperties,
  AuthUserSignedOutProperties,
  AuthUserSignedUpProperties,
  BlockReasonCode,
  BootKind,
  CacheOrigin,
  CheckinKind,
  CheckinStatus,
  ComiteActionItemAssignedProperties,
  ComiteMeetingScheduledProperties,
  ComiteMinutesDraftedProperties,
  CommonProperties,
  CuadrillaCreatedProperties,
  CuadrillaMemberAddedProperties,
  CuadrillaMemberSwappedProperties,
  DetectorKind,
  DocKind,
  DraftedByKind,
  EmergencyCheckinCompletedProperties,
  EmergencyEvacuationStartedProperties,
  EmergencyFallDetectedProperties,
  EmergencySosTriggeredProperties,
  Event,
  EventInputProps,
  EventName,
  EventPropertiesMap,
  HealthProfessionalOnboardingProperties,
  HealthProfessionalVerificationProperties,
  HealthShareFunnelProperties,
  IndustryCode,
  InviteChannel,
  KnowledgeDocViewedProperties,
  KnowledgeZkLinkTraversedProperties,
  KnowledgeZkNodeCreatedProperties,
  NetworkKind,
  PaymentCheckoutCancelledProperties,
  PaymentCheckoutStartedProperties,
  PaymentGateway,
  PaymentTransactionFailedProperties,
  PaymentTransactionSucceededProperties,
  ProcesoCreatedProperties,
  ProcesoTemplate,
  ProjectArchivedProperties,
  ProjectCreatedProperties,
  ProjectMemberAcceptedProperties,
  ProjectMemberInvitedProperties,
  ProjectMemberRemovedProperties,
  ProjectTier,
  RemovalReason,
  ResolutionKind,
  RevocationReason,
  RiskClass,
  RiskDetectedPredictiveProperties,
  RiskReportedManualProperties,
  RiskResolvedProperties,
  Role,
  Severity,
  SignoutReason,
  Sink,
  SlmModelDownloadedProperties,
  SlmQueryKind,
  SlmQueryOfflineProperties,
  SlmQueryOnlineProperties,
  SlmQueueGrewProperties,
  SlmQueueReconciledProperties,
  SosType,
  SusesoFormKind,
  SusesoFormRejectedProperties,
  SusesoFormStartedProperties,
  SusesoFormSubmittedProperties,
  SwapReason,
  TareaBlockedProperties,
  TareaCompletedProperties,
  TareaCreatedProperties,
  TareaEscalatedProperties,
  TareaEscalationKind,
  TaskPriority,
  TriggerSource,
  ZkLinkKind,
  ZkNodeKind,
} from './types';

/**
 * Default singleton used by app code. The sink list here is the
 * "vendor-neutral, no real backend yet" combination from TRACKING_PLAN
 * §9: events show up in the dev console AND as Sentry breadcrumbs in
 * prod, with zero net cost beyond an existing Sentry breadcrumb buffer.
 *
 * Swap to a real backend by replacing this list with `[postHogSink]`
 * (or whichever vendor wins the deferred decision).
 */
export const analytics = new AnalyticsAdapter({
  sinks: [consoleSink, sentryBreadcrumbSink],
  queue: defaultAnalyticsQueue,
});
