import { describe, it, expect } from 'vitest';
import {
  buildQuickLookConfig,
  quickLookAnchorProps,
  labelForMarker,
} from './arQuickLookFallback.js';

describe('buildQuickLookConfig', () => {
  it('non-iOS: not available', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: false,
      marker: 'extinguisher',
    });
    expect(c.isAvailable).toBe(false);
    expect(c.canPreview).toBe(false);
    expect(c.usdzUrl).toBeNull();
  });

  it('iOS + marker con asset: available + canPreview + URL set', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: true,
      marker: 'extinguisher',
    });
    expect(c.isAvailable).toBe(true);
    expect(c.canPreview).toBe(true);
    expect(c.usdzUrl).toMatch(/\.usdz$/);
  });

  it('iOS + marker sin asset (measurement_probe): available pero no canPreview', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: true,
      marker: 'measurement_probe',
    });
    expect(c.isAvailable).toBe(true);
    expect(c.canPreview).toBe(false);
    expect(c.usdzUrl).toBeNull();
  });

  it('iOS + note: no canPreview (anotación libre)', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: true,
      marker: 'note',
    });
    expect(c.canPreview).toBe(false);
  });

  it('variant extinguisher:co2 → URL de CO2', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: true,
      marker: 'extinguisher',
      variant: 'co2',
    });
    expect(c.usdzUrl).toMatch(/extinguisher_co2\.usdz$/);
  });

  it('variant extinguisher:pqs → URL de PQS', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: true,
      marker: 'extinguisher',
      variant: 'pqs',
    });
    expect(c.usdzUrl).toMatch(/extinguisher_pqs\.usdz$/);
  });

  it('variant unknown → cae al default del catálogo', () => {
    const c = buildQuickLookConfig({
      isLikelyIosSafari: true,
      marker: 'extinguisher',
      variant: 'foo',
    });
    expect(c.usdzUrl).toMatch(/extinguisher_pqs\.usdz$/);
  });
});

describe('quickLookAnchorProps', () => {
  it('attrs canónicos para Quick Look', () => {
    const props = quickLookAnchorProps('/models/ar/foo.usdz', 'Extintor PQS');
    expect(props.href).toBe('/models/ar/foo.usdz');
    expect(props.rel).toBe('ar');
    expect(props.type).toBe('model/vnd.usdz+zip');
    expect(props['aria-label']).toBe('Extintor PQS');
    expect(props.download).toBe('foo.usdz');
  });

  it('download attr derivado del filename de la URL', () => {
    const p = quickLookAnchorProps('/a/b/c/model.usdz', 'X');
    expect(p.download).toBe('model.usdz');
  });

  it('URL sin path: download attr fallback', () => {
    const p = quickLookAnchorProps('blob:http://x/abc', 'X');
    expect(p.download).toBeDefined();
  });
});

describe('labelForMarker', () => {
  it('devuelve label en español para cada marker', () => {
    expect(labelForMarker('extinguisher')).toBe('Extintor');
    expect(labelForMarker('evacuation_route')).toBe('Ruta de evacuación');
    expect(labelForMarker('assembly_point')).toBe('Punto de encuentro');
    expect(labelForMarker('hazard_label')).toBe('Etiqueta de peligro');
    expect(labelForMarker('first_aid')).toBe('Botiquín de primeros auxilios');
    expect(labelForMarker('restricted_zone')).toBe('Zona restringida');
    expect(labelForMarker('measurement_probe')).toBe('Sonda de medición');
    expect(labelForMarker('note')).toBe('Anotación');
  });
});
