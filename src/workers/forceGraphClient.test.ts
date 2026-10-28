import { afterEach, describe, expect, it, vi } from "vitest";
import { createForceGraphLayoutClient } from "./forceGraphClient";
const payload = { nodes: [{ id: "a" }], links: [] };
class Transport {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((_message: unknown) =>
    queueMicrotask(() =>
      this.onmessage?.({
        data: { type: "simulate.done", payload: { positions: [{ id: "a", x: 1, y: 2 }] } },
      } as MessageEvent),
    ),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("force graph client engine selection", () => {
  it("keeps WASM disabled by default even when a factory is supplied", async () => {
    const ts = new Transport(),
      wasm = vi.fn();
    const c = createForceGraphLayoutClient({
      createTypeScriptWorker: () => ts as unknown as Worker,
      createWasmWorker: wasm,
    });
    expect((await c.simulate(payload, { signal: new AbortController().signal })).engine).toBe(
      "typescript",
    );
    expect(wasm).not.toHaveBeenCalled();
    expect(ts.terminate).toHaveBeenCalledOnce();
  });
  it("falls back once after constructor failure without exposing error details", async () => {
    const c = createForceGraphLayoutClient({
      wasmEnabled: true,
      createWasmWorker: () => {
        throw new Error("private detail");
      },
      createTypeScriptWorker: () => new Transport() as unknown as Worker,
    });
    const r = await c.simulate(payload, { signal: new AbortController().signal });
    expect(r.engine).toBe("typescript");
    expect(r.fallbackReason).toBe("layout_worker_unavailable");
    expect(JSON.stringify(r)).not.toContain("private detail");
  });
  it.each(["foreign", "nonfinite", "truncated", "sparse", "reported-error"])(
    "rejects %s WASM output before TypeScript fallback",
    async (kind) => {
      const wasm = new Transport();
      wasm.postMessage = vi.fn(() =>
        queueMicrotask(() =>
          wasm.onmessage?.({
            data:
              kind === "reported-error"
                ? { type: "simulate.error", payload: { message: "private" } }
                : {
                    type: "simulate.done",
                    payload: {
                      positions:
                        kind === "sparse"
                          ? new Array(1)
                          : kind === "truncated"
                            ? []
                            : [
                                {
                                  id: kind === "foreign" ? "foreign" : "a",
                                  x: kind === "nonfinite" ? NaN : 1,
                                  y: 2,
                                },
                              ],
                    },
                  },
          } as MessageEvent),
        ),
      );
      const fallback = new Transport();
      const c = createForceGraphLayoutClient({
        wasmEnabled: true,
        createWasmWorker: () => wasm as unknown as Worker,
        createTypeScriptWorker: () => fallback as unknown as Worker,
      });
      const r = await c.simulate(payload, { signal: new AbortController().signal });
      expect(r.engine).toBe("typescript");
      expect(wasm.terminate).toHaveBeenCalledOnce();
      expect(fallback.terminate).toHaveBeenCalledOnce();
    },
  );
  it("timeout terminates WASM before the bounded fallback", async () => {
    vi.useFakeTimers();
    const wasm = new Transport();
    wasm.postMessage = vi.fn();
    const fallback = new Transport();
    const c = createForceGraphLayoutClient({
      wasmEnabled: true,
      createWasmWorker: () => wasm as unknown as Worker,
      createTypeScriptWorker: () => fallback as unknown as Worker,
      wasmDeadlineMs: 10,
    });
    const pending = c.simulate(payload, { signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(11);
    expect((await pending).engine).toBe("typescript");
    expect(wasm.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a fallback timeout rejects without another retry", async () => {
    vi.useFakeTimers();
    const wasm = new Transport(),
      ts = new Transport();
    wasm.postMessage = vi.fn();
    ts.postMessage = vi.fn();
    const createTS = vi.fn(() => ts as unknown as Worker);
    const c = createForceGraphLayoutClient({
      wasmEnabled: true,
      createWasmWorker: () => wasm as unknown as Worker,
      createTypeScriptWorker: createTS,
      wasmDeadlineMs: 10,
      typescriptDeadlineMs: 10,
    });
    const rejection = expect(
      c.simulate(payload, { signal: new AbortController().signal }),
    ).rejects.toThrow("layout_deadline");
    await vi.advanceTimersByTimeAsync(21);
    await rejection;
    expect(createTS).toHaveBeenCalledOnce();
    expect(ts.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("abort frees the slot synchronously and never clears the next request slot", async () => {
    const first = new Transport();
    first.postMessage = vi.fn();
    const second = new Transport();
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const c = createForceGraphLayoutClient({ createTypeScriptWorker: factory });
    const abort = new AbortController();
    const rejection = expect(c.simulate(payload, { signal: abort.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    abort.abort();
    const next = c.simulate(payload, { signal: new AbortController().signal });
    await rejection;
    expect((await next).positions[0].id).toBe("a");
    expect(first.terminate).toHaveBeenCalledOnce();
  });
  it("rejects concurrent work before creating another worker", async () => {
    const w = new Transport();
    w.postMessage = vi.fn();
    const factory = vi.fn(() => w as unknown as Worker);
    const c = createForceGraphLayoutClient({ createTypeScriptWorker: factory });
    const abort = new AbortController();
    const rejection = expect(c.simulate(payload, { signal: abort.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(c.simulate(payload, { signal: new AbortController().signal })).rejects.toThrow(
      "layout_busy",
    );
    expect(factory).toHaveBeenCalledOnce();
    abort.abort();
    await rejection;
  });
  it("an already aborted request allocates no worker", async () => {
    const factory = vi.fn();
    const c = createForceGraphLayoutClient({ createTypeScriptWorker: factory });
    const controller = new AbortController();
    controller.abort();
    await expect(c.simulate(payload, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(factory).not.toHaveBeenCalled();
  });
  it("large legacy payloads bypass WASM without truncation", async () => {
    const input = {
      nodes: Array.from({ length: 10001 }, (_, i) => ({ id: String(i) })),
      links: [],
    };
    const ts = new Transport();
    ts.postMessage = vi.fn(() =>
      queueMicrotask(() =>
        ts.onmessage?.({
          data: {
            type: "simulate.done",
            payload: { positions: input.nodes.map((n) => ({ id: n.id, x: 1, y: 2 })) },
          },
        } as MessageEvent),
      ),
    );
    const wasm = vi.fn();
    const c = createForceGraphLayoutClient({
      wasmEnabled: true,
      createWasmWorker: wasm,
      createTypeScriptWorker: () => ts as unknown as Worker,
    });
    expect(
      (await c.simulate(input, { signal: new AbortController().signal })).positions,
    ).toHaveLength(10001);
    expect(wasm).not.toHaveBeenCalled();
  });
  it("snapshots caller input before dispatch", async () => {
    const input = { nodes: [{ id: "a" }], links: [] };
    const w = new Transport();
    const c = createForceGraphLayoutClient({
      createTypeScriptWorker: () => w as unknown as Worker,
    });
    const pending = c.simulate(input, { signal: new AbortController().signal });
    input.nodes[0].id = "changed";
    expect((await pending).positions[0].id).toBe("a");
    expect(w.postMessage.mock.calls[0]?.[0]).toMatchObject({ payload: { nodes: [{ id: "a" }] } });
  });
  it("uses the explicitly enabled WASM factory instead of TypeScript", async () => {
    vi.stubGlobal("Worker", Transport);
    const wasm = new Transport();
    const createWasmWorker = vi.fn(() => wasm as unknown as Worker);
    const client = createForceGraphLayoutClient({ wasmEnabled: true, createWasmWorker });
    const result = await client.simulate(payload, { signal: new AbortController().signal });
    expect(createWasmWorker).toHaveBeenCalledOnce();
    expect(result.engine).toBe("wasm");
    expect(wasm.terminate).toHaveBeenCalledOnce();
  });
});
