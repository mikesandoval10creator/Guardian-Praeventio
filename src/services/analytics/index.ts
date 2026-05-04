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
  BootKind,
  CacheOrigin,
  CheckinKind,
  CheckinStatus,
  CommonProperties,
  DetectorKind,
  DocKind,
  EmergencyCheckinCompletedProperties,
  Event,
  EventInputProps,
  EventName,
  EventPropertiesMap,
  IndustryCode,
  InviteChannel,
  KnowledgeDocViewedProperties,
  KnowledgeZkLinkTraversedProperties,
  KnowledgeZkNodeCreatedProperties,
  PaymentCheckoutCancelledProperties,
  PaymentCheckoutStartedProperties,
  PaymentGateway,
  PaymentTransactionFailedProperties,
  PaymentTransactionSucceededProperties,
  ProcesoCreatedProperties,
  ProcesoTemplate,
  ProjectArchivedProperties,
  ProjectCreatedProperties,
  ProjectMemberInvitedProperties,
  ProjectTier,
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
  SusesoFormKind,
  SusesoFormSubmittedProperties,
  TareaCompletedProperties,
  TareaEscalatedProperties,
  TareaEscalationKind,
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
