/**
 * Sprint 29 Bucket BB — H22 KnowledgeGraph virtualisation.
 *
 * Off-thread force-directed layout for the KnowledgeGraph component.
 * The main thread posts a message of shape `ForceGraphRequest`; we run
 * a small d3-force simulation for a fixed number of iterations and post
 * back the final 2D/3D positions of every node.
 *
 * The KnowledgeGraph still uses `react-force-graph-2d` / `-3d` for
 * rendering — those libraries also run their own simulation internally,
 * but for very large graphs (>200 nodes) the main-thread simulation
 * stalls input handling. By precomputing positions in this worker and
 * handing the libraries already-warm coordinates we avoid the worst of
 * the jank: the libraries' first tick lands on the precomputed layout
 * instead of a random scatter, so the user perceives an instant render.
 *
 * Protocol (message-based, transferable-friendly):
 *
 *   In:  { type: 'simulate', payload: { nodes, links, iterations?, dim? } }
 *        - `dim` defaults to 2 (force-graph-2d). Pass 3 for force-graph-3d.
 *        - `iterations` defaults to 60 (matches d3-force defaults).
 *   Out: { type: 'simulate.done', payload: { positions: [{id,x,y[,z]}] } }
 *   Err: { type: 'simulate.error', payload: { message } }
 *
 *   Any other input message shape posts back `simulate.error` with a
 *   descriptive message so the main thread can fall back to inline mode
 *   without crashing.
 *
 * The worker is intentionally stateless between requests — every
 * `simulate` message creates a fresh simulation. We don't keep node
 * references around because the main thread is allowed to dispose of
 * the worker at any time (e.g. component unmount).
 */

import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

export interface ForceGraphRequestNode {
  id: string;
  // Optional seed positions; ignored if undefined.
  x?: number;
  y?: number;
  z?: number;
}

export interface ForceGraphRequestLink {
  source: string;
  target: string;
}

export interface ForceGraphRequest {
  type: 'simulate';
  payload: {
    nodes: ForceGraphRequestNode[];
    links: ForceGraphRequestLink[];
    iterations?: number;
    dim?: 2 | 3;
  };
}

export interface ForceGraphPosition {
  id: string;
  x: number;
  y: number;
  z?: number;
}

export interface ForceGraphResponseDone {
  type: 'simulate.done';
  payload: { positions: ForceGraphPosition[] };
}

export interface ForceGraphResponseError {
  type: 'simulate.error';
  payload: { message: string };
}

export type ForceGraphResponse = ForceGraphResponseDone | ForceGraphResponseError;

interface SimNode extends SimulationNodeDatum {
  id: string;
  z?: number;
}

/**
 * Validate an inbound message shape. Returns null if invalid (so the
 * caller can post back a structured error) and the typed payload
 * otherwise. Kept separate so the unit tests can exercise it without
 * spinning up a Worker.
 */
export function parseForceGraphRequest(msg: unknown): ForceGraphRequest['payload'] | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'simulate') return null;
  const payload = m.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.links)) return null;
  // Validate that every node has a string id (we use it as the
  // simulation key). Anything else is a contract violation.
  for (const n of payload.nodes) {
    if (!n || typeof (n as { id?: unknown }).id !== 'string') return null;
  }
  for (const l of payload.links) {
    if (!l) return null;
    const ll = l as { source?: unknown; target?: unknown };
    if (typeof ll.source !== 'string' || typeof ll.target !== 'string') return null;
  }
  return payload as unknown as ForceGraphRequest['payload'];
}

/**
 * Run the simulation synchronously (we want the worker to block on
 * compute, then post back once). d3 supports manually calling .tick()
 * to avoid the default rAF-driven loop; perfect for a worker context
 * where requestAnimationFrame doesn't exist.
 */
export function runSimulation(payload: ForceGraphRequest['payload']): ForceGraphPosition[] {
  const dim = payload.dim ?? 2;
  const iterations = Math.max(1, Math.min(payload.iterations ?? 60, 600));

  const simNodes: SimNode[] = payload.nodes.map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    z: n.z,
  }));

  const idIndex = new Map<string, SimNode>();
  simNodes.forEach((n) => idIndex.set(n.id, n));

  // Filter links to those whose endpoints both exist in `nodes`. d3
  // would throw on dangling references; the main thread already does
  // this filter but we double-check for robustness.
  const simLinks: SimulationLinkDatum<SimNode>[] = [];
  for (const l of payload.links) {
    const s = idIndex.get(l.source);
    const t = idIndex.get(l.target);
    if (s && t) simLinks.push({ source: s, target: t });
  }

  const sim: Simulation<SimNode, SimulationLinkDatum<SimNode>> = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-30))
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks).id((d) => d.id).distance(30))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(6))
    .stop();

  for (let i = 0; i < iterations; i++) sim.tick();

  // d3-force is 2D; for 3D we approximate by spreading the missing
  // axis around the simulated y. The KnowledgeGraph's force-graph-3d
  // will continue ticking from these positions, so a flat plane is a
  // reasonable warm start — it just spreads itself out via charge.
  return simNodes.map((n) => {
    const out: ForceGraphPosition = {
      id: n.id,
      x: typeof n.x === 'number' ? n.x : 0,
      y: typeof n.y === 'number' ? n.y : 0,
    };
    if (dim === 3) out.z = typeof n.z === 'number' ? n.z : 0;
    return out;
  });
}

// Worker boilerplate. We don't depend on the WebWorker lib in
// tsconfig (the project ships DOM + DOM.Iterable only), so we use a
// loose `WorkerLikeGlobal` shape rather than `DedicatedWorkerGlobalScope`.
// Under Node (the unit tests), `self` may not exist or may not have
// `onmessage`, so the side-effecting attachment below is guarded.
interface WorkerLikeGlobal {
  postMessage: (msg: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const workerSelf: WorkerLikeGlobal | undefined =
  typeof self !== 'undefined' && typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function'
    ? (self as unknown as WorkerLikeGlobal)
    : undefined;

if (workerSelf) {
  workerSelf.onmessage = (event: MessageEvent) => {
    const payload = parseForceGraphRequest(event.data);
    if (!payload) {
      const err: ForceGraphResponseError = {
        type: 'simulate.error',
        payload: { message: 'Invalid forceGraphWorker message: expected { type:"simulate", payload:{nodes,links} }' },
      };
      workerSelf.postMessage(err);
      return;
    }
    try {
      const positions = runSimulation(payload);
      const done: ForceGraphResponseDone = {
        type: 'simulate.done',
        payload: { positions },
      };
      workerSelf.postMessage(done);
    } catch (e) {
      const err: ForceGraphResponseError = {
        type: 'simulate.error',
        payload: { message: e instanceof Error ? e.message : String(e) },
      };
      workerSelf.postMessage(err);
    }
  };
}
