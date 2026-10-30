import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../download-mediapipe-models.mjs';

test('isMainModule handles Windows paths with spaces (URL-encoded)', () => {
  const argv1 = 'M:\\Guardian Praeventio\\wt-knowledge-graph-layout-20261027\\scripts\\download-mediapipe-models.mjs';
  const importMetaUrl = pathToFileURL(argv1).href;
  assert.ok(importMetaUrl.includes('%20'), 'la URL debe codificar espacios');
  assert.equal(isMainModule(importMetaUrl, argv1), true);
});

test('isMainModule is false for imports and empty argv', () => {
  assert.equal(isMainModule('file:///M:/x/scripts/download-mediapipe-models.mjs', undefined), false);
  assert.equal(isMainModule('file:///M:/x/scripts/download-mediapipe-models.mjs', 'M:\\x\\other.mjs'), false);
});
