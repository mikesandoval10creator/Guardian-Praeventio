// Praeventio Guard — GCP Cloud Error Reporting adapter (STUB INTENCIONAL).
//
// Cloud Error Reporting is GCP's native error aggregation service. It groups
// stack traces into "error events", auto-detects regressions, and integrates
// with Cloud Monitoring alerts. Free tier covers most apps and there is no
// per-event cost — a strong default for GCP-resident workloads like Praeventio
// (Cloud Run / Firestore / KMS already on GCP).
//
// **Status:** STUB intencional — el adapter productivo es `sentryAdapter`.
// La presencia de este adapter es opcional como path de migración futuro
// si el stack se mueve a GCP-only observability. Plan v2 K9 (2026-05-26):
// **decisión = DEFER** (mantener stub, no duplicar con Sentry). Si en
// algún sprint posterior se decide migrar:
//   1. `npm install @google-cloud/error-reporting`
//   2. Grant the Cloud Run service account the
//      `roles/errorreporting.writer` role.
//   3. Replace `init()` body with `new ErrorReporting({ projectId, ... })`.
//   4. Replace `captureException` with `errors.report(error)`.
//   5. (Optional) `errors.express` middleware for Express.
//
// Availability check: requires `GCP_PROJECT_ID` so the SDK knows where to
// send events. ADC (Application Default Credentials) provide the auth.

import {
  ObservabilityNotImplementedError,
  type Breadcrumb,
  type ErrorContext,
  type ErrorTrackingAdapter,
  type ErrorTrackingInitOptions,
} from './types';

const CER_INSTALL = 'npm install @google-cloud/error-reporting';

class CloudErrorReportingAdapter implements ErrorTrackingAdapter {
  readonly name = 'cloud-error-reporting' as const;
  readonly isAvailable: boolean;

  constructor() {
    // Cloud Error Reporting needs to know which project to write to. ADC
    // covers auth, but project ID must be explicit so a misconfigured dev
    // env can't silently leak events to a wrong project.
    this.isAvailable = Boolean(process.env.GCP_PROJECT_ID);
  }

  init(_options: ErrorTrackingInitOptions): void {
    throw new ObservabilityNotImplementedError('CloudErrorReporting', CER_INSTALL);
  }

  captureException(_error: Error, _context?: ErrorContext): string {
    throw new ObservabilityNotImplementedError('CloudErrorReporting', CER_INSTALL);
  }

  captureMessage(
    _message: string,
    _level: 'info' | 'warning' | 'error',
    _context?: ErrorContext,
  ): string {
    throw new ObservabilityNotImplementedError('CloudErrorReporting', CER_INSTALL);
  }

  /**
   * Cloud Error Reporting doesn't natively model breadcrumbs (it's events-
   * only) so once the real SDK lands we'll forward these to Cloud Logging
   * with a structured `breadcrumb` field — the Logs Explorer view is
   * passable as a breadcrumb trail. For now this is a noop.
   */
  addBreadcrumb(_breadcrumb: Breadcrumb): void {
    /* noop until SDK is installed — see CER_INSTALL */
  }

  setUserContext(_userId: string, _additionalProps?: Record<string, unknown>): void {
    /* noop until SDK is installed — see CER_INSTALL */
  }

  async flush(_timeout?: number): Promise<void> {
    /* noop until SDK is installed */
  }
}

export const cloudErrorReportingAdapter: ErrorTrackingAdapter =
  new CloudErrorReportingAdapter();
