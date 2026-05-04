// Sprint 19 — Bucket C / F-C01.
//
// findMedicalIcon was migrated from O(n) Array.find to a lazy-initialized Map
// for O(1) lookup. These tests pin the contract:
//   • known names return the entry
//   • unknown names return undefined
//   • repeated calls are stable (no per-call allocation surprises)
//   • registry shape (license/category) survives the index step

import { describe, it, expect } from 'vitest';
import { findMedicalIcon, MEDICAL_ICON_REGISTRY, hasAnyCcByIcons } from './iconLibrary';

describe('findMedicalIcon', () => {
  it('returns the entry for a known name', () => {
    const entry = findMedicalIcon('lung-pair');
    expect(entry?.publicPath).toBe('/icons/biology/lung-pair.svg');
    expect(entry?.license).toBe('CC0');
    expect(entry?.category).toBe('organs');
  });

  it('returns undefined for unknown name', () => {
    expect(findMedicalIcon('nonexistent')).toBeUndefined();
  });

  it('lookup is consistent across many calls (idempotent)', () => {
    for (let i = 0; i < 100; i++) {
      expect(findMedicalIcon('heart-anatomical')?.name).toBe('heart-anatomical');
    }
  });

  it('returns the same reference for the same input (no clone)', () => {
    const a = findMedicalIcon('helmet-safety');
    const b = findMedicalIcon('helmet-safety');
    expect(a).toBe(b);
  });

  it('every registry entry is reachable via the index', () => {
    for (const entry of MEDICAL_ICON_REGISTRY) {
      const looked = findMedicalIcon(entry.name);
      expect(looked).toBe(entry);
    }
  });
});

describe('hasAnyCcByIcons', () => {
  it('returns false while the registry is 100% CC0', () => {
    // Sprint 17c shipped CC0-only; this guards against silent license drift.
    expect(hasAnyCcByIcons()).toBe(false);
  });
});

describe('Sprint 20 Fase 1b — bundled icons offline-first', () => {
  it('every entry has a publicPath that resolves under /icons/biology/', () => {
    for (const entry of MEDICAL_ICON_REGISTRY) {
      expect(entry.publicPath.startsWith('/icons/biology/')).toBe(true);
    }
  });

  it('every SVG path has a known basename so the PNG candidate is computable', () => {
    for (const entry of MEDICAL_ICON_REGISTRY) {
      expect(entry.publicPath.endsWith('.svg')).toBe(true);
      // The MedicalIcon component computes pngPathFor(entry) by replacing the
      // trailing ".svg" with ".png". Pin the assumption.
      const pngCandidate = entry.publicPath.slice(0, -4) + '.png';
      expect(pngCandidate.endsWith('.png')).toBe(true);
      expect(pngCandidate.startsWith('/icons/biology/')).toBe(true);
    }
  });
});
