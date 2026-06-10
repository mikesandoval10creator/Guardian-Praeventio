// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 §P2.
// Tests del builder de menuGroups que se extrajo del Sidebar.

import { describe, it, expect } from 'vitest';
import {
  buildSidebarMenuGroups,
  type SubscriptionFeatureGates,
  type MenuGroup,
} from './sidebarMenuGroups';

// Stub minimal del TFunction que el builder consume.
// El builder solo invoca `t(key, fallback)` — el TFunction real tiene
// overloads más complejos pero acá basta con devolver el fallback.

const tStub: any = (_key: string, fallback?: string): string => fallback ?? _key;

const FREE_FEATURES: SubscriptionFeatureGates = {
  canUseExecutiveDashboard: false,
};

const ORO_FEATURES: SubscriptionFeatureGates = {
  canUseExecutiveDashboard: true,
};

describe('buildSidebarMenuGroups — Plan §P2', () => {
  describe('estructura básica', () => {
    it('retorna 5 grupos para user no-admin sin features', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      expect(groups).toHaveLength(5);
      // Orden estable, no random shuffle
      expect(groups[0].title).toBe('Centro de Mando');
      expect(groups[1].title).toBe('Inteligencia Artificial');
      expect(groups[2].title).toBe('Módulos Operativos');
      expect(groups[3].title).toBe('Salud Ocupacional');
      expect(groups[4].title).toBe('Configuración');
    });

    it('cada grupo tiene title + icon + items[] no-vacío', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      for (const g of groups) {
        expect(typeof g.title).toBe('string');
        expect(g.title.length).toBeGreaterThan(0);
        expect(typeof g.icon).toBe('object'); // LucideIcon es ForwardRefComponent
        expect(Array.isArray(g.items)).toBe(true);
        expect(g.items.length).toBeGreaterThan(0);
      }
    });

    it('cada item tiene title + icon + path + color', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      for (const g of groups) {
        for (const it of g.items) {
          expect(typeof it.title).toBe('string');
          expect(it.title.length).toBeGreaterThan(0);
          expect(it.icon).toBeDefined();
          expect(typeof it.path).toBe('string');
          expect(it.path.startsWith('/')).toBe(true);
          expect(typeof it.color).toBe('string');
        }
      }
    });
  });

  describe('feature gate canUseExecutiveDashboard', () => {
    it('NO incluye /executive-dashboard cuando feature=false', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).not.toContain('/executive-dashboard');
    });

    it('SÍ incluye /executive-dashboard cuando feature=true', () => {
      const groups = buildSidebarMenuGroups(tStub, ORO_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/executive-dashboard');
    });

    it('el item executive_dashboard vive en el primer grupo (Centro de Mando)', () => {
      const groups = buildSidebarMenuGroups(tStub, ORO_FEATURES, false);
      const commandCenter = groups[0];
      const paths = commandCenter.items.map((i) => i.path);
      expect(paths).toContain('/executive-dashboard');
    });
  });

  describe('admin gate', () => {
    it('NO agrega grupo Admin para non-admin', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const titles = groups.map((g) => g.title);
      expect(titles).not.toContain('Admin');
    });

    it('agrega grupo Admin como ÚLTIMO grupo cuando isAdmin=true', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, true);
      expect(groups).toHaveLength(6);
      const last = groups[groups.length - 1];
      expect(last.title).toBe('Admin');
      expect(last.items).toHaveLength(1);
      expect(last.items[0].path).toBe('/admin/b2d');
    });
  });

  describe('cumplimiento normativo cubierto', () => {
    it('expone el path /cphs (DS 54 — Comité Paritario)', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/cphs');
      expect(allPaths).toContain('/cphs/draft-minute');
    });

    it('expone el path /fatigue (DS 594 art. 102 + Código Trabajo art. 38)', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/fatigue');
    });

    it('expone el path /evacuation-dashboard (Sprint K vidas críticas)', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/evacuation-dashboard');
    });

    it('expone el path /confidential-reports (Ley Karin 21.643)', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/confidential-reports');
    });

    it('expone el path /my-data (Ley 19.628 LPD)', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/my-data');
    });

    it('expone el path /portable-history (Ley 19.628 data portability)', () => {
      const groups = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(allPaths).toContain('/portable-history');
    });
  });

  describe('integridad', () => {
    it('paths son únicos cross-groups (no entries duplicadas)', () => {
      const groups = buildSidebarMenuGroups(tStub, ORO_FEATURES, true);
      const paths = groups.flatMap((g) => g.items.map((i) => i.path));
      expect(new Set(paths).size).toBe(paths.length);
    });

    it('titles de grupos son únicos', () => {
      const groups = buildSidebarMenuGroups(tStub, ORO_FEATURES, true);
      const titles = groups.map((g) => g.title);
      expect(new Set(titles).size).toBe(titles.length);
    });

    it('idempotente: dos calls con mismos params producen lista equivalente', () => {
      const a = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      const b = buildSidebarMenuGroups(tStub, FREE_FEATURES, false);
      expect(a.length).toBe(b.length);
      // Verifica paths matchean (structural equality sin comparar refs de icons)
      const aPaths = a.flatMap((g: MenuGroup) => g.items.map((i) => i.path));
      const bPaths = b.flatMap((g: MenuGroup) => g.items.map((i) => i.path));
      expect(aPaths).toEqual(bPaths);
    });
  });
});
