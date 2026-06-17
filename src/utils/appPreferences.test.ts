import { describe, it, expect } from 'vitest';
import {
  coerceAppPreferences,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
} from './appPreferences';

const CUSTOM: AppPreferences = {
  emailNotifs: false,
  sessionTimeout: '60',
  aiDetail: 'detallado',
  aiProactive: false,
};

describe('coerceAppPreferences', () => {
  it('returns defaults for nullish / non-object input', () => {
    expect(coerceAppPreferences(undefined)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(coerceAppPreferences(null)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(coerceAppPreferences('nope')).toEqual(DEFAULT_APP_PREFERENCES);
    expect(coerceAppPreferences(42)).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('round-trips a fully valid persisted object', () => {
    expect(coerceAppPreferences(CUSTOM)).toEqual(CUSTOM);
  });

  it('substitutes defaults per-field for wrong-typed values (malformed doc)', () => {
    const malformed = {
      emailNotifs: 'yes', // wrong type -> default true
      sessionTimeout: 45, // number instead of string -> default '30'
      aiDetail: null, // -> default 'equilibrado'
      aiProactive: false, // valid -> kept
    };
    expect(coerceAppPreferences(malformed)).toEqual({
      emailNotifs: true,
      sessionTimeout: '30',
      aiDetail: 'equilibrado',
      aiProactive: false,
    });
  });

  it('fills missing fields from defaults (partial doc / schema evolution)', () => {
    expect(coerceAppPreferences({ emailNotifs: false })).toEqual({
      ...DEFAULT_APP_PREFERENCES,
      emailNotifs: false,
    });
  });

  it('honors a custom defaults argument', () => {
    expect(coerceAppPreferences({}, CUSTOM)).toEqual(CUSTOM);
  });

  it('does not mutate the shared default object', () => {
    const out = coerceAppPreferences(null);
    out.emailNotifs = false;
    expect(DEFAULT_APP_PREFERENCES.emailNotifs).toBe(true);
  });
});
