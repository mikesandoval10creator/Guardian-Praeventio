// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { SplatCapture } from "../../services/digitalTwin/gaussianSplatRegistry";
import { ScopedGaussianSplatViewer } from "./ScopedGaussianSplatViewer";

const subscriptions = vi.hoisted(() =>
  vi.fn<(tenant: string, project: string, receive: (capture: SplatCapture | null, fromCache?: boolean) => void, fail: (error: Error) => void) => () => void>(),
);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
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
    expect(screen.getByRole("status")).toHaveTextContent("Consultando la captura 3D");
    expect(subscriptions.mock.lastCall?.slice(0, 2)).toEqual([tenant, project]);
    const current = subscriptions.mock.lastCall![2];
    act(() => current(capture(project, 29)));
    act(() => first(capture("project-a", 17)));
    expect(screen.getByText("29m")).toBeInTheDocument();
    expect(screen.queryByText("17m")).not.toBeInTheDocument();
  },
);

it("distinguishes a read failure from no capture and retries the current project", () => {
  subscriptions.mockReset();
  const stop = vi.fn();
  subscriptions.mockReturnValue(stop);
  render(<ScopedGaussianSplatViewer tenantId="tenant-a" projectId="project-a" />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  const [, , receive, fail] = subscriptions.mock.lastCall!;
  act(() => receive(capture("project-a", 17)));
  expect(screen.getByText("17m")).toBeInTheDocument();
  act(() => { fail(new Error("fixture")); receive(null); });
  expect(screen.getByRole("alert")).toHaveTextContent("No se pudo consultar la captura 3D");
  expect(screen.queryByTestId("splat-viewer-empty")).not.toBeInTheDocument();
  expect(screen.queryByText("17m")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(subscriptions.mock.lastCall?.slice(0, 2)).toEqual(["tenant-a", "project-a"]);
  expect(subscriptions).toHaveBeenCalledTimes(2);
  act(() => fail(new Error("late fixture")));
  expect(screen.getByRole("status")).toBeInTheDocument();
  const current = subscriptions.mock.lastCall![2];
  act(() => current(null));
  expect(screen.getByTestId("splat-viewer-empty")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not show an empty project until the server confirms a cache miss", () => {
  subscriptions.mockReset();
  subscriptions.mockReturnValue(vi.fn());
  render(<ScopedGaussianSplatViewer tenantId="tenant-a" projectId="project-a" />);
  const receive = subscriptions.mock.lastCall![2];
  act(() => receive(null, true));
  expect(screen.getByRole("status")).toHaveTextContent("No hay una captura guardada en este dispositivo");
  expect(screen.queryByTestId("splat-viewer-empty")).not.toBeInTheDocument();
  act(() => receive(null, false));
  expect(screen.getByTestId("splat-viewer-empty")).toBeInTheDocument();
});
