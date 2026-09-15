// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  evaluateProbes: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../../services/predictiveAlerts/alertScheduler", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/predictiveAlerts/alertScheduler")
  >("../../services/predictiveAlerts/alertScheduler");
  return { ...actual, evaluateProbes: H.evaluateProbes };
});

vi.mock("../../services/firebase", () => ({ auth: {} }));
vi.mock("../../services/analytics", () => ({ analytics: { track: H.track } }));
vi.mock("../../lib/apiAuth", () => ({ apiAuthHeader: vi.fn() }));

import { AlertSchedulerMount } from "./AlertSchedulerMount";

function scheduledAlert(leadTimeMin: number) {
  return {
    generatorId: "structural-wind",
    decision: {
      fire: true,
      leadTimeMin,
      recommendedAction: "Asegurar la estructura.",
    },
    body: `Alerta predictiva (${leadTimeMin} min)`,
    scheduledAt: "2026-09-15T20:00:00.000Z",
  };
}

describe("AlertSchedulerMount deduplication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    H.evaluateProbes.mockReset();
    H.track.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not suppress a more urgent lead-time alert from the same generator", async () => {
    H.evaluateProbes
      .mockReturnValueOnce([scheduledAlert(30)])
      .mockReturnValueOnce([scheduledAlert(5)]);
    const notify = vi.fn();

    render(
      <AlertSchedulerMount
        projectId="project-1"
        crewId="crew-1"
        probes={[
          {
            id: "structural-wind",
            threshold: 1,
            currentValue: 2,
            forecast: () => 2,
          },
        ]}
        schedulerWindow={{ windowMinutes: 60, minLeadTimeMin: 5 }}
        notify={notify}
      />,
    );

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].data.leadTimeMin).toBe(30);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0].data.leadTimeMin).toBe(5);
    expect(H.track).toHaveBeenCalledTimes(2);
  });
});
