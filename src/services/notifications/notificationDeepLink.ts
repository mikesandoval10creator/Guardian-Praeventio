// Praeventio Guard — notification deep-link contract.
//
// [P1][VIDA] "Tocar una notificacion critica no abre la emergencia (sin
// notificationclick/deep link)". A worker who taps a critical push must land
// on the exact emergency/alert it refers to — not a dead notification, not the
// wrong project's screen.
//
// This is the SINGLE SOURCE OF TRUTH for that mapping. It is consumed by:
//   • the native hook (src/hooks/usePushNotifications.ts) — dispatches the
//     `praeventio:deep-link` CustomEvent that <DeepLinkHandler> navigates on.
//   • the web service worker (public/firebase-messaging-sw.js) — which cannot
//     import TS/ESM, so it inlines the SAME contract; keep the two in sync
//     (a drift-guard test pins the SW copy against this module).
//
// The `data` map is exactly what the server sends via FCM (string→string,
// FCM rejects non-string values). Verified producers (file:line):
//   • SOS:       { projectId, alertId, type: 'sos', uid }   emergency.ts:325
//   • Emergency: { projectId, emergencyType, timestamp }    emergency.ts:504
//   • Critical incident: { projectId, nodeId }              backgroundTriggers.ts:309
//     (nodeId is a `nodes` doc — the incident node IncidentBundle is keyed by)
//
// Route targets are the screens that actually CONSUME each id:
//   • SOS / emergency  → /emergencia-avanzada (subscribes to
//     tenants/{tid}/emergency_alerts + emergency_events; EmergenciaAvanzada.tsx).
//     NOT /emergency — that page is a planning dashboard that reads no alertId.
//   • incident node    → /incidents/{nodeId}/bundle (IncidentBundle.tsx keys its
//     bundle + photo-evidence queries off this id).

export interface ResolvedNotificationLink {
  /**
   * In-app RELATIVE path + query (e.g. `/emergency?alertId=…&source=push`).
   * Always relative — never a scheme/host — so it can't be abused as an
   * open-redirect and is safe to hand straight to React Router `navigate()`.
   */
  url: string;
  /**
   * The project the notification pertains to, if any. The handler carries it
   * in the query so the target screen can detect a mismatch with the active
   * project and realign (or fall back safely) instead of silently showing the
   * wrong project's emergency.
   */
  projectId: string | null;
}

/** Where we send a notification we can't route to a specific target. Must be a
 *  real, always-available in-app screen so the tap is never a no-op. */
const SAFE_FALLBACK_PATH = '/notifications';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Build `path?...` with a deterministic key order and proper encoding. Keys
 *  whose value is null/empty are omitted. */
function withQuery(path: string, params: Array<[string, string | null]>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of params) {
    if (value) qs.append(key, value);
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Map an FCM `data` payload to the in-app deep link to open when the user taps
 * the notification. Pure, total (never throws), and returns a safe fallback for
 * any unknown or malformed input.
 */
export function resolveNotificationDeepLink(
  data: Record<string, string> | undefined | null,
): ResolvedNotificationLink {
  if (!data || typeof data !== 'object') {
    return { url: withQuery(SAFE_FALLBACK_PATH, [['source', 'push']]), projectId: null };
  }

  const projectId = str(data.projectId);
  const source: [string, string | null] = ['source', 'push'];
  const project: [string, string | null] = ['projectId', projectId];

  // SOS — the highest-severity alert. `type === 'sos'` or a bare `alertId`.
  const alertId = str(data.alertId);
  if (data.type === 'sos' || alertId) {
    return {
      url: withQuery('/emergencia-avanzada', [['alertId', alertId], project, source]),
      projectId,
    };
  }

  // Automatic emergency (climate / geofence / hazmat zone) — carries a type
  // but no per-alert document id. Same dashboard as SOS.
  const emergencyType = str(data.emergencyType);
  if (emergencyType) {
    return {
      url: withQuery('/emergencia-avanzada', [['emergencyType', emergencyType], project, source]),
      projectId,
    };
  }

  // Critical-incident notification — open that incident node's evidence bundle.
  // The server sends `nodeId` (a `nodes` doc); `incidentId` is accepted as a
  // forward-compatible alias. IncidentBundle keys its queries off this id.
  const incidentId = str(data.nodeId) ?? str(data.incidentId);
  if (incidentId) {
    return {
      url: withQuery(`/incidents/${encodeURIComponent(incidentId)}/bundle`, [project, source]),
      projectId,
    };
  }

  // Anything else (soft notifications, knowledge nodes, future types) routes to
  // the notifications inbox — safe, never a no-op, never the wrong emergency.
  return {
    url: withQuery(SAFE_FALLBACK_PATH, [project, source]),
    projectId,
  };
}
