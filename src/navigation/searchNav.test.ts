import { describe, it, expect } from 'vitest';
import { searchNav } from './searchNav';
import { buildNavCatalog } from './navCatalog';

const tStub: any = (_k: string, fallback?: string): string => fallback ?? _k;
const cat = buildNavCatalog(tStub, { canUseExecutiveDashboard: true }, true);

describe('searchNav', () => {
  it('encuentra por substring del título', () => {
    const r = searchNav(cat, 'iper');
    expect(r.some((x) => x.item.path === '/matriz-iper')).toBe(true);
  });
  it('es insensible a mayúsculas y acentos', () => {
    const r = searchNav(cat, 'BITACORA');
    expect(r.some((x) => x.item.path === '/site-book')).toBe(true);
  });
  it('matchea por nombre de bloque (categoría)', () => {
    const r = searchNav(cat, 'emergencias');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.blockTitle.length > 0)).toBe(true);
  });
  it('query vacío retorna []', () => {
    expect(searchNav(cat, '   ')).toEqual([]);
  });
  it('respeta el limit', () => {
    expect(searchNav(cat, 'a', 3).length).toBeLessThanOrEqual(3);
  });
  it('prioriza match de prefijo del título sobre match interno', () => {
    const r = searchNav(cat, 'co'); // "Controles…", "Conducción…", "Comparar…", "Coach…"
    expect(r.length).toBeGreaterThan(0);
    // el primer resultado empieza con la query (prefijo) si existe alguno
    const anyPrefix = r.some((x) => normalizeStart(x.item.title));
    function normalizeStart(s: string): boolean {
      return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith('co');
    }
    if (anyPrefix) {
      expect(normalizeStart(r[0].item.title)).toBe(true);
    }
  });
});
