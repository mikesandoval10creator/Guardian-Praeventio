// Contract test — §2.28 (2026-05-21).
//
// Directiva usuario inviolable: el digital twin y la producción de la
// maqueta 3D deben ejecutarse ON-DEVICE (celular del usuario), no en
// servidores con GPU pagada (COLMAP / Modal / RealityCapture / Hyper3D
// están todos DESCARTADOS).
//
// Razón: reducir costos de infraestructura para reinvertir en otras
// funciones del producto. Mismo pattern que §2.7 Vertex Trainer descartado
// y §2.12 Stripe descartado.
//
// Este test estático bloquea en CI cualquier re-introducción de:
//   1. cloud-run/photogrammetry-worker/ (entire dir)
//   2. src/services/digitalTwin/photogrammetry/colmapAdapter.ts | .test.ts
//   3. src/services/digitalTwin/photogrammetry/modalAdapter.ts | .test.ts
//   4. src/server/routes/photogrammetry.ts | .test.ts
//   5. Refs a PHOTOGRAMMETRY_WORKER_URL / PHOTOGRAMMETRY_WORKER_TOKEN
//      / MODAL_SUBMIT_URL / MODAL_STATUS_URL / MODAL_TOKEN en deploy.yml
//   6. Import de photogrammetryRouter en server.ts
//
// Si alguien intenta reintroducir cualquiera de estos, el test falla y
// debe documentar opt-in B2D enterprise add-on en TODO.md §2.28 antes
// de poder pasar (lo cual gatea explícitamente la decisión).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const exists = (rel: string) => existsSync(resolve(repoRoot, rel));
const read = (rel: string) =>
  exists(rel) ? readFileSync(resolve(repoRoot, rel), 'utf8') : null;

describe('§2.28 — server-side photogrammetry DESCARTADA (on-device only)', () => {
  it('cloud-run/photogrammetry-worker/ no existe (eliminado)', () => {
    expect(exists('cloud-run/photogrammetry-worker')).toBe(false);
    expect(exists('cloud-run/photogrammetry-worker/Dockerfile')).toBe(false);
    expect(exists('cloud-run/photogrammetry-worker/cloudbuild.yaml')).toBe(false);
  });

  it('src/services/digitalTwin/photogrammetry/colmapAdapter.ts no existe', () => {
    expect(exists('src/services/digitalTwin/photogrammetry/colmapAdapter.ts')).toBe(false);
    expect(exists('src/services/digitalTwin/photogrammetry/colmapAdapter.test.ts')).toBe(false);
  });

  it('src/services/digitalTwin/photogrammetry/modalAdapter.ts no existe', () => {
    expect(exists('src/services/digitalTwin/photogrammetry/modalAdapter.ts')).toBe(false);
    expect(exists('src/services/digitalTwin/photogrammetry/modalAdapter.test.ts')).toBe(false);
  });

  it('src/server/routes/photogrammetry.ts no existe', () => {
    expect(exists('src/server/routes/photogrammetry.ts')).toBe(false);
    expect(exists('src/server/routes/photogrammetry.test.ts')).toBe(false);
  });

  it('server.ts no importa photogrammetryRouter', () => {
    const content = read('server.ts');
    expect(content, 'server.ts must exist').not.toBeNull();
    expect(content!).not.toMatch(/import\s+photogrammetryRouter/);
    expect(content!).not.toMatch(/app\.use\(['"]\/api\/photogrammetry/);
  });

  it('deploy.yml no referencia PHOTOGRAMMETRY_WORKER_URL ni MODAL_*_URL', () => {
    const content = read('.github/workflows/deploy.yml');
    expect(content, 'deploy.yml must exist').not.toBeNull();
    // En el bloque env_vars que se pasa al deploy productivo:
    // (notar que pueden quedar refs comentadas explicando por qué se removieron — eso es OK,
    //  solo bloqueamos refs ACTIVAS que sean parte del input del deploy)
    expect(content!).not.toMatch(/^\s*PHOTOGRAMMETRY_WORKER_URL=/m);
    expect(content!).not.toMatch(/^\s*MODAL_SUBMIT_URL=/m);
    expect(content!).not.toMatch(/^\s*MODAL_STATUS_URL=/m);
    expect(content!).not.toMatch(/^\s*PHOTOGRAMMETRY_WORKER_TOKEN=/m);
    expect(content!).not.toMatch(/^\s*MODAL_TOKEN=/m);
  });
});

describe('§2.28 — mockAdapter conservado para tests UI sin device', () => {
  it('mockAdapter.ts existe (path on-device tests)', () => {
    expect(exists('src/services/digitalTwin/photogrammetry/mockAdapter.ts')).toBe(true);
  });

  it('types.ts marca colmap/reality-capture/hyper3d/meshroom como DESCARTADO', () => {
    const content = read('src/services/digitalTwin/photogrammetry/types.ts');
    expect(content, 'types.ts must exist').not.toBeNull();
    // Documentación crítica para devs futuros — debe seguir marcando descartado.
    expect(content!).toMatch(/DESCARTADO/);
    expect(content!).toMatch(/on-device-webxr/);
  });
});

describe('§2.28 — directiva on-device documentada en TODO', () => {
  it('TODO.md contiene §2.28 con directiva on-device', () => {
    const content = read('TODO.md');
    expect(content, 'TODO.md must exist').not.toBeNull();
    expect(content!).toMatch(/2\.28/);
    expect(content!).toMatch(/on-device|ON-DEVICE/);
    // Debe mencionar el stack on-device como path productivo
    expect(content!).toMatch(/WebXR/i);
  });
});

describe('§2.28 — no hay caller productivo de /api/photogrammetry en src/', () => {
  // Fix 2026-05-22: tras descartar el backend, `DigitalTwinFaena.tsx`
  // seguía llamando `apiCall('/api/photogrammetry/jobs')` (refreshJobs +
  // handleSubmit) y producía 404 silencioso en cada render. Este gate
  // impide que regrese.
  //
  // Permitimos refs solo en:
  //  1. comentarios documentando el descarte (regex no se molesta — los
  //     captura, pero los assertions de abajo verifican que NO HAY
  //     llamadas activas, no menciones literales)
  //  2. el contract test mismo
  //  3. server.ts (sólo comentarios explicativos del descarte)
  //  4. health.ts (probe opcional contra worker externo si alguien lo
  //     habilita por env var en un sidecar futuro — no es un endpoint
  //     del producto)
  it('ningún archivo bajo src/ contiene `apiCall("/api/photogrammetry"`', () => {
    const sample = [
      'src/pages/DigitalTwinFaena.tsx',
    ];
    for (const rel of sample) {
      const content = read(rel);
      expect(content, `${rel} must exist`).not.toBeNull();
      // No debe haber NINGUNA llamada activa apiCall/fetch a /api/photogrammetry/*.
      expect(content!).not.toMatch(/apiCall<[^>]+>\(`?\/api\/photogrammetry/);
      expect(content!).not.toMatch(/fetch\(`?\/api\/photogrammetry/);
      // tampoco la sección de jobs debe construir el URL al server.
      expect(content!).not.toMatch(/'\/api\/photogrammetry\/jobs/);
    }
  });
});
