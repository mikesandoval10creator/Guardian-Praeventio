// Praeventio Guard — Contract test: liability shield + data-law alignment.
//
// Legal context (verified by the founder/spec, NOT invented here):
//   - Ley 21.719 (Chile, protección de datos; crea la Agencia APDP) entra en
//     vigencia 2026-12-01, reemplazando a la Ley 19.628.
//   - Reglamento (UE) 2016/679 (RGPD/GDPR) para titulares en la UE.
//   - Praeventio es ENCARGADO de datos por cuenta de la empresa-cliente
//     (RESPONSABLE); GESTIONA INFORMACIÓN para facilitar la decisión del
//     responsable y NUNCA es el tomador de la decisión preventiva (ADR 0012).
//
// This test pins the load-bearing clauses so a future copy edit can't silently
// strip the no-liability shield, the aggregate liability cap, or the data-law
// alignment. It does NOT assert legal correctness — the prose remains a
// "Borrador — pendiente revisión legal" pending a Chilean data-law attorney.

import { describe, it, expect } from 'vitest';
import {
  TERMS_CONTENT_ES_CL,
  LAST_UPDATED_ISO,
} from '../../services/legal/termsContent';

/** Flatten all section text into one searchable string. */
const allText = [
  TERMS_CONTENT_ES_CL.title,
  TERMS_CONTENT_ES_CL.subtitle,
  ...TERMS_CONTENT_ES_CL.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
].join('\n');

const sectionByHeadingIncludes = (needle: string) =>
  TERMS_CONTENT_ES_CL.sections.find((s) => s.heading.includes(needle));

describe('Terms liability shield — clauses present', () => {
  it('declares Praeventio manages information to facilitate the responsible party decision', () => {
    expect(allText).toMatch(/GESTIONA[,\s]+ORGANIZA Y PRESENTA INFORMACIÓN/);
    expect(allText).toMatch(/FACILITAR LA DECISIÓN/);
  });

  it('states Praeventio is NOT the decision-maker and does NOT diagnose', () => {
    expect(allText).toMatch(/NO ES EL TOMADOR DE LA DECISIÓN/);
    expect(allText).toMatch(/NO DIAGNOSTICA/);
    expect(allText).toMatch(/NO REEMPLAZA EL JUICIO PROFESIONAL/);
  });

  it('places the legal duty on the employer under Ley 16.744 and does not transfer it', () => {
    expect(allText).toMatch(/Ley 16\.744/);
    expect(allText).toMatch(/recae en el empleador/);
    expect(allText).toMatch(/NO traslada/);
  });

  it('keeps the never-block-machinery directive', () => {
    expect(allText).toMatch(/NUNCA bloquea ni detiene maquinaria/);
  });

  it('frames Praeventio as encargado and the client company as responsable', () => {
    expect(allText).toMatch(/ENCARGADO de tratamiento/);
    expect(allText).toMatch(/RESPONSABLE del tratamiento/);
  });
});

describe('Terms liability cap', () => {
  const liability = sectionByHeadingIncludes('Limitación de responsabilidad');

  it('has a dedicated limitation-of-liability section', () => {
    expect(liability).toBeDefined();
  });

  it('excludes indirect/consequential damages', () => {
    expect(allText).toMatch(/daños indirectos/);
    expect(allText).toMatch(/lucro cesante/);
  });

  it('includes an aggregate 12-month-fees liability cap', () => {
    const text = (liability?.paragraphs ?? []).join('\n');
    expect(text).toMatch(/responsabilidad total y agregada/);
    expect(text).toMatch(/doce \(12\) meses/);
  });

  it('carves out non-waivable liability (dolo / culpa grave / consumer rights)', () => {
    const text = (liability?.paragraphs ?? []).join('\n');
    expect(text).toMatch(/dolo/);
    expect(text).toMatch(/culpa grave/);
    expect(text).toMatch(/Ley 19\.496/);
  });
});

describe('Terms data-law alignment (21.719 + GDPR)', () => {
  it('references Ley 21.719 and its 2026-12-01 effective date', () => {
    expect(allText).toMatch(/Ley 21\.719/);
    expect(allText).toMatch(/01-12-2026/);
  });

  it('references the EU GDPR / RGPD', () => {
    expect(allText).toMatch(/RGPD\/GDPR/);
    expect(allText).toMatch(/Reglamento \(UE\) 2016\/679/);
  });

  it('still references the currently-in-force Ley 19.628', () => {
    expect(allText).toMatch(/Ley 19\.628/);
  });
});

describe('Terms metadata', () => {
  it('bumped lastUpdatedISO to this version (>= 2026-06-21)', () => {
    expect(TERMS_CONTENT_ES_CL.lastUpdatedISO).toBe(LAST_UPDATED_ISO);
    expect(Date.parse(LAST_UPDATED_ISO)).toBeGreaterThanOrEqual(
      Date.parse('2026-06-21'),
    );
  });

  it('keeps the canonical RUT and contact email', () => {
    expect(TERMS_CONTENT_ES_CL.rut).toBe('78.231.119-0');
    expect(TERMS_CONTENT_ES_CL.contactEmail).toBe('contacto@praeventio.net');
  });
});
