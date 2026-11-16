import type { FireSpreadInput, FireSpreadResult } from './odeIntegrator';

// Training-view compute budget, not a physical/fire-safety certification limit.
export const MIN_FIRE_MINUTES = 1;
export const MAX_FIRE_MINUTES = 240;
export const FIRE_STEP_MINUTES = 0.25;
export const FIRE_WORKER_TIMEOUT_MS = 5000;
export interface FireSpreadRequest { input: FireSpreadInput; tMax: number }
export type FireSpreadReply = { ok: true; result: FireSpreadResult } | { ok: false };

export function clampFireHorizon(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_FIRE_MINUTES, Math.max(MIN_FIRE_MINUTES, value)) : 30;
}
export function validFireRequest(value: unknown): value is FireSpreadRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<FireSpreadRequest>;
  if (typeof request.tMax !== 'number' || !Number.isFinite(request.tMax)
    || request.tMax < MIN_FIRE_MINUTES || request.tMax > MAX_FIRE_MINUTES) return false;
  if (!request.input || typeof request.input !== 'object') return false;
  return ['initialArea', 'spreadRate', 'suppressionRate', 'suppressionStartT'].every((key) => {
    const field = (request.input as unknown as Record<string, unknown>)[key];
    return typeof field === 'number' && Number.isFinite(field) && field >= 0;
  });
}
export function validFireResult(value: unknown, tMax: number): value is FireSpreadResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<FireSpreadResult>;
  if (typeof result.peakArea !== 'number' || !Number.isFinite(result.peakArea) || result.peakArea < 0) return false;
  if (result.timeToContain !== null && (typeof result.timeToContain !== 'number'
    || !Number.isFinite(result.timeToContain) || result.timeToContain < 0 || result.timeToContain > tMax)) return false;
  if (!Array.isArray(result.timeline) || result.timeline.length < 2
    || result.timeline.length > Math.ceil(tMax / FIRE_STEP_MINUTES) + 1) return false;
  let last = -1;
  for (const point of result.timeline) {
    if (!point || !Number.isFinite(point.t) || !Number.isFinite(point.area)
      || point.t <= last || point.t < 0 || point.t > tMax || point.area < 0 || point.area > result.peakArea
      || !['growth', 'suppression', 'extinguished'].includes(point.phase)) return false;
    last = point.t;
  }
  return result.timeline[0].t === 0 && Math.abs(last - tMax) < 1e-7;
}
