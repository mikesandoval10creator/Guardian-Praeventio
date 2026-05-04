// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import {
  eulerStep,
  eulerIntegrate,
  eulerScalar,
  simulateFireSpread,
  type DerivativeFn,
  type StateAdder,
} from './odeIntegrator';

// ─── eulerScalar — convergence pins ─────────────────────────────────────────

describe('eulerScalar — convergence vs known closed-form solutions', () => {
  it("y' = -y, y(0)=1 → exp(-1) within 0.5% at t=1 with h=0.001", () => {
    // Exact solution: y(t) = exp(-t). Euler with h=0.001 gives ~0.36770
    // (theoretical exact 0.367879). Error ~0.05 %, well under 0.5 % bound.
    // (h=0.01 sits right at the 0.5% boundary at 0.502% — h=0.001 gives
    // a more comfortable convergence pin.)
    const traj = eulerScalar((_, y) => -y, 1, 0, 1, 0.001);
    const last = traj[traj.length - 1];
    expect(last.t).toBeCloseTo(1, 9);
    const exact = Math.exp(-1);
    const relError = Math.abs(last.y - exact) / exact;
    expect(relError).toBeLessThan(0.005);
  });

  it("y' = -y, y(0)=1 → exp(-1) within 1% at t=1 with h=0.01 (looser pin)", () => {
    // Same ODE, coarser step. Confirms O(h) convergence visible at the
    // boundary (h=0.01 lands at ~0.502% error).
    const traj = eulerScalar((_, y) => -y, 1, 0, 1, 0.01);
    const last = traj[traj.length - 1];
    const exact = Math.exp(-1);
    const relError = Math.abs(last.y - exact) / exact;
    expect(relError).toBeLessThan(0.01);
  });

  it("y' = y, y(0)=1 → exp(1) within 1% at t=1 with h=0.001", () => {
    const traj = eulerScalar((_, y) => y, 1, 0, 1, 0.001);
    const last = traj[traj.length - 1];
    const exact = Math.E;
    const relError = Math.abs(last.y - exact) / exact;
    expect(relError).toBeLessThan(0.01);
  });

  it('error scales linearly with h (O(h) global)', () => {
    // For y' = y, y(0)=1, integrate to t=1.
    // Coarse h vs fine h: error should reduce by ~10x when h reduces by 10x.
    const exact = Math.E;
    const coarse = eulerScalar((_, y) => y, 1, 0, 1, 0.1);
    const fine = eulerScalar((_, y) => y, 1, 0, 1, 0.01);
    const eCoarse = Math.abs(coarse[coarse.length - 1].y - exact);
    const eFine = Math.abs(fine[fine.length - 1].y - exact);
    // O(h) means halving h roughly halves error; 10× refinement → ~10× reduction.
    // Allow generous bound (>3×) since constants vary.
    expect(eCoarse / eFine).toBeGreaterThan(3);
  });

  it("y' = 2t (autonomous in y), y(0)=0, single step h=0.5 → y(0.5) = 0", () => {
    // dy/dt at t=0 is 2·0 = 0, so one Euler step: y_1 = 0 + 0.5·0 = 0.
    // (Exact solution would be y(0.5) = 0.25 — Euler underestimates here.)
    const traj = eulerScalar((t) => 2 * t, 0, 0, 0.5, 0.5);
    expect(traj.length).toBe(2);
    expect(traj[1].t).toBeCloseTo(0.5, 9);
    expect(traj[1].y).toBeCloseTo(0, 9);
  });

  it('returns trajectory with initial point only when t0 === tEnd', () => {
    const traj = eulerScalar((_, y) => y, 5, 2, 2, 0.1);
    expect(traj.length).toBe(1);
    expect(traj[0]).toEqual({ t: 2, y: 5 });
  });

  it('throws on h ≤ 0', () => {
    expect(() => eulerScalar((_, y) => y, 1, 0, 1, 0)).toThrow(RangeError);
    expect(() => eulerScalar((_, y) => y, 1, 0, 1, -0.1)).toThrow(RangeError);
  });

  it('throws on tEnd < t0', () => {
    expect(() => eulerScalar((_, y) => y, 1, 1, 0, 0.1)).toThrow(RangeError);
  });
});

// ─── eulerStep / eulerIntegrate — generic state ─────────────────────────────

describe('eulerStep / eulerIntegrate — generic state plumbing', () => {
  it('eulerStep one-shot for vector ODE [x,y]', () => {
    type Vec = { x: number; y: number };
    const derivative: DerivativeFn<Vec> = (_, s) => ({ x: 1, y: 2 });
    const add: StateAdder<Vec> = (s, d, h) => ({ x: s.x + h * d.x, y: s.y + h * d.y });
    const result = eulerStep({
      t: 0,
      state: { x: 0, y: 0 },
      h: 0.5,
      derivative,
      add,
    });
    expect(result.t).toBeCloseTo(0.5, 9);
    expect(result.state.x).toBeCloseTo(0.5, 9);
    expect(result.state.y).toBeCloseTo(1, 9);
  });

  it('eulerIntegrate with onStep callback fires once per step', () => {
    const onStep = vi.fn();
    eulerIntegrate({
      t0: 0,
      state0: 0,
      tEnd: 1,
      h: 0.25,
      derivative: () => 1,
      add: (s, d, h) => s + h * d,
      onStep,
    });
    // 4 steps from t=0 to t=1 with h=0.25.
    expect(onStep).toHaveBeenCalledTimes(4);
  });

  it('eulerIntegrate truncates last step to land exactly on tEnd', () => {
    const result = eulerIntegrate({
      t0: 0,
      state0: 0,
      tEnd: 1,
      h: 0.3, // 3 full steps go to 0.9, last step truncates to 0.1.
      derivative: () => 1,
      add: (s, d, h) => s + h * d,
    });
    expect(result.t).toBeCloseTo(1, 9);
    expect(result.state).toBeCloseTo(1, 9);
  });

  it('eulerStep throws on h ≤ 0', () => {
    expect(() =>
      eulerStep({
        t: 0,
        state: 0,
        h: 0,
        derivative: () => 1,
        add: (s, d, h) => s + h * d,
      }),
    ).toThrow(RangeError);
  });

  it('eulerIntegrate performs 10000-step integration in <50ms', () => {
    const start = Date.now();
    const result = eulerIntegrate({
      t0: 0,
      state0: 1,
      tEnd: 1,
      h: 1e-4, // 10 000 steps
      derivative: (_, y) => -y,
      add: (s, d, h) => s + h * d,
    });
    const elapsed = Date.now() - start;
    expect(result.state).toBeGreaterThan(0);
    expect(result.state).toBeLessThan(1);
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── simulateFireSpread — pre-built scenario ────────────────────────────────

describe('simulateFireSpread — fire growth + suppression', () => {
  it('grows linearly per spreadRate when no suppression triggers', () => {
    const result = simulateFireSpread(
      {
        initialArea: 10,
        spreadRate: 5, // 5 m²/min growth
        suppressionRate: 0,
        suppressionStartT: 1000, // never within tMax
      },
      0.5, // h
      20, // tMax
    );
    // After 20 min: 10 + 5·20 = 110 m². Linear growth — Euler is exact for linear ODE.
    expect(result.timeline[result.timeline.length - 1].area).toBeCloseTo(110, 6);
    expect(result.timeToContain).toBeNull();
    expect(result.peakArea).toBeCloseTo(110, 6);
  });

  it('reaches peak around suppressionStartT when intervention is effective', () => {
    const result = simulateFireSpread(
      {
        initialArea: 10,
        spreadRate: 5,
        suppressionRate: 10, // net dA/dt = -5 after suppression
        suppressionStartT: 10,
      },
      0.5,
      30,
    );
    // Peak area at t ≈ 10: 10 + 5·10 = 60 m².
    expect(result.peakArea).toBeCloseTo(60, 0);
    expect(result.timeToContain).not.toBeNull();
    // After peak (60 m²) at t=10, with net rate -5, contained at t = 10 + 60/5 = 22.
    expect(result.timeToContain!).toBeGreaterThan(20);
    expect(result.timeToContain!).toBeLessThan(24);
  });

  it('contains within reasonable time when suppression > spread', () => {
    const result = simulateFireSpread(
      {
        initialArea: 50,
        spreadRate: 2,
        suppressionRate: 12, // net -10 after suppression
        suppressionStartT: 0, // immediate
      },
      0.1,
      20,
    );
    expect(result.timeToContain).not.toBeNull();
    expect(result.timeToContain!).toBeLessThan(10);
    // Final timeline area must be 0 (extinguished).
    expect(result.timeline[result.timeline.length - 1].area).toBe(0);
    expect(result.timeline[result.timeline.length - 1].phase).toBe('extinguished');
  });

  it('never contains when suppression < spread (timeToContain = null)', () => {
    const result = simulateFireSpread(
      {
        initialArea: 10,
        spreadRate: 10,
        suppressionRate: 5, // still net +5 even after suppression starts
        suppressionStartT: 5,
      },
      0.5,
      30,
    );
    expect(result.timeToContain).toBeNull();
    // Area keeps growing forever, peak == final area.
    const finalArea = result.timeline[result.timeline.length - 1].area;
    expect(result.peakArea).toBeCloseTo(finalArea, 6);
  });

  it('phase transitions: growth → suppression → extinguished', () => {
    const result = simulateFireSpread(
      {
        initialArea: 10,
        spreadRate: 4,
        suppressionRate: 14, // net -10
        suppressionStartT: 5,
      },
      0.5,
      30,
    );
    // Initial phase is growth, before suppressionStartT.
    expect(result.timeline[0].phase).toBe('growth');
    // Some step before t=5 should still be growth.
    const earlyStep = result.timeline.find((s) => s.t > 0 && s.t < 5);
    expect(earlyStep?.phase).toBe('growth');
    // Phase changes to suppression after suppressionStartT (while still > 0).
    const midStep = result.timeline.find((s) => s.t > 5 && s.area > 0);
    expect(midStep?.phase).toBe('suppression');
    // Eventually extinguished.
    const lastStep = result.timeline[result.timeline.length - 1];
    expect(lastStep.phase).toBe('extinguished');
  });

  it('throws on invalid inputs', () => {
    expect(() =>
      simulateFireSpread({ initialArea: 10, spreadRate: 1, suppressionRate: 0, suppressionStartT: 0 }, 0, 10),
    ).toThrow(RangeError);
    expect(() =>
      simulateFireSpread({ initialArea: 10, spreadRate: 1, suppressionRate: 0, suppressionStartT: 0 }, 0.5, 0),
    ).toThrow(RangeError);
    expect(() =>
      simulateFireSpread(
        { initialArea: -5, spreadRate: 1, suppressionRate: 0, suppressionStartT: 0 },
        0.5,
        10,
      ),
    ).toThrow(RangeError);
  });
});
