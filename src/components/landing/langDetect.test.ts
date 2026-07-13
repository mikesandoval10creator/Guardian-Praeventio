import { describe, it, expect } from 'vitest';
import { detectLandingLocale, LANDING_SUPPORTED_LOCALES } from './langDetect';

describe('detectLandingLocale (landing geodetection, privacy-first)', () => {
  it('Chile → es (la casa), regardless of browser language', () => {
    expect(detectLandingLocale('America/Santiago', ['en-US'])).toBe('es');
    expect(detectLandingLocale('America/Punta_Arenas', ['de-DE'])).toBe('es');
    expect(detectLandingLocale('Pacific/Easter', [])).toBe('es');
  });

  it('Brasil → pt-BR', () => {
    expect(detectLandingLocale('America/Sao_Paulo', ['en-US'])).toBe('pt-BR');
    expect(detectLandingLocale('America/Manaus', [])).toBe('pt-BR');
  });

  it('EEUU → en', () => {
    expect(detectLandingLocale('America/New_York', ['es-CL'])).toBe('en');
    expect(detectLandingLocale('America/Los_Angeles', [])).toBe('en');
  });

  it('resto del mundo → idioma más hablado disponible', () => {
    expect(detectLandingLocale('America/Argentina/Buenos_Aires', [])).toBe('es-AR');
    expect(detectLandingLocale('America/Mexico_City', [])).toBe('es-MX');
    expect(detectLandingLocale('America/Lima', [])).toBe('es-PE');
    expect(detectLandingLocale('Europe/Paris', [])).toBe('fr');
    expect(detectLandingLocale('Europe/Berlin', [])).toBe('de');
    expect(detectLandingLocale('Asia/Tokyo', [])).toBe('ja');
    expect(detectLandingLocale('Asia/Seoul', [])).toBe('ko');
    expect(detectLandingLocale('Asia/Taipei', [])).toBe('zh-TW');
    expect(detectLandingLocale('Asia/Riyadh', [])).toBe('ar');
    expect(detectLandingLocale('Europe/Moscow', [])).toBe('ru');
    expect(detectLandingLocale('Europe/Lisbon', [])).toBe('pt-BR');
  });

  it('timezone desconocida → navigator.languages decide', () => {
    expect(detectLandingLocale('Antarctica/McMurdo', ['fr-FR', 'en-US'])).toBe('fr');
    expect(detectLandingLocale(undefined, ['pt-PT'])).toBe('pt-BR');
    expect(detectLandingLocale('', ['zh-Hant-TW'])).toBe('zh-TW');
  });

  it('sin señales → en (default global)', () => {
    expect(detectLandingLocale('Antarctica/McMurdo', [])).toBe('en');
    expect(detectLandingLocale(undefined, ['xx-XX'])).toBe('en');
  });

  it('siempre devuelve un locale que la app despacha', () => {
    const zones = ['America/Santiago', 'America/Sao_Paulo', 'Asia/Tokyo', 'Antarctica/McMurdo', undefined];
    for (const tz of zones) {
      expect(LANDING_SUPPORTED_LOCALES).toContain(detectLandingLocale(tz, ['en']));
    }
  });
});
