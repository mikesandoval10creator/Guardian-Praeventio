import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

describe('tipografía', () => {
  it('expone la utilidad opt-in .label-eyebrow', () => {
    expect(css).toMatch(/\.label-eyebrow\s*\{/);
    const b = css.slice(css.indexOf('.label-eyebrow'));
    expect(b).toMatch(/text-transform:\s*uppercase/);
    expect(b).toMatch(/letter-spacing/);
  });
  it('el cuerpo activa font-features de Inter', () => {
    expect(css).toMatch(/font-feature-settings/);
  });
});
