// Sprint 19 — Bucket C / F-C01.
// Sprint 20 — Fase 1b: medical icons hosted on Praeventio server (PNG via CDN
// with local SVG fallback). New tests pin the resolveIconUrl contract.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  findMedicalIcon,
  MEDICAL_ICON_REGISTRY,
  hasAnyCcByIcons,
  resolveIconUrl,
  readMedicalIconsBaseUrl,
} from './iconLibrary';

describe('findMedicalIcon', () => {
  it('returns the entry for a known name', () => {
    const entry = findMedicalIcon('lung-pair');
    expect(entry?.publicPath).toBe('/icons/biology/lung-pair.svg');
    expect(entry?.license).toBe('CC0');
    expect(entry?.category).toBe('organs');
    expect(entry?.format).toBe('png');
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

  it('every registry entry declares format png (Sprint 20 Fase 1b migration)', () => {
    for (const entry of MEDICAL_ICON_REGISTRY) {
      expect(entry.format).toBe('png');
    }
  });
});

describe('hasAnyCcByIcons', () => {
  it('returns false while the registry is 100% CC0', () => {
    // Sprint 17c shipped CC0-only; this guards against silent license drift.
    expect(hasAnyCcByIcons()).toBe(false);
  });
});

describe('resolveIconUrl', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.VITE_MEDICAL_ICONS_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('falls back to local SVG when VITE_MEDICAL_ICONS_BASE_URL is unset', () => {
    const entry = findMedicalIcon('stethoscope')!;
    expect(resolveIconUrl(entry)).toBe('/icons/biology/stethoscope.svg');
  });

  it('builds the hosted URL when VITE_MEDICAL_ICONS_BASE_URL is set', () => {
    process.env.VITE_MEDICAL_ICONS_BASE_URL =
      'https://storage.googleapis.com/praeventio-public-assets/medical-icons/v1';
    const entry = findMedicalIcon('stethoscope')!;
    expect(resolveIconUrl(entry)).toBe(
      'https://storage.googleapis.com/praeventio-public-assets/medical-icons/v1/stethoscope.png',
    );
  });

  it('strips trailing slash from the base URL before composing', () => {
    process.env.VITE_MEDICAL_ICONS_BASE_URL = 'https://assets.praeventio.net/medical-icons/v1/';
    const entry = findMedicalIcon('brain')!;
    expect(resolveIconUrl(entry)).toBe(
      'https://assets.praeventio.net/medical-icons/v1/brain.png',
    );
  });

  it('readMedicalIconsBaseUrl reads the env var when present', () => {
    process.env.VITE_MEDICAL_ICONS_BASE_URL = 'https://example.com/x';
    expect(readMedicalIconsBaseUrl()).toBe('https://example.com/x');
  });

  it('readMedicalIconsBaseUrl returns undefined when env var is absent', () => {
    expect(readMedicalIconsBaseUrl()).toBeUndefined();
  });
});
