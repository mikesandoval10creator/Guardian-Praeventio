import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

describe('densidad por data-density', () => {
  it('define el ajuste compacto del dashboard', () => {
    expect(css).toMatch(/\[data-density="compact"\]/);
  });
  it('el modo compacto NO reduce el tamaño mínimo de fuente legible', () => {
    const block = css.slice(css.indexOf('[data-density="compact"]'));
    expect(block.slice(0, 400)).not.toMatch(/font-size:\s*(7|8|9|10|11)px/);
  });
});
