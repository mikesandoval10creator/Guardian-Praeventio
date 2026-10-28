import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject, seedGraphNodes } from './fixtures/seed';

/**
 * Gate de adopción WASM — «E2E del consumidor/canvas bajo CSP y bundling
 * desplegados» (docs/runbooks/force-graph-client.md).
 *
 * Composición honesta de evidencia (3 clases distintas, sin sustituirse
 * entre sí):
 *   1. CSP DESPLEGADO real: el middleware Express (`securityHeaders.ts`)
 *      entrega `'wasm-unsafe-eval'` y `worker-src 'self' blob:` — sin esos
 *      directivas la mecánica wasm es imposible en producción.
 *   2. MECÁNICA WASM BAJO ESE CSP: módulo reproducible + worker acotado
 *      (vía `blob:`, la directiva real) ejecutan dentro de una página
 *      servida por Express con esas cabeceras. Si el CSP bloqueara
 *      `WebAssembly.instantiate`, el test falla con EvalError.
 *      El asset del módulo se sirve por route-interception con los bytes
 *      reproducibles locales (`npm run layout-wasm:build`): el módulo NO
 *      entra al bundle del producto hasta la adopción, y el interception
 *      mantiene el origen 'self' y el CSP real.
 *   3. CONSUMIDOR/CANVAS real: `/risk-network` → `<KnowledgeGraph/>` dibuja
 *      píxeles reales con datos sembrados (diferencial con/sin nodos).
 *
 * El contrato de eventos del layout client (loader → simulate.done →
 * render.done, cancelación, errores) está cubierto por
 * `src/components/shared/KnowledgeGraph.layout.test.tsx` (cliente inyectado);
 * la paridad numérica del algoritmo la cubre el harness diferencial del
 * laboratorio (11/11 casos).
 *
 * URLs: el CSP real vive en Express (:3000, webServer de playwright.config);
 * el bundle es el mismo `dist` que sirve el preview (:4173).
 *
 * Gated by E2E_FULL_STACK=1 (`npm run test:e2e:full`).
 */
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3000';
const MODULE_PATH = path.resolve(
  'wasm/force-graph-layout/target/wasm32-unknown-unknown/release/force_graph_layout.wasm',
);

/**
 * Worker acotado (equivalente al loader del laboratorio): recibe los bytes
 * del módulo por postMessage (sin fetch interno), instancia bajo el CSP
 * heredado de la página, y aplica los límites del contrato (2 MiB entrada,
 * 8 MiB salida, 128 MiB memoria externa) además del límite duro por módulo
 * (32 MiB, sección Memory).
 */
const BOUNDED_WORKER_SRC = [
  'self.onmessage = async ({ data }) => {',
  '  try {',
  '    const { instance } = await WebAssembly.instantiate(data.moduleBytes, {});',
  '    const k = instance.exports;',
  '    const input = new TextEncoder().encode(JSON.stringify(data.payload));',
  '    if (input.length > 2 * 1024 * 1024) throw new Error("input_limit");',
  '    const ptr = k.graph_alloc(input.length);',
  '    if (!ptr) throw new Error("input_limit");',
  '    let packed;',
  '    try {',
  '      if (k.memory.buffer.byteLength > 128 * 1024 * 1024) throw new Error("memory_limit");',
  '      new Uint8Array(k.memory.buffer, ptr, input.length).set(input);',
  '      packed = k.graph_layout(ptr, input.length);',
  '    } finally { k.graph_free(ptr, input.length); }',
  '    const address = Number(packed & 0xffffffffn);',
  '    const length = Number(packed >> 32n);',
  '    if (length > 8 * 1024 * 1024) throw new Error("output_limit");',
  '    let positions;',
  '    try {',
  '      const text = new TextDecoder().decode(new Uint8Array(k.memory.buffer, address, length));',
  '      positions = JSON.parse(text);',
  '    } finally { k.graph_free(address, length); }',
  '    self.postMessage({ ok: true, positions });',
  '  } catch (error) {',
  '    self.postMessage({ ok: false, error: String((error && error.message) || error) });',
  '  }',
  '};',
].join('\n');

const SEEDED_LAYOUT_PAYLOAD = {
  nodes: [
    { id: 'a', x: 0, y: 1 },
    { id: 'b', x: 20, y: 3 },
  ],
  links: [{ source: 'a', target: 'b' }],
};

function readModuleBytes(): Buffer | null {
  return fs.existsSync(MODULE_PATH) ? fs.readFileSync(MODULE_PATH) : null;
}

test.describe('WASM layout bajo CSP y bundling desplegados', () => {
  test('el CSP desplegado permite instanciación wasm y workers blob:', async ({ request }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const res = await request.get(`${API_BASE}/`);
    expect(res.status()).toBeLessThan(400);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp, 'CSP ausente en la respuesta de Express').not.toBe('');
    // WebAssembly.instantiate en página y en worker heredado.
    expect(csp, "script-src debe incluir 'wasm-unsafe-eval'").toContain("'wasm-unsafe-eval'");
    // Creación del worker de confianza vía blob:.
    expect(csp, "worker-src debe permitir 'self' y blob:").toContain("worker-src 'self' blob:");
  });

  test('módulo + worker acotado ejecutan bajo el CSP real (layout, determinisidad, caps)', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const bytes = readModuleBytes();
    test.skip(!bytes, 'Módulo wasm sin construir. Corre `npm run layout-wasm:build` primero.');

    await page.goto(`${API_BASE}/`);
    await page.route('**/force-graph-layout-e2e.wasm', (route) =>
      route.fulfill({ status: 200, contentType: 'application/wasm', body: bytes as unknown as Buffer }),
    );

    const result = await page.evaluate(
      async ({ workerSrc, payload }) => {
        const response = await fetch('/force-graph-layout-e2e.wasm');
        if (!response.ok) return { stage: 'fetch', error: `status ${response.status}` };
        const moduleBytes = await response.arrayBuffer();

        // Cap de entrada por módulo (8 MiB): devuelve null sin asignar.
        const { instance: direct } = await WebAssembly.instantiate(moduleBytes, {});
        const oversize = direct.exports.graph_alloc(9 * 1024 * 1024);
        const capRejects = Number(oversize) === 0;
        const normalPtr = direct.exports.graph_alloc(64);
        const capServes = Number(normalPtr) !== 0;
        direct.exports.graph_free(normalPtr, 64);

        // Techo duro de memoria (32 MiB) por la VM.
        let ceilingHolds = false;
        try {
          direct.exports.memory.grow(8192);
        } catch (error) {
          ceilingHolds = error instanceof RangeError;
        }

        // Layout completo a través del worker blob: bajo el CSP heredado.
        const run = (p: unknown) =>
          new Promise<{ ok: boolean; positions?: unknown; error?: string }>((resolve) => {
            const blobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
            const worker = new Worker(blobUrl);
            worker.onmessage = (event) => {
              resolve(event.data);
              worker.terminate();
              URL.revokeObjectURL(blobUrl);
            };
            worker.postMessage({ moduleBytes, payload: p });
          });

        const first = await run(payload);
        const second = await run(payload);
        return {
          stage: 'done',
          capRejects,
          capServes,
          ceilingHolds,
          first,
          second,
          deterministic:
            !!first.ok && !!second.ok && JSON.stringify(first.positions) === JSON.stringify(second.positions),
        };
      },
      { workerSrc: BOUNDED_WORKER_SRC, payload: SEEDED_LAYOUT_PAYLOAD },
    );

    expect(result.stage, `mecánica wasm falló: ${JSON.stringify(result)}`).toBe('done');
    expect(result.capRejects, 'graph_alloc debe devolver null sobre 8 MiB').toBe(true);
    expect(result.capServes, 'graph_alloc debe seguir sirviendo peticiones en cap').toBe(true);
    expect(result.ceilingHolds, 'memory.grow sobre 32 MiB debe lanzar RangeError').toBe(true);

    for (const run of [result.first, result.second]) {
      expect(run.ok, `worker falló: ${run.error}`).toBe(true);
      const positions = run.positions as Array<{ id: string; x: number; y: number }>;
      expect(positions).toHaveLength(2);
      expect(positions.map((p) => p.id)).toEqual(['a', 'b']);
      for (const p of positions) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect('z' in p).toBe(false);
      }
    }
    expect(result.deterministic, 'dos ejecuciones del mismo payload deben ser idénticas').toBe(true);
  });

  test('el consumidor/canvas real dibuja píxeles con datos sembrados (diferencial)', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject();
    const graphNodes = await seedGraphNodes(seed.projectId, [
      { id: 'e2e-wasm-n1', title: 'Riesgo de caída', type: 'Riesgo', connections: ['e2e-wasm-n2'] },
      { id: 'e2e-wasm-n2', title: 'Zona de excavación', type: 'Riesgo', connections: [] },
      { id: 'e2e-wasm-n3', title: 'Trabajador de prueba', type: 'Trabajador', connections: ['e2e-wasm-n1'] },
      { id: 'e2e-wasm-n4', title: 'EPP sin conexión', type: 'EPP', connections: [] },
    ]);
    try {
      await loginAsTestUser(page);
      // Superficie estándar del bundle (:4173, baseURL) — mismo origen que el
      // flujo de auth E2E probado por todos los demás specs de páginas. La
      // evidencia de CSP real vive en los dos tests anteriores (:3000).
      await page.goto('/risk-network');
      await signInBrowserViaCustomToken(page);

      // Pestaña 'graph' (default del componente; el click es idempotente).
      const tab = page.getByRole('button', { name: /grafo|graph/i }).first();
      if (await tab.isVisible().catch(() => false)) await tab.click();

      const canvas = page.locator('canvas').first();
      await canvas.waitFor({ state: 'visible', timeout: 20_000 });
      const box = await canvas.boundingBox();
      expect(box, 'canvas sin layout').toBeTruthy();
      expect(box!.width).toBeGreaterThan(100);
      expect(box!.height).toBeGreaterThan(100);

      // Diferencial real de píxeles: misma ruta, mismo viewport — solo
      // cambian los datos (4 nodos sembrados vs ninguno).
      const withNodes = await canvas.screenshot();
      expect(withNodes.byteLength).toBeGreaterThan(100);

      await graphNodes.cleanup();
      await page.reload();
      await signInBrowserViaCustomToken(page);
      const tabAfter = page.getByRole('button', { name: /grafo|graph/i }).first();
      if (await tabAfter.isVisible().catch(() => false)) await tabAfter.click();
      const canvasAfter = page.locator('canvas').first();
      await canvasAfter.waitFor({ state: 'visible', timeout: 20_000 });
      await expect
        .poll(async () => (await canvasAfter.screenshot()).byteLength, { timeout: 15_000 })
        .toBeGreaterThan(100);
      const withoutNodes = await canvasAfter.screenshot();

      expect(
        withNodes.equals(withoutNodes),
        'el canvas renderizado con nodos debe diferir del renderizado sin nodos',
      ).toBe(false);
    } finally {
      await graphNodes.cleanup();
      await seed.cleanup();
    }
  });
});
