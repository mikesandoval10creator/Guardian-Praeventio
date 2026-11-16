import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Architectural guard: no production module may read the Gemini API key at
 * MODULE SCOPE.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 * ------------------------------------
 * 31 modules used to start with `const API_KEY = process.env.GEMINI_API_KEY;`.
 * A module-scope read freezes the credential at import time, which silently
 * defeats the whole "bring your own LLM subscription" direction: the app would
 * keep using the process-level key no matter whose credential the request
 * carries.
 *
 * The failure mode is invisible in review and invisible in unit tests (the
 * value is still correct at boot), so it needs a mechanical check.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC_ROOT = join(HERE, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(SRC_ROOT).filter((f) => {
  const rel = relative(SRC_ROOT, f).replace(/\\/g, '/');
  if (rel.includes('node_modules')) return false;
  if (/\.(test|spec)\.tsx?$/.test(rel)) return false;
  if (rel.includes('__tests__')) return false;
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
});

/** A module-scope read: the declaration sits at brace depth 0. */
const MODULE_SCOPE_DECL =
  /^[ \t]*(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*process\.env\.GEMINI_API_KEY\b/m;

describe('Gemini API key boundary', () => {
  it('finds production source files to scan', () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
  });

  it('no production module reads GEMINI_API_KEY at module scope', () => {
    const offenders: string[] = [];

    for (const file of SOURCE_FILES) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split(/\r?\n/);

      // Track brace depth so a declaration nested inside a function body does
      // not count as a module-scope read.
      let depth = 0;
      lines.forEach((line, index) => {
        if (depth === 0 && MODULE_SCOPE_DECL.test(line)) {
          offenders.push(`${relative(SRC_ROOT, file).replace(/\\/g, '/')}:${index + 1}`);
        }
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
      });
    }

    expect(
      offenders,
      `Module-scope GEMINI_API_KEY reads freeze the credential at import time. ` +
        `Resolve it at call time via getGeminiApiKey() from src/services/ai/geminiApiKey.ts. Offenders:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('resolves the key through the single seam', () => {
    // The seam itself is the only place allowed to touch process.env.
    const seam = readFileSync(join(SRC_ROOT, 'services', 'ai', 'geminiApiKey.ts'), 'utf8');
    expect(seam).toContain('process.env.GEMINI_API_KEY');
    expect(seam).toContain('export function getGeminiApiKey');
  });
});
