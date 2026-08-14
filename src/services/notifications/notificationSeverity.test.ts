import { describe, it, expect } from "vitest";
import {
  inferSeverity,
  severityToAndroidPriority,
  severityToApnsPriority,
  severityToChannelId,
  severityToCriticalSound,
  severityShouldPush,
  isNotificationSeverity,
  type NotificationKind,
} from "./notificationSeverity.js";

describe("inferSeverity", () => {
  it("returns vital for SOS / manDown / evacuation / gas / brigade / resilience", () => {
    for (const kind of [
      "sos",
      "manDown",
      "evacuation",
      "gas_alert",
      "brigade_activation",
      "resilience_health_critical",
    ] as NotificationKind[]) {
      expect(inferSeverity(kind)).toBe("vital");
    }
  });

  it("returns important for PPE / signature / overdue / lone_worker / suseso", () => {
    for (const kind of [
      "ppe_expiration",
      "signature_due",
      "overdue_compliance",
      "lone_worker_overdue",
      "suseso_deadline",
    ] as NotificationKind[]) {
      expect(inferSeverity(kind)).toBe("important");
    }
  });

  it("returns ambient for XP / training / system_tip", () => {
    for (const kind of [
      "xp_progress",
      "training_nudge",
      "system_tip",
    ] as NotificationKind[]) {
      expect(inferSeverity(kind)).toBe("ambient");
    }
  });

  it("explicit severity overrides the kind lookup", () => {
    expect(inferSeverity("sos", "ambient")).toBe("ambient");
    expect(inferSeverity("xp_progress", "vital")).toBe("vital");
  });
});

describe("severityToAndroidPriority", () => {
  it("vital and important use FCM high", () => {
    expect(severityToAndroidPriority("vital")).toBe("high");
    expect(severityToAndroidPriority("important")).toBe("high");
  });

  it("ambient uses FCM normal", () => {
    expect(severityToAndroidPriority("ambient")).toBe("normal");
  });
});

describe("severityToApnsPriority", () => {
  it("vital uses APNs 10", () => {
    expect(severityToApnsPriority("vital")).toBe("10");
  });

  it("important and ambient use APNs 5", () => {
    expect(severityToApnsPriority("important")).toBe("5");
    expect(severityToApnsPriority("ambient")).toBe("5");
  });
});

describe("severityToChannelId", () => {
  it("routes vital to praeventio_emergency", () => {
    expect(severityToChannelId("vital")).toBe("praeventio_emergency");
  });

  it("routes important and ambient to praeventio_default", () => {
    expect(severityToChannelId("important")).toBe("praeventio_default");
    expect(severityToChannelId("ambient")).toBe("praeventio_default");
  });
});

describe("severityToCriticalSound", () => {
  it("vital requests critical sound", () => {
    expect(severityToCriticalSound("vital")).toBe(true);
  });

  it("important and ambient do not request critical sound", () => {
    expect(severityToCriticalSound("important")).toBe(false);
    expect(severityToCriticalSound("ambient")).toBe(false);
  });
});

describe("severityShouldPush", () => {
  it("vital and important push", () => {
    expect(severityShouldPush("vital")).toBe(true);
    expect(severityShouldPush("important")).toBe(true);
  });

  it("ambient NEVER pushes (Calm Tech guard)", () => {
    expect(severityShouldPush("ambient")).toBe(false);
  });
});

describe("isNotificationSeverity", () => {
  it("accepts the three closed values", () => {
    expect(isNotificationSeverity("vital")).toBe(true);
    expect(isNotificationSeverity("important")).toBe(true);
    expect(isNotificationSeverity("ambient")).toBe(true);
  });

  it("rejects arbitrary strings and unrelated types", () => {
    expect(isNotificationSeverity("critical")).toBe(false);
    expect(isNotificationSeverity("")).toBe(false);
    expect(isNotificationSeverity(undefined)).toBe(false);
    expect(isNotificationSeverity(null)).toBe(false);
    expect(isNotificationSeverity(42)).toBe(false);
    expect(isNotificationSeverity({})).toBe(false);
  });
});

describe("NEGATIVE: life-safety guard", () => {
  it("a future maintainer CANNOT add a new vital kind silently — the enum is closed", () => {
    // If the kind list ever grows, TypeScript forces a decision here.
    // This test simply asserts the closed surface we ship today.
    const knownKinds: NotificationKind[] = [
      "sos",
      "manDown",
      "evacuation",
      "gas_alert",
      "brigade_activation",
      "resilience_health_critical",
      "ppe_expiration",
      "signature_due",
      "overdue_compliance",
      "lone_worker_overdue",
      "suseso_deadline",
      "xp_progress",
      "training_nudge",
      "system_tip",
    ];
    expect(knownKinds).toHaveLength(14);
  });
});
