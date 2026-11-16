/**
 * Contract test for the standalone-script Gemini client helper.
 *
 * Mirrors `src/services/ai/geminiClientFactory.test.ts`. The TypeScript
 * factory and this JS mirror must pin the SAME API version — if they drift,
 * the application and the scripts would talk to different API versions for
 * the same models.
 *
 * Run: node --test scripts/_geminiClient.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { GEMINI_API_VERSION, createGeminiClient } from './_geminiClient.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS_FACTORY = path.join(
  here,
  '..',
  'src',
  'services',
  'ai',
  'geminiClientFactory.ts',
);

test('pins the Gemini Developer API version to v1beta', () => {
  assert.equal(GEMINI_API_VERSION, 'v1beta');
});

test('createGeminiClient forwards the API key and pins the version', () => {
  const calls = [];
  class FakeGenAI {
    constructor(options) {
      calls.push(options);
    }
  }

  createGeminiClient(FakeGenAI, { apiKey: 'my-secret-key' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, 'my-secret-key');
  assert.equal(calls[0].apiVersion, 'v1beta');
});

test('createGeminiClient never leaves apiVersion unset', () => {
  const calls = [];
  class FakeGenAI {
    constructor(options) {
      calls.push(options);
    }
  }

  createGeminiClient(FakeGenAI, { apiKey: 'k' });

  assert.notEqual(calls[0].apiVersion, undefined);
  assert.equal(typeof calls[0].apiVersion, 'string');
});

test('JS mirror and TypeScript factory pin the SAME version', async () => {
  const source = await readFile(TS_FACTORY, 'utf8');
  const match = source.match(
    /export const GEMINI_API_VERSION\s*=\s*['"]([^'"]+)['"]/,
  );

  assert.ok(match, 'TS factory must export GEMINI_API_VERSION');
  assert.equal(
    match[1],
    GEMINI_API_VERSION,
    'scripts/_geminiClient.mjs and src/services/ai/geminiClientFactory.ts must pin the same API version',
  );
});
