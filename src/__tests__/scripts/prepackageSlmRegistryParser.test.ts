/**
 * Smoke test for the prepackage-slm-models registry parser.
 *
 * The parser lives in `scripts/prepackage-slm-models.mjs` and uses
 * a deliberately conservative regex extraction of the TypeScript
 * source. If the registry shape changes, the parser MUST be updated
 * in the same PR — this test catches the drift.
 *
 * We re-implement the parser here so vitest can validate it without
 * loading the `.mjs` script (which runs `main()` at top level).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REGISTRY_PATH = resolve(__dirname, '../../services/slm/registry.ts');

interface ParsedModel {
  id: string;
  url: string | null;
  weightFilename: string | null;
  expectedSha256: string | null;
  prePackagedPath: string | null;
  size: number | null;
  companionFiles: Array<{ filename: string; size: number; expectedSha256: string }>;
}

function parseRegistry(): ParsedModel[] {
  const src = readFileSync(REGISTRY_PATH, 'utf8');
  const m = src.match(/MODEL_REGISTRY\s*:[^=]+=\s*\[([\s\S]+?)\]\s+as\s+const/);
  if (!m) throw new Error('cannot find MODEL_REGISTRY');
  const body = m[1]!;
  const models: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    buf += ch;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        models.push(buf.trim().replace(/^,\s*/, ''));
        buf = '';
      }
    }
  }
  return models
    .filter((s) => s.length > 0 && s.startsWith('{'))
    .map(parseModelLiteral)
    .filter((m): m is ParsedModel => Boolean(m));
}

function parseModelLiteral(literal: string): ParsedModel | null {
  const grab = (field: string): string | null => {
    const r = new RegExp(`${field}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`);
    const m = literal.match(r);
    return m ? m[1]! : null;
  };
  const grabNum = (field: string): number | null => {
    const r = new RegExp(`${field}\\s*:\\s*([0-9_]+)`);
    const m = literal.match(r);
    return m ? Number(m[1]!.replace(/_/g, '')) : null;
  };
  const id = grab('id');
  if (!id) return null;
  const companions: ParsedModel['companionFiles'] = [];
  const compMatch = literal.match(/companionFiles\s*:\s*\[([\s\S]*?)\]/);
  if (compMatch) {
    const objRe = /\{([^}]+)\}/g;
    let cm: RegExpExecArray | null;
    while ((cm = objRe.exec(compMatch[1]!)) !== null) {
      const obj = cm[1]!;
      const cFilename = obj.match(/filename\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      const cSize = Number(obj.match(/size\s*:\s*([0-9_]+)/)?.[1]?.replace(/_/g, '') ?? '0');
      const cSha = obj.match(/expectedSha256\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      if (cFilename && cSha) {
        companions.push({ filename: cFilename, size: cSize, expectedSha256: cSha });
      }
    }
  }
  return {
    id,
    url: grab('url'),
    weightFilename: grab('weightFilename'),
    expectedSha256: grab('expectedSha256'),
    prePackagedPath: grab('prePackagedPath'),
    size: grabNum('size'),
    companionFiles: companions,
  };
}

describe('prepackage-slm-models registry parser', () => {
  const models = parseRegistry();

  it('parses 3 models from the registry', () => {
    expect(models).toHaveLength(3);
  });

  it('parses Phi-3 mini with its companion .onnx_data', () => {
    const phi = models.find((m) => m.id === 'phi-3-mini')!;
    expect(phi).toBeDefined();
    expect(phi.url).toContain('huggingface.co');
    expect(phi.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(phi.weightFilename).toBe('onnx/model_q4.onnx');
    expect(phi.companionFiles).toHaveLength(1);
    expect(phi.companionFiles[0]!.filename).toBe('onnx/model_q4.onnx_data');
    expect(phi.companionFiles[0]!.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(phi.companionFiles[0]!.size).toBeGreaterThan(1_000_000_000);
  });

  it('parses Qwen 2.5 0.5B with prePackagedPath', () => {
    const qwen = models.find((m) => m.id === 'qwen-2.5-0.5b')!;
    expect(qwen).toBeDefined();
    expect(qwen.prePackagedPath).toBe('/models/qwen-2.5-0.5b/model_q4f16.onnx');
    expect(qwen.expectedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(qwen.companionFiles).toEqual([]);
  });

  it('parses Gemma with null hash (gated, no prePackagedPath)', () => {
    const gemma = models.find((m) => m.id === 'gemma-2-2b')!;
    expect(gemma).toBeDefined();
    expect(gemma.expectedSha256).toBeNull();
    expect(gemma.prePackagedPath).toBeNull();
  });

  it('only Qwen declares prePackagedPath today', () => {
    const withPrePack = models.filter((m) => m.prePackagedPath);
    expect(withPrePack).toHaveLength(1);
    expect(withPrePack[0]!.id).toBe('qwen-2.5-0.5b');
  });
});
