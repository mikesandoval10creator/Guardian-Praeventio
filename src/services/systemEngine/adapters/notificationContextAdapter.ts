// SystemEngine — Notification context adapter (placeholder).
//
// Future hook: when a notification is added with severity=error or
// type=error, mirror it as `audit_log_appended` so it lands in the bus
// trail for cross-tenant analytics. For now no automatic emit — the
// adapter mounts a stable subscription point.

export interface NotificationAdapterOptions { tenantId: string }


export function useNotificationContextAdapter(_opts: NotificationAdapterOptions): void {
  // Intentionally empty — documented hook above.
}
