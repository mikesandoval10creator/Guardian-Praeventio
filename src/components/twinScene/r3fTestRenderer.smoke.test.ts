// Sprint 48 E.2 — smoke test confirma que @react-three/test-renderer
// está instalado y exporta el módulo principal. La migración completa
// de tests a renderer real requiere afinar vitest pool config (worker
// hangs en algunos contextos jsdom + WebGL stubs) — fuera de scope para
// esta PR.

import { describe, it, expect } from 'vitest';

describe('Sprint 48 E.2 — @react-three/test-renderer smoke', () => {
  it('paquete importable y exporta create()', async () => {
    const mod = await import('@react-three/test-renderer');
    // El default export es el renderer; algunas versiones lo exportan como named.
    const renderer = (mod as { default?: { create?: unknown }; create?: unknown }).default ??
      (mod as unknown as { create?: unknown });
    expect(renderer).toBeDefined();
    // Existe `create` (la API que usaría una migración futura).
    expect(typeof (renderer as { create?: unknown }).create).toBe('function');
  });
});
