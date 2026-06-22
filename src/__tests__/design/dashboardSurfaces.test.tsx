// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../components/layout/RootLayout.tsx');
const sidebar = resolve(__dirname, '../../components/layout/Sidebar.tsx');

describe('Superficies más vistas — tokens, no zinc hardcodeado', () => {
  it('RootLayout no usa dark:bg-zinc-900 en los chips del header', () => {
    const src = readFileSync(root, 'utf8');
    expect(src).not.toMatch(/dark:bg-zinc-900/);
    expect(src).not.toMatch(/dark:text-zinc-400/);
  });
  it('Sidebar no usa dark:bg-zinc-* / dark:text-zinc-* en grupos e items', () => {
    const src = readFileSync(sidebar, 'utf8');
    expect(src).not.toMatch(/dark:bg-zinc-800\/30/);
    expect(src).not.toMatch(/text-zinc-800 dark:text-zinc-400/);
  });
});
