// Praeventio Guard — [P1][VIDA] Jerarquía de atención calmada.
//
// Calm Technology (Amber Case / Xerox PARC) applied to life-safety pushes:
// the notification channel must reserve its highest urgency for the
// momentary set of events that actually saves a life. If the app borrows
// "priority:high + sound.critical" for routine reminders, the worker
// learns to ignore the channel — and the one SOS that arrives inside the
// noise gets dismissed the same way.
//
// Three severity tiers, all derived from the dispatch caller's intent:
//
//   - vital:    SOS, manDown, evacuation, gas, brigade dispatch. Full
//               sound.critical + Apns 10 + Android IMPORTANCE_HIGH +
//               dedicated `praeventio_emergency` channel. Breaks Do-Not-
//               Disturb. Reserved for events where non-delivery equals
//               death or serious injury.
//   - important: PPE expiration, signature due, overdue compliance. Heads-
//               up notification, normal priority, default channel. The
//               user can let it sit in the tray; if they never see it,
//               the workflow still proceeds (audit + next cron tick).
//   - ambient:  XP, progress, training nudges. In-app surface only. The
//               push adapter is NEVER invoked for these: the notification
//               context (NotificationContext.tsx) renders them inside the
//               app shell. This module treats `ambient` as a guard value
//               that adapter senders must reject.
//
// The helpers here are pure and total: any string-derived severity is
// coerced into the closed enum so the adapter cannot accidentally emit
// a malformed payload. Defaults are `vital` (the historical safe value)
// so existing call sites that pre-date the tier system keep their
// behaviour without code changes.
//
// SPEC: Ticket 3a4aa66d-73fe-8146-bbbf-e38632cdd4d6
// SPEC: Amber Case, "Calm Technology" (Xerox PARC, 2015).
//
// Anti-pattern: returning `silent: true` for ambient (push but no sound)
// is NOT a fix here. The real fix is "do not push at all". Notification
// Context owns the in-app ambient surface.

/** Closed severity tier. */
export type NotificationSeverity = "vital" | "important" | "ambient";

/** Closed set of notification kinds. Closed so adding a new vital kind
 *  is a deliberate code review, not a string typo. */
export type NotificationKind =
  // vital
  | "sos"
  | "manDown"
  | "evacuation"
  | "gas_alert"
  | "brigade_activation"
  | "resilience_health_critical"
  // important
  | "ppe_expiration"
  | "signature_due"
  | "overdue_compliance"
  | "lone_worker_overdue"
  | "suseso_deadline"
  // ambient
  | "xp_progress"
  | "training_nudge"
  | "system_tip";

/** Map a kind to its severity. `unknown` is a closed third state that
 *  adapter callers must handle explicitly (default `vital` until the
 *  caller audits). */
const KIND_TO_SEVERITY: Readonly<
  Record<NotificationKind, NotificationSeverity>
> = {
  sos: "vital",
  manDown: "vital",
  evacuation: "vital",
  gas_alert: "vital",
  brigade_activation: "vital",
  resilience_health_critical: "vital",
  ppe_expiration: "important",
  signature_due: "important",
  overdue_compliance: "important",
  lone_worker_overdue: "important",
  suseso_deadline: "important",
  xp_progress: "ambient",
  training_nudge: "ambient",
  system_tip: "ambient",
};

/** Resolve the severity for a kind. Unknown kinds default to `vital`
 *  to preserve the historical safe behaviour: alarms that don't know
 *  themselves still ring loud. Callers that care must use the
 *  `explicitSeverity` overload. */
export function inferSeverity(kind: NotificationKind): NotificationSeverity;
export function inferSeverity(
  kind: NotificationKind,
  explicit: NotificationSeverity,
): NotificationSeverity;
export function inferSeverity(
  kind: NotificationKind,
  explicit?: NotificationSeverity,
): NotificationSeverity {
  if (explicit !== undefined) return explicit;
  return KIND_TO_SEVERITY[kind] ?? "vital";
}

/**
 * Android FCM priority. `priority: 'high'` is required for the JS API
 * to wake Doze-mode on real devices but is the bare minimum of the
 * heads-up + sound delivery; the channel importance drives the rest.
 *
 *   - vital:    `high` (FCM) + `IMPORTANCE_HIGH` (channel-side, set in
 *               the OS via the channel config — not derivable here).
 *   - important: `high` (FCM) — heads-up without sound; the rationale
 *               is "you'd be happier ignoring this, but if you do not,
 *               audit + cron cover the slip".
 *   - ambient:  `normal` (FCM).
 *
 * Note: FCM has no separate "no-sound" channel-side; the sound is bound
 * to the channel's `IMPORTANCE` and the per-channel `sound` field. The
 * `praeventio_emergency` channel is the dedicated vital channel; we
 * recommend the default channel for important and another in-app
 * notification surface for ambient.
 */
export function severityToAndroidPriority(
  severity: NotificationSeverity,
): "high" | "normal" {
  return severity === "ambient" ? "normal" : "high";
}

/**
 * APNs `apns-priority` header. Per Apple docs:
 *   - 10: deliver immediately (used for time-critical alerts).
 *   - 5: deliver with power-aware considerations (default).
 *
 * iOS critical alerts (`sound.critical`) require entitlements; this
 * module does not assert that entitlement exists — the caller's
 * build environment + provisioning decides. The priority header is
 * independent of the critical-sound entitlement.
 */
export function severityToApnsPriority(
  severity: NotificationSeverity,
): "10" | "5" {
  return severity === "vital" ? "10" : "5";
}

/** Android notification channel id. The channel itself must exist
 *  on-device: `praeventio_emergency` is created by
 *  `criticalNotificationChannel.ts`; the default channel is created
 *  by Capacitor. The caller wires the channel into the platform
 *  notification record. */
export function severityToChannelId(severity: NotificationSeverity): string {
  switch (severity) {
    case "vital":
      return "praeventio_emergency";
    case "important":
      return "praeventio_default";
    case "ambient":
      // Ambient is IN-APP only. If a caller ever asks for the channel
      // id for ambient, it's a regression they should fail to ignore.
      return "praeventio_default";
  }
}

/** Whether iOS should request critical-alerts sound. Critical alerts
 *  require the `com.apple.developer.usernotifications.critical-alerts`
 *  entitlement; without it the request is rejected and the
 *  notification falls through to default sound. We keep the helper
 *  here so the boolean is co-located with the rest of the severity
 *  decision and easily audited. */
export function severityToCriticalSound(
  severity: NotificationSeverity,
): boolean {
  return severity === "vital";
}

/** Whether the push adapter should be invoked at all. `ambient` is
 *  rejected at the gate so the adapter never sends a silent push.
 *  This is the Calm Tech guard: routine content never wakes the
 *  device. */
export function severityShouldPush(severity: NotificationSeverity): boolean {
  return severity !== "ambient";
}

/** Defensive default: closed set guard. Returns true IFF the input
 *  is one of the three closed severity values. */
export function isNotificationSeverity(
  value: unknown,
): value is NotificationSeverity {
  return value === "vital" || value === "important" || value === "ambient";
}
