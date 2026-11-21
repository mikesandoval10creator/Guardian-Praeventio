// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { SplatCapture } from "../../services/digitalTwin/gaussianSplatRegistry";
import { ScopedGaussianSplatViewer } from "./ScopedGaussianSplatViewer";

const subscriptions = vi.hoisted(() =>
  vi.fn<(tenant: string, project: string, receive: (capture: SplatCapture | null) => void) => () => void>(),
);
vi.mock("../../services/digitalTwin/splatCaptureStore", () => ({
  subscribePreferredSplatCapture: subscriptions,
}));

function capture(projectId: string, extentMeters: number): SplatCapture {
  return {
    id: "same-capture-id", projectId, extentMeters,
    capturedAt: "2026-01-01T00:00:00Z", capturedByUid: "fixture",
    format: "splat", storageUrl: "gs://fixture/capture.splat",
    sizeBytes: 3_200_000, splatCount: 100_000,
    centerCoords: { lat: 0, lng: 0 }, isCanonical: true,
  };
}

it.each([["tenant-b", "project-a"], ["tenant-a", "project-b"]])(
  "clears the old capture and ignores late updates after switching to %s/%s",
  (tenant, project) => {
    subscriptions.mockReset();
    const stop = vi.fn();
    subscriptions.mockReturnValue(stop);
    const view = render(<ScopedGaussianSplatViewer tenantId="tenant-a" projectId="project-a" />);
    const first = subscriptions.mock.lastCall![2];
    act(() => first(capture("project-a", 17)));
    expect(screen.getByText("17m")).toBeInTheDocument();
    view.rerender(<ScopedGaussianSplatViewer tenantId={tenant} projectId={project} />);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("splat-viewer-empty")).toBeInTheDocument();
    expect(subscriptions.mock.lastCall?.slice(0, 2)).toEqual([tenant, project]);
    const current = subscriptions.mock.lastCall![2];
    act(() => current(capture(project, 29)));
    act(() => first(capture("project-a", 17)));
    expect(screen.getByText("29m")).toBeInTheDocument();
    expect(screen.queryByText("17m")).not.toBeInTheDocument();
  },
);
