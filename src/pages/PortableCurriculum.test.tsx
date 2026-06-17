// @vitest-environment jsdom
//
// WP-U3: PortableCurriculum used to show "El detalle aparecerá acá
// próximamente" instead of the worker's completed trainings, even though the
// history (audit_logs via historyAggregator) was already hydrated. This tests
// the pure projection that now renders the REAL rows — only training.*.completed
// events, never fabricated ones.

import { describe, it, expect, vi } from 'vitest';

// Minimal mocks so importing the page module (which reads db/auth at the top)
// does not initialise Firebase. We only exercise the exported pure helper.
vi.mock('../services/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

import { selectCompletedTrainings } from './PortableCurriculum';
import type { CurriculumHistoryEvent } from '../services/curriculum/historyAggregator';

function ev(over: Partial<CurriculumHistoryEvent> & { action: string }): CurriculumHistoryEvent {
  return { timestamp: '2026-05-10T12:00:00Z', ...over } as unknown as CurriculumHistoryEvent;
}

describe('selectCompletedTrainings — real completed-training rows (no fabrication)', () => {
  it('returns empty when there are no training.*.completed events', () => {
    expect(
      selectCompletedTrainings([ev({ action: 'safety.iper.created' }), ev({ action: 'gamification.badge' })]),
    ).toEqual([]);
  });

  it('includes ONLY training.*.completed events, excluding other modules', () => {
    const rows = selectCompletedTrainings([
      ev({ action: 'training.altura.completed' }),
      ev({ action: 'safety.report.created' }),
      ev({ action: 'training.confined-space.completed' }),
      ev({ action: 'training.altura.started' }), // not completed → excluded
    ]);
    expect(rows.map((r) => r.label)).toEqual(['altura', 'confined space']);
  });

  it('prefers a real details.title over the humanized course id', () => {
    const rows = selectCompletedTrainings([
      ev({ action: 'training.x.completed', details: { title: 'Trabajo en Altura DS 594' } as any }),
    ]);
    expect(rows[0].label).toBe('Trabajo en Altura DS 594');
  });

  it('carries the formatted date and a stable key', () => {
    const rows = selectCompletedTrainings([
      ev({ action: 'training.loto.completed', timestamp: '2026-05-10T12:00:00Z' }),
    ]);
    expect(rows[0].date).not.toBe('');
    expect(rows[0].key).toContain('training.loto.completed');
  });
});
