// SPDX-License-Identifier: MIT
// Static catalog for the PHYSICS & FLUIDS family (60 nodes).
// 15 use cases x 4 child nodes (q-dynamic, dp-static, q-flow, alert).
// Generators live in ../bernoulli/. This catalog is the canonical taxonomy.

import type { FamilyNodeSpec } from './climateNodeRegistry';

interface BernoulliCase {
  readonly prefix: string;
  readonly label: string;
  readonly producer: string;
  readonly consumers: readonly string[];
  readonly source: string;
}

const BERNOULLI_CASES: ReadonlyArray<BernoulliCase> = [
  { prefix: 'hydrant', label: 'red de hidrantes', producer: 'src/services/zettelkasten/bernoulli/hidranteFireNetwork.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'NFPA-14' },
  { prefix: 'misting', label: 'supresion de polvo por misting', producer: 'src/services/zettelkasten/bernoulli/mistingDustSuppression.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'DS-132' },
  { prefix: 'uplift', label: 'succion en cubierta/lona', producer: 'src/services/zettelkasten/bernoulli/scaffoldWindSuction.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'NCh-432' },
  { prefix: 'hvac', label: 'ventilacion de espacio confinado', producer: 'src/services/zettelkasten/bernoulli/confinedSpaceHVAC.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'OSHA-1910-146' },
  { prefix: 'gasleak', label: 'fuga de gas industrial', producer: 'src/services/zettelkasten/bernoulli/gasLeakDetection.ts', consumers: ['src/pages/EmergenciaAvanzada.tsx'], source: 'DS-66' },
  { prefix: 'mineventuri', label: 'venturi minero', producer: 'src/services/zettelkasten/bernoulli/miningVenturi.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'DS-132' },
  { prefix: 'hazmatpipe', label: 'tuberia hazmat', producer: 'src/services/zettelkasten/bernoulli/hazmatPipePressure.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'NFPA-30' },
  { prefix: 'windload', label: 'carga de viento sobre estructura', producer: 'src/services/zettelkasten/bernoulli/structuralWindLoad.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'NCh-432' },
  { prefix: 'respirator', label: 'caida de presion en respirador', producer: 'src/services/zettelkasten/bernoulli/respiratorFatigue.ts', consumers: ['src/pages/BioAnalysis.tsx'], source: 'NIOSH-42-CFR-84' },
  { prefix: 'altitude-resp', label: 'respiracion en altura geografica', producer: 'src/services/zettelkasten/bernoulli/pulmonaryAltitude.ts', consumers: ['src/pages/BioAnalysis.tsx'], source: 'DS-594' },
  { prefix: 'microwind', label: 'micro-eolica', producer: 'src/services/zettelkasten/bernoulli/microWindEnergy.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'IEC-61400-2' },
  { prefix: 'soilflow', label: 'flujo hidrostatico de suelos', producer: 'src/services/zettelkasten/bernoulli/slopeStabilityAfterRain.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'Eurocodigo-7' },
  { prefix: 'slamflow', label: 'simulacion de flujo en gemelo digital SLAM', producer: 'src/services/zettelkasten/bernoulli/slamPhotogrammetryNode.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'internal' },
  { prefix: 'damflow', label: 'flujo en dique con piezometros', producer: 'src/services/zettelkasten/bernoulli/dikeHydrostaticMonitor.ts', consumers: ['src/pages/RiskNetwork.tsx'], source: 'DS-248' },
  { prefix: 'plumeflow', label: 'dispersion de pluma de gas', producer: 'src/services/zettelkasten/bernoulli/gasDispersionCloud.ts', consumers: ['src/pages/EmergenciaAvanzada.tsx'], source: 'Pasquill-Gifford' },
];

const SUFFIX_DESCRIPTIONS: Record<string, string> = {
  'q-dynamic': 'Presion dinamica q = 1/2 rho v^2 (Pa).',
  'dp-static': 'Delta P estatico entre dos puntos (Pa).',
  'q-flow': 'Caudal volumetrico Q (m3/s).',
  'alert': 'Alerta booleana al cruzar umbral, con recomendacion.',
};

function buildPhysicsNodes(): FamilyNodeSpec[] {
  const out: FamilyNodeSpec[] = [];
  for (const c of BERNOULLI_CASES) {
    for (const suffix of ['q-dynamic', 'dp-static', 'q-flow', 'alert'] as const) {
      out.push({
        id: `${c.prefix}-${suffix}`,
        description: `${c.label} — ${SUFFIX_DESCRIPTIONS[suffix]}`,
        producerHint: c.producer,
        consumerHints: c.consumers,
        source: c.source,
      });
    }
  }
  return out;
}

export const PHYSICS_NODES: ReadonlyArray<FamilyNodeSpec> = buildPhysicsNodes();
