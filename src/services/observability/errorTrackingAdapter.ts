// Praeventio Guard — Error tracking adapter shared helpers.
//
// SCAFFOLDING ONLY. Concrete adapters live in sibling files:
//   • sentryAdapter.ts             — Sentry stub (Round 2 SDK install)
//   • cloudErrorReportingAdapter.ts — GCP Error Reporting stub
//   • noopErrorTrackingAdapter.ts  — dev/CI: routes to logger
//
// The runtime selection happens in `index.ts` (`getErrorTracker()`).
// Re-exports here keep callers from having to import the typed error from
// `./types` directly.

export {
  ObservabilityNotImplementedError,
} from './types';

export type {
  Breadcrumb,
  ErrorContext,
  ErrorTrackingAdapter,
  ErrorTrackingAdapterName,
  ErrorTrackingInitOptions,
} from './types';
