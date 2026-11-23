import type { ForceGraphPosition, ForceGraphRequest, ForceGraphResponse } from './forceGraphWorker';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ForceGraphRequest | { type: 'initialize'; module: WebAssembly.Module }>) => void) | null;
  postMessage(response: ForceGraphResponse): void;
};
let module: WebAssembly.Module | undefined;
const inputLimit = 2 * 1024 * 1024;
const outputLimit = 8 * 1024 * 1024;

scope.onmessage = ({ data }) => {
  if (data?.type === 'initialize') {
    module = data.module;
    return;
  }
  // This worker and its instance own exactly one simulation. The client
  // terminates it on success, failure, timeout or cancellation.
  scope.onmessage = null;
  try {
    if (data?.type !== 'simulate' || !module) throw new Error('layout_not_initialized');
    // Match d3-force's 2D initialization before crossing the JSON boundary.
    // A missing axis resets both x and y; z is passed through independently.
    // Using the browser's math here also avoids differences in Rust's trig.
    const initialAngle = Math.PI * (3 - Math.sqrt(5));
    const nodes = data.payload.nodes.map((node, index) => {
      if (Number.isFinite(node.x) && Number.isFinite(node.y)) return node;
      const radius = 10 * Math.sqrt(0.5 + index);
      const angle = index * initialAngle;
      return { ...node, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    const input = new TextEncoder().encode(JSON.stringify({ ...data.payload, nodes }));
    if (input.length > inputLimit) throw new Error('layout_input_limit');
    const { exports: { memory, graph_alloc: alloc, graph_layout: layout } } = new WebAssembly.Instance(module);
    if (!(memory instanceof WebAssembly.Memory) || typeof alloc !== 'function' || typeof layout !== 'function') {
      throw new Error('layout_invalid_abi');
    }
    const ptr = alloc(input.length);
    if (!Number.isInteger(ptr) || ptr <= 0 || ptr + input.length > memory.buffer.byteLength) {
      throw new Error('layout_invalid_input_buffer');
    }
    new Uint8Array(memory.buffer, ptr, input.length).set(input);
    const packed = layout(ptr, input.length);
    if (typeof packed !== 'bigint') throw new Error('layout_invalid_abi');
    const address = Number(packed & 0xffffffffn);
    const length = Number(packed >> 32n);
    if (address <= 0 || length <= 0 || length > outputLimit || address + length > memory.buffer.byteLength) {
      throw new Error('layout_invalid_output_buffer');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(memory.buffer, address, length));
    const positions: ForceGraphPosition[] = JSON.parse(text);
    // The shared client validates each returned coordinate against the request.
    scope.postMessage({ type: 'simulate.done', payload: { positions } });
  } catch {
    scope.postMessage({ type: 'simulate.error', payload: { message: 'layout_wasm_failed' } });
  }
};
