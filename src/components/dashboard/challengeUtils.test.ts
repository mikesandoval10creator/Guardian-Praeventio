// Praeventio Guard — Unit tests for the pure helpers extracted from
// Dashboard.tsx during the A11 R18 refactor.
//
// The original 911-LOC page contained inline gamification math that was
// untestable in isolation (it depended on React hooks + Firestore). This
// suite locks behaviour for:
//
//   • isChallengeCompletedAt — daily/weekly/monthly/annual windowing
//   • buildDailyChallengesIcs — RFC 5545 .ics structure
//   • computeProjectCompliance — findings/tasks/trainings score blend

import { describe, it, expect } from 'vitest';
import {
  isChallengeCompletedAt,
  buildDailyChallengesIcs,
  computeProjectCompliance,
} from './challengeUtils';

const NODE_TYPES = { FINDING: 'finding', TASK: 'task', TRAINING: 'training' };

describe('isChallengeCompletedAt', () => {
  const now = new Date('2026-04-28T15:00:00Z');

  it('returns false when no completion timestamp is provided', () => {
    expect(isChallengeCompletedAt(undefined, 'daily', now)).toBe(false);
  });

  it('counts a same-day completion as daily complete', () => {
    expect(isChallengeCompletedAt('2026-04-28T08:00:00Z', 'daily', now)).toBe(true);
  });

  it('treats yesterday as NOT daily complete', () => {
    expect(isChallengeCompletedAt('2026-04-27T23:00:00Z', 'daily', now)).toBe(false);
  });

  it('counts completions within 7 days as weekly complete', () => {
    expect(isChallengeCompletedAt('2026-04-22T15:00:00Z', 'weekly', now)).toBe(true);
  });

  it('rejects completions older than 7 days for weekly', () => {
    expect(isChallengeCompletedAt('2026-04-10T15:00:00Z', 'weekly', now)).toBe(false);
  });

  it('matches calendar month + year for monthly', () => {
    // Use mid-day timestamps to avoid TZ rollover ambiguity (getMonth is local).
    expect(isChallengeCompletedAt('2026-04-15T12:00:00Z', 'monthly', now)).toBe(true);
    expect(isChallengeCompletedAt('2026-03-15T12:00:00Z', 'monthly', now)).toBe(false);
  });

  it('matches calendar year for annual', () => {
    expect(isChallengeCompletedAt('2026-06-01T12:00:00Z', 'annual', now)).toBe(true);
    expect(isChallengeCompletedAt('2025-06-01T12:00:00Z', 'annual', now)).toBe(false);
  });
});

describe('buildDailyChallengesIcs', () => {
  const now = new Date('2026-04-28T12:00:00Z');

  it('opens with a VCALENDAR header and closes with END:VCALENDAR', () => {
    const ics = buildDailyChallengesIcs(['Charla 5 min'], now);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('emits one VEVENT per challenge', () => {
    const ics = buildDailyChallengesIcs(['A', 'B', 'C'], now);
    const matches = ics.match(/BEGIN:VEVENT/g) || [];
    expect(matches.length).toBe(3);
  });

  it('embeds the challenge label as SUMMARY', () => {
    const ics = buildDailyChallengesIcs(['Reportar 1 Hallazgo'], now);
    expect(ics).toContain('SUMMARY:Reportar 1 Hallazgo');
  });

  it('produces deterministic UIDs scoped to now.getTime()', () => {
    const ics = buildDailyChallengesIcs(['X'], now);
    expect(ics).toContain(`UID:praeventio-daily-0-${now.getTime()}@praeventioguard.com`);
  });
});

describe('computeProjectCompliance', () => {
  it('returns 100 for a project with no nodes (vacuous truth)', () => {
    expect(computeProjectCompliance('p1', [], NODE_TYPES)).toBe(100);
  });

  it('penalises open findings proportionally', () => {
    const nodes = [
      { projectId: 'p1', type: 'finding', metadata: { status: 'cerrado' } },
      { projectId: 'p1', type: 'finding', metadata: { status: 'abierto' } },
    ];
    // 50% findings + 100% tasks + 100% trainings -> 83.33 -> 83
    expect(computeProjectCompliance('p1', nodes, NODE_TYPES)).toBe(83);
  });

  it('counts spanish completion synonyms (estado/Completada)', () => {
    const nodes = [
      { projectId: 'p1', type: 'task', metadata: { estado: 'Completada' } },
      { projectId: 'p1', type: 'task', metadata: { estado: 'En curso' } },
    ];
    // 100 + 50 + 100 -> 83
    expect(computeProjectCompliance('p1', nodes, NODE_TYPES)).toBe(83);
  });

  it('counts trainings only when status === completed or estado === Completada', () => {
    const nodes = [
      { projectId: 'p1', type: 'training', metadata: { status: 'completed' } },
      { projectId: 'p1', type: 'training', metadata: { estado: 'Completada' } },
      { projectId: 'p1', type: 'training', metadata: { estado: 'pendiente' } },
    ];
    // 100 + 100 + 66.67 -> 89
    expect(computeProjectCompliance('p1', nodes, NODE_TYPES)).toBe(89);
  });

  it('ignores nodes from other projects', () => {
    const nodes = [
      { projectId: 'other', type: 'finding', metadata: { status: 'abierto' } },
      { projectId: 'p1', type: 'finding', metadata: { status: 'cerrado' } },
    ];
    expect(computeProjectCompliance('p1', nodes, NODE_TYPES)).toBe(100);
  });

  it('rounds the final blended score', () => {
    const nodes = [
      { projectId: 'p1', type: 'finding', metadata: { status: 'cerrado' } },
      { projectId: 'p1', type: 'finding', metadata: { status: 'abierto' } },
      { projectId: 'p1', type: 'finding', metadata: { status: 'abierto' } },
    ];
    // findings 33.33 + tasks 100 + trainings 100 = 233.33/3 = 77.77 -> 78
    expect(computeProjectCompliance('p1', nodes, NODE_TYPES)).toBe(78);
  });
});
