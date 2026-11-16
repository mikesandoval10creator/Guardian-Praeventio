import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ode from './odeIntegrator';
import { clampFireHorizon, FIRE_STEP_MINUTES, MAX_FIRE_MINUTES, validFireResult } from './fireSpreadProtocol';
import { handleFireSpreadMessage } from '../../workers/fireSpreadWorker';
const input = { initialArea: 20, spreadRate: 8, suppressionRate: 15, suppressionStartT: 5 };
afterEach(() => vi.restoreAllMocks());
describe('bounded training-worker protocol', () => {
  it.each([1, 2.25, 30, MAX_FIRE_MINUTES])('preserves the actual Euler output at %s minutes', (tMax) => {
    const response = handleFireSpreadMessage({ input, tMax });
    expect(response).toEqual({ ok: true, result: ode.simulateFireSpread(input, FIRE_STEP_MINUTES, tMax) });
    if (!response.ok) throw new Error('invalid fixture');
    expect(validFireResult(response.result, tMax)).toBe(true);
    expect(response.result.timeline.length).toBeLessThanOrEqual(Math.ceil(MAX_FIRE_MINUTES / FIRE_STEP_MINUTES) + 1);
  });
  it.each([10000, Infinity, NaN, -1, 0])('rejects horizon %s without entering Euler', (tMax) => {
    const core = vi.spyOn(ode, 'simulateFireSpread').mockImplementation(() => { throw new Error('must not run'); });
    expect(handleFireSpreadMessage({ input, tMax })).toEqual({ ok: false });
    expect(core).not.toHaveBeenCalled();
  });
  it.each(['initialArea', 'spreadRate', 'suppressionRate', 'suppressionStartT'])('rejects nonfinite %s without entering Euler', (key) => {
    const core = vi.spyOn(ode, 'simulateFireSpread').mockImplementation(() => { throw new Error('must not run'); });
    expect(handleFireSpreadMessage({ input: { ...input, [key]: Infinity }, tMax: 30 })).toEqual({ ok: false });
    expect(core).not.toHaveBeenCalled();
  });
  it('does not allow an extra untrusted step parameter to expand the iteration budget', () => {
    const result = ode.simulateFireSpread(input, FIRE_STEP_MINUTES, 30);
    const core = vi.spyOn(ode, 'simulateFireSpread').mockReturnValue(result);
    expect(handleFireSpreadMessage({ input, tMax: 30, h: 1e-100 })).toEqual({ ok: true, result });
    expect(core).toHaveBeenCalledWith(input, FIRE_STEP_MINUTES, 30);
  });
  it('rejects floating-point overflow instead of returning nonfinite chart data', () => {
    expect(handleFireSpreadMessage({ input: { ...input, initialArea: 1e308, spreadRate: 1e308 }, tMax: 30 })).toEqual({ ok: false });
  });
  it('clamps the visible UI budget and uses a finite default for invalid numeric state', () => {
    expect(clampFireHorizon(10000)).toBe(MAX_FIRE_MINUTES);
    expect(clampFireHorizon(-1)).toBe(1);
    expect(clampFireHorizon(NaN)).toBe(30);
  });
});
