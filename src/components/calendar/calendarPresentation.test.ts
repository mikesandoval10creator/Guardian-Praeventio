import { describe, expect, it } from 'vitest';
import { createCalendarDateFormatters, getCalendarEventTypeTranslation, CALENDAR_EVENT_TYPE_TRANSLATIONS, parseCalendarDate } from './calendarPresentation';
import en from '../../i18n/locales/en/common.json';
import es from '../../i18n/locales/es/common.json';
import ptBR from '../../i18n/locales/pt-BR/common.json';

function readNested(root: Record<string, unknown>, dottedKey: string): unknown {
  return dottedKey.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, root);
}

describe('calendar event-type localization', () => {
  it('maps every persisted event type to a declared launch-locale key', () => {
    const locales = [es, en, ptBR] as unknown as Record<string, unknown>[];
    for (const [persistedValue, translation] of Object.entries(CALENDAR_EVENT_TYPE_TRANSLATIONS)) {
      expect(getCalendarEventTypeTranslation(persistedValue)).toEqual(translation);
      for (const locale of locales) {
        expect(readNested(locale, translation.key), `${translation.key} (${persistedValue})`).toEqual(expect.any(String));
      }
    }
  });

  it('leaves unknown persisted values visible instead of fabricating a label', () => {
    expect(getCalendarEventTypeTranslation('Legacy custom event')).toBeUndefined();
  });
});

describe('calendar date formatting', () => {
  const date = new Date('2026-11-13T12:00:00.000Z');

  it('formats month, weekday, and event date in the selected locale', () => {
    const english = createCalendarDateFormatters('en');
    const spanish = createCalendarDateFormatters('es-CL');
    const portuguese = createCalendarDateFormatters('pt-BR');

    expect(english.monthYear(date).toLowerCase()).toContain('november');
    expect(spanish.monthYear(date).toLowerCase()).toContain('noviembre');
    expect(portuguese.monthYear(date).toLowerCase()).toContain('novembro');
    expect(english.weekdayLong(date).toLowerCase()).toBe('friday');
    expect(spanish.eventDate(date).toLowerCase()).toContain('noviembre');
    expect(portuguese.eventDate(date).toLowerCase()).toContain('novembro');
  });

  it('uses the product default locale when no language is resolved', () => {
    expect(createCalendarDateFormatters(undefined).monthYear(date).toLowerCase()).toContain('noviembre');
  });

  it('falls back to the product locale for unsupported language tags', () => {
    expect(createCalendarDateFormatters('zz-ZZ').monthYear(date).toLowerCase()).toContain('noviembre');
  });

  it('parses stored date-only values as local calendar days, not UTC instants', () => {
    const parsed = parseCalendarDate('2026-11-13');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10);
    expect(parsed.getDate()).toBe(13);
  });

  it('preserves impossible date-only values instead of normalizing them', () => {
    expect(Number.isNaN(parseCalendarDate('2026-02-31').getTime())).toBe(true);
    expect(createCalendarDateFormatters('es').eventDate('2026-02-31')).toBe('2026-02-31');
  });
});
