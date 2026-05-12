// SystemEngine — Sensor context adapter (placeholder).
//
// SensorContext today exposes raw sensor frames (acceleration, rotation,
// orientation). Fall detection is implemented inside FallDetectionMonitor
// via useAccelerometer + a 25 m/s² threshold and ALREADY escalates to
// triggerEmergency('fall', projectId) directly (Sprint 27 H6 fix). The
// adapter therefore has no automatic emit duty for fall events: the
// EmergencyContext adapter will already pick up the sos_triggered event
// when triggerEmergency runs.
//
// What this adapter does: nothing automatic for now. It exists so that
// SystemEngineProvider has a single mount point per critical context, and
// so future fall-detection refactors that bypass EmergencyContext can be
// wired here without restructuring the provider.

export interface SensorAdapterOptions {
  tenantId: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useSensorContextAdapter(_opts: SensorAdapterOptions): void {
  // intentionally empty — see file header
}
