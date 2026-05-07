// SystemEngine — UniversalKnowledge context adapter (placeholder).
//
// UniversalKnowledgeContext polls EONET / weather every 15 min. Future
// hook: emit `weather_alert` and `seismic_event` when its polled state
// crosses configured thresholds (wind > 30, mag > 4.5, etc.). Today the
// useAutonomousAlerts hook already does this client-side via direct
// addNotification — once those rules are migrated to policies (commit
// from C, or follow-up), this adapter will drive them.

export interface UniversalKnowledgeAdapterOptions { tenantId: string }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useUniversalKnowledgeContextAdapter(_opts: UniversalKnowledgeAdapterOptions): void {
  // Intentionally empty.
}
