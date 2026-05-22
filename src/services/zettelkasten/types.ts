// SPDX-License-Identifier: MIT
// Shared Zettelkasten payload types for Bernoulli-driven node generators.
// Pure types only — no IO, no React.

export type RiskNodeSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type BernoulliNodeType =
  | 'hidrante-pressure'
  | 'misting-suppression'
  | 'scaffold-uplift'
  | 'confined-space-vent'
  | 'gas-leak-anomaly'
  | 'mining-extraction'
  | 'hazmat-pipe'
  | 'structural-wind'
  | 'respirator-fatigue'
  | 'pulmonary-altitude'
  | 'micro-wind-energy'
  | 'slope-stability'
  | 'slam-mesh'
  | 'dike-hydrostatic'
  | 'gas-dispersion';

/**
 * Sprint 16 — wider Risk node type that includes Bernoulli generators
 * AND non-Bernoulli node kinds (e.g. the safety-learning node emitted
 * by the daily wisdom-capsule pipeline). Keep `BernoulliNodeType`
 * strict so `bernoulliNodeRegistry` (a `Record<BernoulliNodeType, ...>`)
 * remains exhaustive.
 */
export type RiskNodeType =
  | BernoulliNodeType
  | 'safety-learning'
  // §2.18 (2026-05-22) — EPP inspection on-device. Detección TFLite local
  // (privacy: imagen NUNCA sale del device, solo classification result).
  // Ver `src/services/ai/eppDetectorOnDevice.ts`.
  | 'epp_inspection';

export interface RiskNodePayload {
  /** Node title (Spanish, short). */
  title: string;
  /** Multi-line Spanish description with calculation summary + standard reference. */
  description: string;
  /** Discriminator for the Zettelkasten edge router. */
  type: RiskNodeType;
  /** Severity inferred from threshold breach. */
  severity: RiskNodeSeverity;
  /** Pre-computed numeric outputs used by downstream alerting/UI. */
  metadata: Record<string, number | string | boolean | null>;
  /** Outgoing connections — entity IDs (project, worker, sensor, etc.). */
  connections: string[];
  /** Standards cited (NCh / DS / NFPA / NIOSH / ANSI). */
  references: string[];
}
