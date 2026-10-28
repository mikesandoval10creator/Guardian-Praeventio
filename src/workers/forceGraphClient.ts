import type { ForceGraphPosition, ForceGraphRequest, ForceGraphResponse } from "./forceGraphWorker";

type Payload = ForceGraphRequest["payload"];
export interface ForceGraphLayoutResult {
  positions: ForceGraphPosition[];
  engine: "typescript" | "wasm";
  fallbackReason?: string;
}
export interface ForceGraphLayoutClient {
  simulate(payload: Payload, options: { signal: AbortSignal }): Promise<ForceGraphLayoutResult>;
}
export interface ForceGraphClientOptions {
  wasmEnabled?: boolean;
  createWasmWorker?: () => Worker;
  createTypeScriptWorker?: () => Worker;
  wasmDeadlineMs?: number;
  typescriptDeadlineMs?: number;
}
function abortError(): Error {
  const error = new Error("Layout request cancelled");
  error.name = "AbortError";
  return error;
}
function validPositions(
  data: ForceGraphResponse,
  payload: Payload,
): data is Extract<ForceGraphResponse, { type: "simulate.done" }> {
  if (data?.type !== "simulate.done" || !Array.isArray(data.payload?.positions)) return false;
  return (
    data.payload.positions.length === payload.nodes.length &&
    Array.from(data.payload.positions).every(
      (p, i) =>
        p?.id === payload.nodes[i].id &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        (payload.dim === 3 ? Number.isFinite(p.z) : p.z === undefined),
    )
  );
}
/** Bound the experimental path only; larger legacy graphs retain TypeScript. */
function wasmEligible(payload: Payload): boolean {
  return (
    payload.nodes.length <= 10_000 &&
    payload.links.length <= 50_000 &&
    (payload.iterations === undefined ||
      (Number.isInteger(payload.iterations) &&
        payload.iterations >= 1 &&
        payload.iterations <= 600)) &&
    payload.nodes.every(
      (n) =>
        typeof n.id === "string" &&
        n.id.length <= 1024 &&
        [n.x, n.y, n.z].every((v) => v === undefined || (Number.isFinite(v) && Math.abs(v) <= 1e9)),
    ) &&
    new TextEncoder().encode(JSON.stringify(payload)).length <= 2 * 1024 * 1024
  );
}
/** A request owns its Worker. Abort releases the slot synchronously for React. */
export function createForceGraphLayoutClient(
  options: ForceGraphClientOptions = {},
): ForceGraphLayoutClient {
  const createTypeScriptWorker =
    options.createTypeScriptWorker ??
    (() => new Worker(new URL("./forceGraphWorker.ts", import.meta.url), { type: "module" }));
  const wasmDeadline = options.wasmDeadlineMs ?? 2000;
  const tsDeadline = options.typescriptDeadlineMs ?? 10_000;
  if (![wasmDeadline, tsDeadline].every((n) => Number.isFinite(n) && n > 0 && n <= 30_000))
    throw new Error("Invalid layout deadline");
  let active: object | null = null;
  function execute(
    factory: () => Worker,
    payload: Payload,
    signal: AbortSignal,
    budget: number,
  ): Promise<ForceGraphPosition[]> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      let worker: Worker | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (failure?: Error, positions?: ForceGraphPosition[]) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          try {
            worker.terminate();
          } catch {
            /* Settlement must survive disposal failure. */
          }
        }
        if (failure) reject(failure);
        else if (positions) resolve(positions);
        else reject(new Error("layout_invalid_output"));
      };
      const onAbort = () => finish(abortError());
      try {
        worker = factory();
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
        timer = setTimeout(() => finish(new Error("layout_deadline")), budget);
        worker.onmessage = ({ data }: MessageEvent<ForceGraphResponse>) => {
          if (data?.type === "simulate.error") {
            finish(new Error("layout_worker_failed"));
            return;
          }
          if (!validPositions(data, payload)) {
            finish(new Error("layout_invalid_output"));
            return;
          }
          finish(undefined, data.payload.positions);
        };
        worker.onerror = () => finish(new Error("layout_worker_failed"));
        worker.postMessage({ type: "simulate", payload });
      } catch {
        finish(new Error("layout_worker_unavailable"));
      }
    });
  }
  return {
    async simulate(input, { signal }) {
      if (signal.aborted) throw abortError();
      if (active) throw new Error("layout_busy");
      const token = {};
      active = token;
      const release = () => {
        if (active === token) active = null;
      };
      signal.addEventListener("abort", release, { once: true });
      try {
        const payload: Payload = {
          ...input,
          nodes: input.nodes.map((n) => ({ ...n })),
          links: input.links.map((l) => ({ ...l })),
        };
        let fallbackReason: string | undefined;
        if (options.wasmEnabled && options.createWasmWorker && wasmEligible(payload)) {
          try {
            return {
              engine: "wasm",
              positions: await execute(options.createWasmWorker, payload, signal, wasmDeadline),
            };
          } catch (e) {
            if (signal.aborted) throw abortError();
            fallbackReason = e instanceof Error ? e.message : "layout_worker_failed";
          }
        }
        if (signal.aborted) throw abortError();
        return {
          engine: "typescript",
          positions: await execute(createTypeScriptWorker, payload, signal, tsDeadline),
          ...(fallbackReason ? { fallbackReason } : {}),
        };
      } finally {
        signal.removeEventListener("abort", release);
        release();
      }
    },
  };
}
