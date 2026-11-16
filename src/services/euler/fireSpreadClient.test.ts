import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFireSpreadSimulation } from './fireSpreadClient';
import { handleFireSpreadMessage } from '../../workers/fireSpreadWorker';
const input = { initialArea: 20, spreadRate: 8, suppressionRate: 15, suppressionStartT: 5 };
let worker: EventTarget & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> };
beforeEach(() => {
  worker = Object.assign(new EventTarget(), { postMessage: vi.fn(), terminate: vi.fn() });
  vi.stubGlobal('Worker', vi.fn(function () { return worker; }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('fire-spread worker ownership', () => {
  it('resolves the actual model reply and releases listeners/timer/worker', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reply = handleFireSpreadMessage({ input, tMax: 30 });
    expect(reply.ok).toBe(true);
    const task = runFireSpreadSimulation(input, 30, controller.signal);
    worker.dispatchEvent(new MessageEvent('message', { data: reply }));
    if (!reply.ok) throw new Error('invalid fixture');
    await expect(task).resolves.toEqual(reply.result);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('does not create a worker for a pre-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runFireSpreadSimulation(input, 30, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(Worker).not.toHaveBeenCalled();
  });
  it('rejects an oversized horizon before creating a worker', async () => {
    await expect(runFireSpreadSimulation(input, 10000)).rejects.toMatchObject({ code: 'invalid' });
    expect(Worker).not.toHaveBeenCalled();
  });
  it('cancels an active worker and ignores a late result', async () => {
    const controller = new AbortController();
    const task = runFireSpreadSimulation(input, 30, controller.signal);
    const checked = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    worker.dispatchEvent(new MessageEvent('message', { data: handleFireSpreadMessage({ input, tMax: 30 }) }));
    await checked;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed or nonfinite worker data instead of rendering it', async () => {
    const task = runFireSpreadSimulation(input, 30);
    const checked = expect(task).rejects.toMatchObject({ code: 'failed' });
    worker.dispatchEvent(new MessageEvent('message', { data: { ok: true, result: { peakArea: Infinity, timeline: [] } } }));
    await checked;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('releases the worker on a worker error', async () => {
    const checked = expect(runFireSpreadSimulation(input, 30)).rejects.toMatchObject({ code: 'failed' });
    worker.dispatchEvent(new Event('error', { cancelable: true }));
    await checked;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('fails clearly without a synchronous fallback if workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(runFireSpreadSimulation(input, 30)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('terminates and rejects a worker that never responds after five seconds', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let outcome = 'pending';
    const task = runFireSpreadSimulation(input, 30, controller.signal).then(
      () => { outcome = 'success'; },
      (error: Error) => { outcome = error instanceof Error && 'code' in error ? String(error.code) : error.name; },
    );
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(outcome).toBe('timeout');
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      controller.abort();
      await task;
    }
  });
});
