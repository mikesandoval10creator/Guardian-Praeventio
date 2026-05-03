// SPDX-License-Identifier: MIT
// One-shot generator for ZETTELKASTEN_V2_NODES_FULL.md from family registries.
import * as fs from 'fs';
import { FAMILY_REGISTRIES, ALL_FAMILY_NODES, TOTAL_NODE_COUNT } from '../src/services/zettelkasten/families/index';

const lines: string[] = [];
lines.push('# Zettelkasten v2 — Catalogo Completo de los 512 Nodos');
lines.push('');
lines.push('> Generado automaticamente desde `src/services/zettelkasten/families/*`.');
lines.push('> Cada fila = un tipo de nodo. Producer/Consumer = puntos de acoplamiento sugeridos.');
lines.push('> Total: ' + TOTAL_NODE_COUNT + ' nodos en 8 familias.');
lines.push('');
for (const reg of FAMILY_REGISTRIES) {
  lines.push('## Familia: ' + reg.family + ' (' + reg.nodes.length + ' nodos)');
  lines.push('');
  lines.push('| # | ID | Descripcion | Producer | Consumers | Source |');
  lines.push('|---|----|-------------|----------|-----------|--------|');
  reg.nodes.forEach((n, i) => {
    lines.push(
      '| ' + (i + 1) + ' | `' + n.id + '` | ' + n.description + ' | `' + n.producerHint + '` | ' +
      n.consumerHints.map((c) => '`' + c + '`').join(', ') + ' | ' + n.source + ' |',
    );
  });
  lines.push('');
}
lines.push('---');
lines.push('');
lines.push('## Reglas de Auto-Coupling (resumen)');
lines.push('');
lines.push('Las reglas detalladas viven en `ZETTELKASTEN_V2_SPEC.md` seccion 4. Este catalogo provee las IDs canonicas que dichas reglas referencian.');
lines.push('');
lines.push('Resumen por familia:');
lines.push('- **PHYSICS & FLUIDS**: cada use case Bernoulli emite 4 nodos hijos compartiendo `parentBernoulliRunId`. Ver §4.1 spec.');
lines.push('- **CLIMATE**: `seismic-event` precede `seismic-aftershock-window` (72h). `gas-dispersion-plume` tiene instancia → plume-zone-{red,orange,yellow}.');
lines.push('- **OHS & NORMATIVA**: cada cuerpo legal tronco `has_instance` → articulos especificos (e.g. `norma-DS-594` → `norma-DS-594-Art-32`).');
lines.push('- **PERSONAL & EPP**: `worker-altitude-clearance` requires `exam-altura-geografica`; `epp-respirator-*` regulated_by `norma-NIOSH-42-CFR-84`.');
lines.push('- **EVENTS**: `man-down-confirmed` precedes `medevac-dispatched` y `diat`.');
lines.push('- **ASSETS**: `asset-grua-torre` requires `cert-rigger` y `cert-grua`; sensores IoT alimentan reglas Bernoulli.');
lines.push('- **WORKFLOW**: `permit-trabajo-altura` requires `epp-harness`, `epp-helmet`, `cert-altura`, `exam-vista`.');
lines.push('- **AI**: `gran-maestro-output-json` references `env-context-snapshot` y `rag-chunk-retrieved` por cita.');
lines.push('');
lines.push('## Citas de Fuentes (campo source)');
lines.push('');
const sources = new Set<string>();
for (const n of ALL_FAMILY_NODES) sources.add(n.source);
for (const s of [...sources].sort()) lines.push('- ' + s);
lines.push('');
lines.push('---');
lines.push('');
lines.push('Documento sincronizado con commit. Toda divergencia entre este archivo y los registries TS debe resolverse re-generando este markdown via `npx tsx scripts/generateZettelkastenMarkdown.ts`.');
fs.writeFileSync('ZETTELKASTEN_V2_NODES_FULL.md', lines.join('\n') + '\n');
console.log('wrote ZETTELKASTEN_V2_NODES_FULL.md with', lines.length, 'lines');
