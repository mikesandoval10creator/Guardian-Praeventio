// Contract test — §2.15 cierre Fase C.3 (2026-05-21).
//
// Gate de regresión: el server route POST /api/zettelkasten/nodes y el
// componente cliente RiskNodeMarkers deben usar el canonical materializer
// (Sprint 39 Fase D.8.c) en lugar de las colecciones legacy desconectadas
// (zettelkasten_nodes global, tenants/{tid}/zettelkasten_nodes subcolección
// no escrita).
//
// El materializer ya existía como función pura desde Sprint 39 pero NUNCA
// estaba wireado a runtime — un nodo creado por Bernoulli aterrizaba en
// zettelkasten_nodes y nunca aparecía en KG ni Digital Twin. Este test
// previene que el wire se pierda en futuros refactors.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Zettelkasten canonical materializer wired — §2.15 Fase C.3', () => {
  it('src/server/routes/zettelkasten.ts importa materializeNode + canonicalNodePath', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/server/routes/zettelkasten.ts'),
      'utf8',
    );
    expect(src).toMatch(/from\s+['"][^'"]*canonical\/materializer/);
    expect(src).toContain('materializeNode');
    expect(src).toContain('canonicalNodePath');
  });

  it('src/server/routes/zettelkasten.ts hace dual-write (zettelkasten_nodes + nodes canónico)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/server/routes/zettelkasten.ts'),
      'utf8',
    );
    // Legacy write se mantiene (backwards compat).
    expect(src).toContain(`db.collection('zettelkasten_nodes')`);
    // Canonical write llamando al materializer.
    expect(src).toContain('materializeNode({');
    expect(src).toContain('canonicalNodePath({');
    // El write canonical es defensivo (try/catch independiente del legacy).
    expect(src).toMatch(/zettelkasten_canonical_dual_write_failed/);
  });

  it('RiskNodeMarkers.tsx lee de la collection canónica `nodes` (no de la subcolección legacy)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/digital-twin/RiskNodeMarkers.tsx'),
      'utf8',
    );
    // Patrón antiguo (subcolección no escrita) debe estar removido.
    expect(src).not.toMatch(/`tenants\/\$\{tenantId\}\/zettelkasten_nodes`/);
    // Patrón nuevo: collection 'nodes' + where tenantId + where projectId.
    expect(src).toMatch(/collection\(db,\s*['"]nodes['"]\)/);
    expect(src).toMatch(/where\(['"]tenantId['"]/);
    expect(src).toMatch(/where\(['"]projectId['"]/);
  });

  it('firestore.indexes.json declara índice nodes (tenantId, projectId, createdAt desc)', () => {
    const idx = JSON.parse(
      readFileSync(resolve(process.cwd(), 'firestore.indexes.json'), 'utf8'),
    ) as {
      indexes: Array<{
        collectionGroup: string;
        fields: Array<{ fieldPath: string; order: 'ASCENDING' | 'DESCENDING' }>;
      }>;
    };
    const nodesIndexes = idx.indexes.filter((i) => i.collectionGroup === 'nodes');
    const composite = nodesIndexes.find((i) => {
      const paths = i.fields.map((f) => f.fieldPath);
      return (
        paths.includes('tenantId') &&
        paths.includes('projectId') &&
        paths.includes('createdAt')
      );
    });
    expect(composite, 'índice tenantId+projectId+createdAt requerido para RiskNodeMarkers').toBeDefined();
    const createdAtField = composite!.fields.find((f) => f.fieldPath === 'createdAt');
    expect(createdAtField?.order).toBe('DESCENDING');
  });

  it('materializer.ts sigue siendo una función pura (sin firebase-admin/firebase imports)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/services/zettelkasten/canonical/materializer.ts'),
      'utf8',
    );
    // El materializer NO debe importar firebase ni firebase-admin — debe
    // permanecer puro para que el wire del server route + futuros
    // consumidores (Cloud Function trigger) lo usen sin dragar SDK pesado.
    expect(src).not.toMatch(/from\s+['"]firebase-admin/);
    expect(src).not.toMatch(/from\s+['"]firebase['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*\/firebase['"]/);
  });
});
