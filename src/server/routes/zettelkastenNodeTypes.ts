// Praeventio Guard — canonical Zettelkasten node-type allowlist.
//
// Single source of truth for the `type` field accepted by
// POST /api/zettelkasten/nodes. The production validator
// (`src/server/routes/zettelkasten.ts`) AND the supertest mirror
// (`src/__tests__/server/test-server.ts`) both import this set so they can
// NEVER drift — historically the mirror lagged the real route (it was missing
// `safety-learning` and `epp_inspection`), which let a write pass locally but
// be rejected in production.
//
// Adding a new generator type = add it here once.

export const VALID_ZK_NODE_TYPES: ReadonlySet<string> = new Set([
  // Bernoulli physics generators.
  'hidrante-pressure',
  'misting-suppression',
  'scaffold-uplift',
  'confined-space-vent',
  'gas-leak-anomaly',
  'mining-extraction',
  'hazmat-pipe',
  'structural-wind',
  'respirator-fatigue',
  'pulmonary-altitude',
  'micro-wind-energy',
  'slope-stability',
  'slam-mesh',
  'dike-hydrostatic',
  'gas-dispersion',
  // Sprint 16 — wisdom-capsule learning node emitted by /api/wisdom-capsule.
  'safety-learning',
  // B3 (Fase 5) — on-device EPP inspection node emitted by VisionAnalyzer
  // and BioAnalysis (`buildEppInspectionNode`). The image never leaves the
  // device; only the classification + métricas are persisted.
  'epp_inspection',
]);
