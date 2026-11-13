import { describe, expect, it } from 'vitest';
import en from './locales/en/common.json';
import es from './locales/es/common.json';
import ptBR from './locales/pt-BR/common.json';

function readNested(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, root);
}

const launchLocales = [
  ['es', es as unknown as Record<string, unknown>],
  ['en', en as unknown as Record<string, unknown>],
  ['pt-BR', ptBR as unknown as Record<string, unknown>],
] as const;

const expected = {
  'siteMap.title': {
    es: 'Mapa del sitio',
    en: 'Site Map',
    'pt-BR': 'Mapa do site',
  },
  'siteMap.subtitle': {
    es: 'Inteligencia operativa',
    en: 'Operational Intelligence',
    'pt-BR': 'Inteligência Operacional',
  },
} as const;

describe('SiteMap launch-locale translations', () => {
  it.each(Object.entries(expected))('%s is declared with reviewed labels in each launch locale', (key, translations) => {
    for (const [locale, resource] of launchLocales) {
      expect(readNested(resource, key), `${key} missing for ${locale}`).toBe(translations[locale]);
    }
  });
});
