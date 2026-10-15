import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

for (const entry of ['src/components/compliance/ConsentBanner.tsx', 'src/pages/MyData.tsx']) {
  test(`${entry} bundles without importing Firebase Admin`, async () => {
    const result = await build({
      configFile: false,
      root: fileURLToPath(new URL('../', import.meta.url)),
      logLevel: 'silent',
      plugins: [{
        name: 'reject-server-sdk-in-browser',
        enforce: 'pre',
        resolveId(id) {
          if (id === 'firebase-admin' || id.startsWith('firebase-admin/')) {
            throw new Error(`Browser entry imports server-only SDK: ${id}`);
          }
        },
      }],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['es'] },
        rolldownOptions: {
          external: (id, importer) => !!importer && !id.startsWith('.') && !id.startsWith('/') &&
            !/^[A-Za-z]:/.test(id) && !id.startsWith('firebase-admin'),
        },
      },
    });
    assert.ok([result].flat().some(bundle => bundle.output.some(chunk => chunk.type === 'chunk')));
  });
}
