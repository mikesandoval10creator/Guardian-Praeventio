import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

// Extrae el bloque de un selector de modo: `.driving { ... }`
// Uses a regex to find the selector followed by whitespace and `{` to avoid
// matching partial occurrences (e.g. `.dark` inside `@custom-variant`).
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*\\{');
  const match = re.exec(css);
  expect(match, `selector ${selector} no encontrado`).not.toBeNull();
  const i = match!.index;
  const start = css.indexOf('{', i);
  let depth = 0, end = start;
  for (let p = start; p < css.length; p++) {
    if (css[p] === '{') depth++;
    else if (css[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  return css.slice(start, end);
}

const REQUIRED = [
  '--bg-canvas', '--bg-surface', '--bg-elevated',
  '--text-primary', '--text-secondary', '--text-muted',
  '--accent-primary', '--accent-warning', '--accent-hazard',
  '--accent-success', '--border-default',
];

describe('color tokens — los 4 modos definen todos los roles', () => {
  for (const sel of [':root', '.dark', '.driving', '.emergency']) {
    it(`${sel} define todos los tokens requeridos`, () => {
      const b = block(sel);
      for (const t of REQUIRED) expect(b, `${sel} falta ${t}`).toContain(t + ':');
    });
  }
});

describe('Conducción = oscuro-cálido (batería)', () => {
  const d = block('.driving');
  it('bg-canvas near-black cálido', () => expect(d).toContain('--bg-canvas: #0d0a05'));
  it('text-primary cálido', () => expect(d).toContain('--text-primary: #fff7e9'));
  it('marca teal glanceable', () => expect(d).toContain('--accent-primary: #5fd9c8'));
  it('atención dorada', () => expect(d).toContain('--accent-warning: #ffce5a'));
});
