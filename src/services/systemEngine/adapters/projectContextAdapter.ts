// SystemEngine — Project context adapter (placeholder).
//
// Future hook: emit a derived event when `selectedProject` changes
// (could be useful for a `project_switched` event type that policies
// like geofenceToSos use to invalidate cached zone state).

export interface ProjectAdapterOptions { tenantId: string }


export function useProjectContextAdapter(_opts: ProjectAdapterOptions): void {
  // Intentionally empty.
}
