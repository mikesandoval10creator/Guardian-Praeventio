import { describe, it, expect } from 'vitest';
import { applyCoverage } from './trafficLightCoverage.js';
import type {
  ComplianceCategory,
  ComplianceTrafficLightResult,
  CategoryStatus,
  TrafficLight,
} from './trafficLightEngine.js';

const ALL_CATEGORIES: ComplianceCategory[] = [
  'legal',
  'documentation',
  'training',
  'epp',
  'emergencies',
  'occupational_health',
  'maintenance',
  'audits',
];

function cat(category: ComplianceCategory, light: TrafficLight): CategoryStatus {
  return { category, light, summary: `${category}-${light}`, criticalItemIds: [], warningCount: 0 };
}

function engineResult(light: TrafficLight): ComplianceTrafficLightResult {
  return {
    overall: light,
    score: 100,
    computedAt: '2026-06-18T00:00:00.000Z',
    byCategory: ALL_CATEGORIES.map((c) => cat(c, light)),
  };
}

describe('applyCoverage', () => {
  it('marks un-sourced categories as unknown and excludes them from overall/score', () => {
    const base = engineResult('green'); // engine says all 8 green
    const view = applyCoverage(base, new Set<ComplianceCategory>(['legal']));

    expect(view.sourcedCount).toBe(1);
    expect(view.totalCount).toBe(8);
    // 7 categories have NO source → unknown, not green.
    expect(view.byCategory.filter((c) => c.light === 'unknown')).toHaveLength(7);
    const legal = view.byCategory.find((c) => c.category === 'legal');
    expect(legal?.light).toBe('green');
    // Score is over the single sourced category, not all 8.
    expect(view.score).toBe(100);
    expect(view.overall).toBe('green');
  });

  it('overall reflects the worst SOURCED category only', () => {
    const base: ComplianceTrafficLightResult = {
      overall: 'red',
      score: 50,
      computedAt: '2026-06-18T00:00:00.000Z',
      byCategory: [
        cat('legal', 'red'),
        cat('emergencies', 'green'),
        ...ALL_CATEGORIES.filter((c) => c !== 'legal' && c !== 'emergencies').map((c) => cat(c, 'green')),
      ],
    };
    // Only emergencies is sourced (green); the red legal is NOT sourced → ignored.
    const view = applyCoverage(base, new Set<ComplianceCategory>(['emergencies']));
    expect(view.overall).toBe('green');
    expect(view.score).toBe(100);
    expect(view.byCategory.find((c) => c.category === 'legal')?.light).toBe('unknown');
  });

  it('returns overall=unknown and score=null when nothing is sourced', () => {
    const view = applyCoverage(engineResult('green'), new Set<ComplianceCategory>());
    expect(view.overall).toBe('unknown');
    expect(view.score).toBeNull();
    expect(view.sourcedCount).toBe(0);
    expect(view.byCategory.every((c) => c.light === 'unknown')).toBe(true);
  });

  it('does NOT fabricate green: an un-sourced category never inherits the engine green', () => {
    const view = applyCoverage(engineResult('green'), new Set<ComplianceCategory>(['legal']));
    const audits = view.byCategory.find((c) => c.category === 'audits');
    expect(audits?.light).toBe('unknown');
    expect(audits?.summary).toBe('');
  });
});
