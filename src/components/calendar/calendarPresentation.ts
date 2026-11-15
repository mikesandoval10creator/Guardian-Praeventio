export const CALENDAR_EVENT_TYPE_TRANSLATIONS = {
  'Capacitación': { key: 'calendar.event_type_training', defaultValue: 'Capacitación' },
  'Inspección': { key: 'calendar.event_type_inspection', defaultValue: 'Inspección' },
  'Auditoría': { key: 'calendar.event_type_audit', defaultValue: 'Auditoría' },
  'Reunión': { key: 'calendar.event_type_meeting', defaultValue: 'Reunión' },
} as const;

export type CalendarEventType = keyof typeof CALENDAR_EVENT_TYPE_TRANSLATIONS;

export function getCalendarEventTypeTranslation(type: string) {
  if (!Object.prototype.hasOwnProperty.call(CALENDAR_EVENT_TYPE_TRANSLATIONS, type)) {
    return undefined;
  }
  return CALENDAR_EVENT_TYPE_TRANSLATIONS[type as CalendarEventType];
}

export function parseCalendarDate(value: string | Date): Date {
  if (value instanceof Date) return value;

  // <input type="date"> stores YYYY-MM-DD. Parse it as a local calendar day;
  // Date(string) treats that form as UTC and can shift the displayed day west.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const localCalendarDay = new Date(year, month - 1, day, 12);
    if (localCalendarDay.getFullYear() === year && localCalendarDay.getMonth() === month - 1 && localCalendarDay.getDate() === day) {
      return localCalendarDay;
    }
    return new Date(Number.NaN);
  }
  return new Date(value);
}

export interface CalendarDateFormatters {
  monthYear: (date: Date) => string;
  weekdayLong: (date: Date) => string;
  eventDate: (value: string | Date) => string;
}

export function createCalendarDateFormatters(language?: string): CalendarDateFormatters {
  const requestedLocale = language?.trim() || 'es';
  let locale = 'es';
  try {
    const [supportedLocale] = Intl.DateTimeFormat.supportedLocalesOf([requestedLocale]);
    if (supportedLocale) locale = supportedLocale;
  } catch {
    // Keep the product default for malformed locale state.
  }

  const monthYear = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const eventDate = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' });

  return {
    monthYear: (date) => monthYear.format(date),
    weekdayLong: (date) => weekdayLong.format(date),
    eventDate: (value) => {
      const date = parseCalendarDate(value);
      return Number.isNaN(date.getTime()) ? String(value) : eventDate.format(date);
    },
  };
}
