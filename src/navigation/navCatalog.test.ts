import { describe, it, expect } from 'vitest';
import { buildNavCatalog, type NavBlock } from './navCatalog';

const tStub: any = (_k: string, fallback?: string): string => fallback ?? _k;
const FREE = { canUseExecutiveDashboard: false };
const ORO = { canUseExecutiveDashboard: true };

const EXPECTED_ORDER = [
  'Principal', 'Gestión Operativa', 'Prevención y Riesgos', 'Salud Ocupacional',
  'Cumplimiento', 'Emergencias', 'Conocimiento', 'IA y Coach', 'Innovación', 'Administración',
];

describe('buildNavCatalog — fuente única de 10 bloques', () => {
  it('retorna 10 bloques en orden estable (no-admin)', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    expect(cat.map((b) => b.title)).toEqual(EXPECTED_ORDER);
  });

  it('cada bloque tiene id, icon e items[] no-vacío', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    for (const b of cat) {
      expect(typeof b.id).toBe('string');
      expect(b.id.length).toBeGreaterThan(0);
      expect(b.icon).toBeDefined();
      expect(Array.isArray(b.items)).toBe(true);
      expect(b.items.length).toBeGreaterThan(0);
    }
  });

  it('cada item tiene title + icon + path absoluto + color', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    for (const b of cat) {
      for (const it of b.items) {
        expect(it.title.length).toBeGreaterThan(0);
        expect(it.icon).toBeDefined();
        expect(it.path.startsWith('/')).toBe(true);
        expect(typeof it.color).toBe('string');
      }
    }
  });

  it('no hay rutas duplicadas dentro del mismo bloque', () => {
    const cat = buildNavCatalog(tStub, FREE, false);
    for (const b of cat) {
      const paths = b.items.map((i) => i.path);
      expect(new Set(paths).size, `bloque ${b.title} tiene rutas duplicadas`).toBe(paths.length);
    }
  });

  it('Administración crece con isAdmin (Panel B2D)', () => {
    const cat = buildNavCatalog(tStub, FREE, true);
    const admin = cat.find((b) => b.title === 'Administración')!;
    expect(admin.items.some((i) => i.path === '/admin/b2d')).toBe(true);
  });

  it('Dashboard Ejecutivo aparece solo con el feature oro+', () => {
    const free = buildNavCatalog(tStub, FREE, false).flatMap((b) => b.items.map((i) => i.path));
    const oro = buildNavCatalog(tStub, ORO, false).flatMap((b) => b.items.map((i) => i.path));
    expect(free).not.toContain('/executive-dashboard');
    expect(oro).toContain('/executive-dashboard');
  });

  it('preserva módulos vida-safety clave (no se pierden en el remapeo)', () => {
    const all = buildNavCatalog(tStub, ORO, true).flatMap((b) => b.items.map((i) => i.path));
    for (const p of ['/sif', '/lone-worker', '/stoppages', '/evacuation-dashboard',
                     '/emergency-brigade', '/restricted-zones', '/first-responder-map']) {
      expect(all, `falta la ruta vida-safety ${p}`).toContain(p);
    }
  });
});
