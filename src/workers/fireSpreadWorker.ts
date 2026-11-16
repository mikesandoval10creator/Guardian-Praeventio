import { simulateFireSpread } from '../services/euler/odeIntegrator';
import {
  FIRE_STEP_MINUTES, validFireRequest, validFireResult, type FireSpreadReply,
} from '../services/euler/fireSpreadProtocol';

/** Fixed training step and bounded horizon; no network, LLM or emergency dispatch. */
export function handleFireSpreadMessage(payload: unknown): FireSpreadReply {
  if (!validFireRequest(payload)) return { ok: false };
  try {
    const result = simulateFireSpread(payload.input, FIRE_STEP_MINUTES, payload.tMax);
    return validFireResult(result, payload.tMax) ? { ok: true, result } : { ok: false };
  } catch {
    return { ok: false };
  }
}
interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: FireSpreadReply): void;
}
const scope = globalThis as unknown as WorkerScope;
if (typeof window === 'undefined' && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => scope.postMessage(handleFireSpreadMessage(event.data));
}
