// SPDX-License-Identifier: MIT
// Barrel + registry for Bernoulli-driven Zettelkasten node generators.

import type { BernoulliNodeType } from '../types';

export { generateHidrantePressureNode } from './hidranteFireNetwork';
export { generateMistingNode } from './mistingDustSuppression';
export { generateScaffoldUpliftNode } from './scaffoldWindSuction';
export { generateConfinedSpaceVentNode } from './confinedSpaceHVAC';
export { generateGasLeakNode } from './gasLeakDetection';
export { generateMiningExtractionNode } from './miningVenturi';
export { generateHazmatPipeNode } from './hazmatPipePressure';
export { generateStructuralWindNode } from './structuralWindLoad';
export { generateRespiratorFatigueNode } from './respiratorFatigue';
export { generatePulmonaryNode } from './pulmonaryAltitude';
export { generateMicroWindNode } from './microWindEnergy';
export { generateSlopeStabilityNode } from './slopeStabilityAfterRain';
export { generateSlamMeshNode } from './slamPhotogrammetryNode';
export { generateDikeNode } from './dikeHydrostaticMonitor';
export { generateGasDispersionNode } from './gasDispersionCloud';

import { generateHidrantePressureNode } from './hidranteFireNetwork';
import { generateMistingNode } from './mistingDustSuppression';
import { generateScaffoldUpliftNode } from './scaffoldWindSuction';
import { generateConfinedSpaceVentNode } from './confinedSpaceHVAC';
import { generateGasLeakNode } from './gasLeakDetection';
import { generateMiningExtractionNode } from './miningVenturi';
import { generateHazmatPipeNode } from './hazmatPipePressure';
import { generateStructuralWindNode } from './structuralWindLoad';
import { generateRespiratorFatigueNode } from './respiratorFatigue';
import { generatePulmonaryNode } from './pulmonaryAltitude';
import { generateMicroWindNode } from './microWindEnergy';
import { generateSlopeStabilityNode } from './slopeStabilityAfterRain';
import { generateSlamMeshNode } from './slamPhotogrammetryNode';
import { generateDikeNode } from './dikeHydrostaticMonitor';
import { generateGasDispersionNode } from './gasDispersionCloud';

/**
 * Registry mapping each Bernoulli node type to its generator. Generators are
 * heterogeneous in their input shapes; the registry uses `unknown` for dynamic
 * dispatch and downstream callers must narrow types before invoking.
 */
export const bernoulliNodeRegistry: Record<BernoulliNodeType, (...args: never[]) => unknown> = {
  'hidrante-pressure': generateHidrantePressureNode as unknown as (...args: never[]) => unknown,
  'misting-suppression': generateMistingNode as unknown as (...args: never[]) => unknown,
  'scaffold-uplift': generateScaffoldUpliftNode as unknown as (...args: never[]) => unknown,
  'confined-space-vent': generateConfinedSpaceVentNode as unknown as (...args: never[]) => unknown,
  'gas-leak-anomaly': generateGasLeakNode as unknown as (...args: never[]) => unknown,
  'mining-extraction': generateMiningExtractionNode as unknown as (...args: never[]) => unknown,
  'hazmat-pipe': generateHazmatPipeNode as unknown as (...args: never[]) => unknown,
  'structural-wind': generateStructuralWindNode as unknown as (...args: never[]) => unknown,
  'respirator-fatigue': generateRespiratorFatigueNode as unknown as (...args: never[]) => unknown,
  'pulmonary-altitude': generatePulmonaryNode as unknown as (...args: never[]) => unknown,
  'micro-wind-energy': generateMicroWindNode as unknown as (...args: never[]) => unknown,
  'slope-stability': generateSlopeStabilityNode as unknown as (...args: never[]) => unknown,
  'slam-mesh': generateSlamMeshNode as unknown as (...args: never[]) => unknown,
  'dike-hydrostatic': generateDikeNode as unknown as (...args: never[]) => unknown,
  'gas-dispersion': generateGasDispersionNode as unknown as (...args: never[]) => unknown,
};
