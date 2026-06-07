// Guard — ZK-flow server routes MUST persist nodes via the Admin-SDK
// server writer (`makeServerWriteNodes` from server/services/serverZkNodeWriter),
// NEVER the BROWSER `writeNodes` (services/zettelkasten/persistence/writeNode),
// which does a relative `fetch` + IndexedDB `saveForSync` and therefore CANNOT
// persist inside the Express runtime — nodes silently never land and any edges
// dangle off non-existent nodes.
//
// This is the Codex P1 #650 bug class, found by the Phase-5 ZK integration audit
// in BOTH incidentFlow (createEdge omission, #728) and horometro (browser node
// writer). The node-persistence BEHAVIOR itself (the tri-write to
// zettelkasten_nodes + canonical nodes/) is covered by
// src/server/services/serverZkNodeWriter.test.ts; this guard pins the WIRING so
// the regression cannot return to any of these routes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

// Routes that run a Zettelkasten flow INSIDE Express (server runtime).
const ZK_FLOW_ROUTES = [
  'src/server/routes/incidentFlow.ts',
  'src/server/routes/horometro.ts',
  'src/server/routes/eppFlow.ts',
];

// Matches a named import of the BROWSER `writeNodes` from the persistence module
// (e.g. `import { writeNodes } from '../../services/zettelkasten/persistence/writeNode.js'`).
// `nodeIdFor` from the same module is fine; only the `writeNodes` symbol is banned.
const BROWSER_WRITENODES_IMPORT =
  /import\s*\{[^}]*\bwriteNodes\b[^}]*\}\s*from\s*['"][^'"]*persistence\/writeNode/;

describe('ZK-flow routes persist nodes server-side (Codex P1 #650 class)', () => {
  for (const file of ZK_FLOW_ROUTES) {
    it(`${file} injects the Admin-SDK server writer (makeServerWriteNodes)`, () => {
      expect(read(file)).toMatch(/makeServerWriteNodes/);
    });

    it(`${file} does NOT import the browser writeNodes (can't persist in Express)`, () => {
      expect(read(file)).not.toMatch(BROWSER_WRITENODES_IMPORT);
    });
  }
});
