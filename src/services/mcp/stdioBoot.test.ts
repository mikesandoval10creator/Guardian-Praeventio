import { describe, it, expect } from 'vitest';

// Smoke test del boot wrapper — solo verifica que el módulo cargue y
// que las exports principales existan. El boot real (que conecta
// stdio) se prueba via subproceso Node en e2e/CI, no en vitest.

describe('stdioBoot smoke import', () => {
  it('módulo carga sin tirar errores top-level', async () => {
    const mod = await import('./stdioBoot.js');
    expect(typeof mod.bootStdioMcpServer).toBe('function');
    expect(typeof mod.assertSdkAvailable).toBe('function');
  });

  it('assertSdkAvailable no lanza cuando la dep está instalada', async () => {
    const mod = await import('./stdioBoot.js');
    expect(() => mod.assertSdkAvailable()).not.toThrow();
  });
});
