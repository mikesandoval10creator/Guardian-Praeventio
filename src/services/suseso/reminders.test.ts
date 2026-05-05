// Praeventio Guard — Sprint 28 follow-up.
//
// Pure-helper tests for the SUSESO deadline reminder system.

import { describe, it, expect } from 'vitest';
import {
  computeLegalDeadline,
  daysUntilDeadline,
  escalationLevel,
  reminderIdempotencyKey,
} from './reminders';

describe('computeLegalDeadline', () => {
  it('adds 5 días corridos for a DIAT incident', () => {
    const result = computeLegalDeadline('DIAT', '2026-05-01T10:00:00Z');
    expect(result).toBe('2026-05-06T10:00:00.000Z');
  });

  it('adds 5 días corridos for a DIEP detection (DS 109)', () => {
    const result = computeLegalDeadline('DIEP', '2026-05-01T10:00:00Z');
    expect(result).toBe('2026-05-06T10:00:00.000Z');
  });

  it('throws on invalid incidentDate', () => {
    expect(() => computeLegalDeadline('DIAT', 'not-a-date')).toThrow(
      /invalid incidentDate/,
    );
  });

  it('preserves ms precision across DST/timezone boundaries (UTC)', () => {
    // 2026-03-29 is a DST transition in Chile. We work in UTC so the
    // result is unaffected — verifies we are not sneaking a Date.toString
    // path that respects local TZ.
    const result = computeLegalDeadline('DIAT', '2026-03-29T03:00:00Z');
    expect(result).toBe('2026-04-03T03:00:00.000Z');
  });
});

describe('daysUntilDeadline', () => {
  const NOW = Date.parse('2026-05-05T12:00:00Z');

  it('returns positive days when deadline is in the future', () => {
    expect(daysUntilDeadline('2026-05-08T12:00:00Z', NOW)).toBe(3);
  });

  it('returns 0 when deadline is later today (still vence HOY)', () => {
    expect(daysUntilDeadline('2026-05-05T23:30:00Z', NOW)).toBe(0);
  });

  it('returns 0 when deadline is exactly now', () => {
    expect(daysUntilDeadline('2026-05-05T12:00:00Z', NOW)).toBe(0);
  });

  it('returns negative when deadline is already past', () => {
    expect(daysUntilDeadline('2026-05-03T12:00:00Z', NOW)).toBe(-2);
  });

  it('throws on invalid deadline string', () => {
    expect(() => daysUntilDeadline('garbage', NOW)).toThrow(/invalid deadline/);
  });
});

describe('escalationLevel', () => {
  it('green when 5 or more days remaining', () => {
    expect(escalationLevel(5)).toBe('green');
    expect(escalationLevel(10)).toBe('green');
  });

  it('yellow when 3–4 days remaining', () => {
    expect(escalationLevel(4)).toBe('yellow');
    expect(escalationLevel(3)).toBe('yellow');
  });

  it('orange when 1–2 days remaining', () => {
    expect(escalationLevel(2)).toBe('orange');
    expect(escalationLevel(1)).toBe('orange');
  });

  it('red when 0 days remaining (vence HOY)', () => {
    expect(escalationLevel(0)).toBe('red');
  });

  it('overdue when negative', () => {
    expect(escalationLevel(-1)).toBe('overdue');
    expect(escalationLevel(-30)).toBe('overdue');
  });
});

describe('reminderIdempotencyKey', () => {
  it('produces YYYY-MM-DD-suffixed key per recipient per form', () => {
    const k = reminderIdempotencyKey('form_42', 'uid_alice', new Date(Date.UTC(2026, 4, 5, 10)));
    expect(k).toBe('form_42:uid_alice:2026-05-05');
  });

  it('rolls to next day at UTC midnight', () => {
    // 2026-05-05T23:59:59Z and 2026-05-06T00:00:00Z must differ.
    const a = reminderIdempotencyKey('f', 'u', new Date(Date.UTC(2026, 4, 5, 23, 59, 59)));
    const b = reminderIdempotencyKey('f', 'u', new Date(Date.UTC(2026, 4, 6, 0, 0, 0)));
    expect(a).not.toBe(b);
    expect(a.endsWith('2026-05-05')).toBe(true);
    expect(b.endsWith('2026-05-06')).toBe(true);
  });
});
