// SystemEngine — AppMode context adapter (placeholder).
//
// Future hook: emit a derived event when `mode` transitions
// (normal → driving → emergency). Could feed a `mode_changed` event type
// useful for analytics and for policies that want to gate decisions by
// the app mode (e.g. suppress non-emergency notifications during
// driving).

export interface AppModeAdapterOptions { tenantId: string }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useAppModeContextAdapter(_opts: AppModeAdapterOptions): void {
  // Intentionally empty.
}
