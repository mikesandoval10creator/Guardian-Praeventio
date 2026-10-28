// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeType, type RiskNode } from "../../types";
const state = vi.hoisted(() => ({ graph: { nodes: [] as unknown[], links: [] as unknown[] } }));
vi.mock("../../hooks/useRiskEngine", () => ({
  useRiskEngine: () => ({
    nodes: state.graph.nodes,
    getGraphData: () => state.graph,
    loading: false,
  }),
}));
vi.mock("../../hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("../../services/geminiService", () => ({ analyzeRootCauses: vi.fn() }));
vi.mock("../../services/analytics", () => ({ analytics: { track: vi.fn() } }));
vi.mock("react-force-graph-2d", () => ({ default: React.forwardRef(() => null) }));
vi.mock("react-force-graph-3d", () => ({ default: React.forwardRef(() => null) }));
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: React.PropsWithChildren) => React.createElement("div", null, children),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));
import { KnowledgeGraph } from "./KnowledgeGraph";
type SeedNode = RiskNode & { x?: number; y?: number };
function graph(prefix: string) {
  return {
    nodes: Array.from({ length: 200 }, (_, i): SeedNode => ({
      id: i === 0 ? "shared" : `${prefix}-${i}`,
      type: NodeType.RISK,
      title: `Node ${i}`,
      description: "",
      tags: [],
      metadata: {},
      connections: [],
      createdAt: "2026-10-27",
      updatedAt: "2026-10-27",
    })),
    links: [],
  };
}
class TestWorker {
  static instances: TestWorker[] = [];
  listeners = new Set<(event: MessageEvent) => void>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  addEventListener(_name: string, fn: (event: MessageEvent) => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_name: string, fn: (event: MessageEvent) => void) {
    this.listeners.delete(fn);
  }
  reply(nodes: SeedNode[], x: number) {
    const e = {
      data: {
        type: "simulate.done",
        payload: { positions: nodes.map((n) => ({ id: n.id, x, y: x + 1 })) },
      },
    } as MessageEvent;
    this.onmessage?.(e);
    for (const fn of this.listeners) fn(e);
  }
}
beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
  state.graph = graph("old");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("KnowledgeGraph layout lifecycle", () => {
  it("uses the supplied opt-in layout client and cancels its request on unmount", async () => {
    const simulate = vi
      .fn()
      .mockResolvedValue({
        engine: "wasm",
        positions: (state.graph.nodes as SeedNode[]).map((n) => ({ id: n.id, x: 41, y: 42 })),
      });
    const view = render(<KnowledgeGraph layoutClient={{ simulate }} />);
    expect(simulate).toHaveBeenCalledOnce();
    expect(TestWorker.instances).toHaveLength(0);
    await act(async () => {});
    expect((state.graph.nodes[0] as SeedNode).x).toBe(41);
    const signal = simulate.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("terminates superseded work and cannot seed a new graph from the previous response", async () => {
    const old = state.graph.nodes as SeedNode[];
    const view = render(<KnowledgeGraph />);
    expect(TestWorker.instances).toHaveLength(1);
    const first = TestWorker.instances[0];
    const next = graph("new");
    state.graph = next;
    view.rerender(<KnowledgeGraph />);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(TestWorker.instances).toHaveLength(2);
    await act(async () => {
      first.reply(old, 999);
    });
    expect(next.nodes[0].x).toBeUndefined();
    await act(async () => {
      TestWorker.instances[1].reply(next.nodes, 12);
    });
    expect(next.nodes[0].x).toBe(12);
    expect(next.nodes[0].y).toBe(13);
  });
});
