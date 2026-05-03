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

export interface RiskNodePayload {
  /** Node title (Spanish, short). */
  title: string;
  /** Multi-line Spanish description with calculation summary + standard reference. */
  description: string;
  /** Discriminator for the Zettelkasten edge router. */
  type: BernoulliNodeType;
  /** Severity inferred from threshold breach. */
  severity: RiskNodeSeverity;
  /** Pre-computed numeric outputs used by downstream alerting/UI. */
  metadata: Record<string, number | string | boolean | null>;
  /** Outgoing connections — entity IDs (project, worker, sensor, etc.). */
  connections: string[];
  /** Standards cited (NCh / DS / NFPA / NIOSH / ANSI). */
  references: string[];
}
