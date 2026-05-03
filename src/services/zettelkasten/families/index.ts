// SPDX-License-Identifier: MIT
// Aggregator barrel for the 8 Zettelkasten v2 family registries.

import { CLIMATE_NODES } from './climateNodeRegistry';
import { PHYSICS_NODES } from './physicsNodeRegistry';
import { OHS_NORMATIVA_NODES } from './ohsNormativaNodeRegistry';
import { PERSONAL_EPP_NODES } from './personalEppNodeRegistry';
import { EVENTS_INCIDENTS_NODES } from './eventsIncidentsNodeRegistry';
import { ASSETS_FAENA_NODES } from './assetsFaenaNodeRegistry';
import { WORKFLOW_COMPLIANCE_NODES } from './workflowComplianceNodeRegistry';
import { AI_ANALYTICS_NODES } from './aiAnalyticsNodeRegistry';
import type { FamilyNodeSpec } from './climateNodeRegistry';

export type { FamilyNodeSpec } from './climateNodeRegistry';
export { CLIMATE_NODES } from './climateNodeRegistry';
export { PHYSICS_NODES } from './physicsNodeRegistry';
export { OHS_NORMATIVA_NODES } from './ohsNormativaNodeRegistry';
export { PERSONAL_EPP_NODES } from './personalEppNodeRegistry';
export { EVENTS_INCIDENTS_NODES } from './eventsIncidentsNodeRegistry';
export { ASSETS_FAENA_NODES } from './assetsFaenaNodeRegistry';
export { WORKFLOW_COMPLIANCE_NODES } from './workflowComplianceNodeRegistry';
export { AI_ANALYTICS_NODES } from './aiAnalyticsNodeRegistry';

export type FamilyName =
  | 'climate-environment'
  | 'physics-fluids'
  | 'ohs-normativa'
  | 'personal-epp'
  | 'events-incidents'
  | 'assets-faena'
  | 'workflow-compliance'
  | 'ai-analytics';

export const FAMILY_REGISTRIES: ReadonlyArray<{ family: FamilyName; nodes: ReadonlyArray<FamilyNodeSpec> }> = [
  { family: 'climate-environment', nodes: CLIMATE_NODES },
  { family: 'physics-fluids', nodes: PHYSICS_NODES },
  { family: 'ohs-normativa', nodes: OHS_NORMATIVA_NODES },
  { family: 'personal-epp', nodes: PERSONAL_EPP_NODES },
  { family: 'events-incidents', nodes: EVENTS_INCIDENTS_NODES },
  { family: 'assets-faena', nodes: ASSETS_FAENA_NODES },
  { family: 'workflow-compliance', nodes: WORKFLOW_COMPLIANCE_NODES },
  { family: 'ai-analytics', nodes: AI_ANALYTICS_NODES },
];

export const ALL_FAMILY_NODES: ReadonlyArray<FamilyNodeSpec> = FAMILY_REGISTRIES.flatMap((r) => r.nodes);

export const TOTAL_NODE_COUNT: number = ALL_FAMILY_NODES.length;
