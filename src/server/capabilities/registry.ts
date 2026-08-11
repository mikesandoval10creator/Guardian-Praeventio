export const CAPABILITY_STATUSES = [
  "implemented",
  "configured",
  "healthy",
  "degraded",
  "experimental",
  "unavailable",
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export interface CapabilityCheck {
  ok: boolean;
  latencyMs: number;
  skipped?: boolean;
  error?: string;
}

export interface CapabilityEntry {
  id: string;
  label: string;
  status: CapabilityStatus;
  evidence?: {
    check: string;
    latencyMs: number;
    skipped?: true;
  };
}

interface CapabilityDefinition {
  id: string;
  label: string;
  check: string;
  skippedStatus?: CapabilityStatus;
}

const DEFINITIONS: readonly CapabilityDefinition[] = [
  { id: "platform.firestore", label: "Firestore", check: "firestore" },
  { id: "platform.kms", label: "KMS", check: "kms" },
  { id: "ai.gemini", label: "Gemini AI", check: "gemini" },
  { id: "integration.resend", label: "Resend email", check: "resend" },
  { id: "integration.open-meteo", label: "Open-Meteo", check: "openMeteo" },
  {
    id: "ai.photogrammetry",
    label: "Photogrammetry worker",
    check: "photogrammetry",
    skippedStatus: "experimental",
  },
  { id: "notifications.fcm", label: "Firebase Cloud Messaging", check: "fcm" },
  { id: "platform.scheduler", label: "Scheduler", check: "scheduler" },
  { id: "integration.mqtt", label: "MQTT", check: "mqtt" },
  { id: "safety.mesh", label: "Safety mesh", check: "mesh" },
  { id: "offline.outbox", label: "Offline outbox", check: "offline" },
  { id: "safety.geofence", label: "Geofence", check: "geofence" },
  { id: "safety.man-down", label: "Man down", check: "manDown" },
  { id: "health.wearables", label: "Wearables", check: "wearables" },
  {
    id: "ai.offline-slm",
    label: "Offline SLM",
    check: "slm",
    skippedStatus: "experimental",
  },
];

function toEvidence(
  checkName: string,
  check: CapabilityCheck,
): CapabilityEntry["evidence"] {
  return {
    check: checkName,
    latencyMs: check.latencyMs,
    ...(check.skipped ? { skipped: true as const } : {}),
  };
}

export function buildCapabilityRegistry(
  checks: Readonly<Record<string, CapabilityCheck>>,
): CapabilityEntry[] {
  return DEFINITIONS.map((definition) => {
    const check = checks[definition.check];
    if (!check) {
      return {
        id: definition.id,
        label: definition.label,
        status: "unavailable",
      };
    }

    return {
      id: definition.id,
      label: definition.label,
      status: !check.ok
        ? "degraded"
        : check.skipped
          ? (definition.skippedStatus ?? "configured")
          : "healthy",
      evidence: toEvidence(definition.check, check),
    };
  });
}
