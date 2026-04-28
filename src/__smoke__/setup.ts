/**
 * Shared test fixtures for the smoke-test suite.
 *
 * Smoke tests are intentionally minimal — they verify that the most-used
 * end-to-end flows still wire together correctly and that critical exports
 * remain reachable. This module collects fixtures used across multiple
 * smoke files so each individual smoke test stays a few lines long.
 *
 * IMPORTANT: keep this file dependency-light. Any heavy mock belongs in
 * the specific smoke file that needs it (so the others stay fast).
 */
import type { CheckoutRequest, InvoiceLineItem } from '../services/billing/types.js';
import type { RebaInput } from '../services/ergonomics/reba';
import type { RulaInput } from '../services/ergonomics/rula';
import type { TmertInput } from '../services/protocols/tmert';

/** Neutral REBA posture — score 1, action level "negligible". */
export const NEUTRAL_REBA: RebaInput = {
  trunk: { flexionDeg: 0 },
  neck: { flexionDeg: 0 },
  legs: { bilateralSupport: true, kneeFlexionDeg: 0 },
  upperArm: { flexionDeg: 0 },
  lowerArm: { flexionDeg: 70 },
  wrist: { flexionDeg: 0 },
  load: { kg: 0 },
  coupling: 'good',
  activity: {},
};

/** Neutral RULA posture — score in [1, 2], action level 1. */
export const NEUTRAL_RULA: RulaInput = {
  upperArm: { flexionDeg: 0 },
  lowerArm: { flexionDeg: 80 },
  wrist: { flexionDeg: 0 },
  wristTwist: 'mid',
  neck: { flexionDeg: 5 },
  trunk: { flexionDeg: 0, wellSupported: true },
  legs: { supportedAndBalanced: true },
  muscleUse: {},
  force: { kg: 0.5, pattern: 'intermittent' },
};

/** Empty TMERT conditions — every factor "no", overallRisk "bajo". */
export const EMPTY_TMERT: TmertInput = {
  repetitividad: { A: false, B: false, C: false },
  fuerza: { A: false, B: false, C: false },
  posturaForzada: { A: false, B: false, C: false },
  otros: { A: false, B: false, C: false },
  exposureHoursPerDay: 0,
};

/** Sample CheckoutRequest used by billing-flow smoke. */
export const SAMPLE_CHECKOUT: CheckoutRequest = {
  tierId: 'comite-paritario',
  cycle: 'monthly',
  currency: 'CLP',
  totalWorkers: 25,
  totalProjects: 3,
  cliente: {
    nombre: 'Cliente Smoke',
    rut: '76.123.456-7',
    email: 'smoke@praeventio.test',
  },
  paymentMethod: 'webpay',
};

/** A single CLP line item — totals → withIVA(10075). */
export const ONE_LINE_ITEM_CLP: InvoiceLineItem[] = [
  {
    tierId: 'comite-paritario',
    description: 'Suscripción comite-paritario (monthly)',
    quantity: 1,
    unitAmount: 10075,
    currency: 'CLP',
  },
];
