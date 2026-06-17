import { describe, it, expect } from 'vitest';
import { buildOrphanNotifications } from './useZettelkastenIntelligence';

describe('buildOrphanNotifications (orphan-notif dedup, pure)', () => {
  it('returns nothing when there are no orphans', () => {
    expect(
      buildOrphanNotifications([], [], new Set(), new Set()),
    ).toEqual([]);
  });

  it('creates a high-severity orphan_risk notif for a risk with no existing notif', () => {
    const out = buildOrphanNotifications(
      [{ id: 'r1', title: 'Caída a distinto nivel' }],
      [],
      new Set(),
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'orphan_risk',
      relatedId: 'r1',
      severity: 'high',
      title: 'Riesgo Huérfano Detectado',
    });
    expect(out[0].message).toContain('Caída a distinto nivel');
  });

  it('creates a medium-severity orphan_worker notif for a worker with no existing notif', () => {
    const out = buildOrphanNotifications(
      [],
      [{ id: 'w1', name: 'Juan Pérez' }],
      new Set(),
      new Set(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'orphan_worker',
      relatedId: 'w1',
      severity: 'medium',
      title: 'Trabajador sin Capacitación',
    });
    expect(out[0].message).toContain('Juan Pérez');
  });

  it('skips orphans whose relatedId already has a notification (dedup)', () => {
    const out = buildOrphanNotifications(
      [
        { id: 'r1', title: 'A' },
        { id: 'r2', title: 'B' },
      ],
      [
        { id: 'w1', name: 'X' },
        { id: 'w2', name: 'Y' },
      ],
      new Set(['r1']), // r1 already notified
      new Set(['w2']), // w2 already notified
    );
    const ids = out.map(n => n.relatedId).sort();
    expect(ids).toEqual(['r2', 'w1']);
  });

  it('returns nothing when every orphan already has a notification', () => {
    const out = buildOrphanNotifications(
      [{ id: 'r1', title: 'A' }],
      [{ id: 'w1', name: 'X' }],
      new Set(['r1']),
      new Set(['w1']),
    );
    expect(out).toEqual([]);
  });

  it('tolerates missing title/name without throwing', () => {
    const out = buildOrphanNotifications(
      [{ id: 'r1' }],
      [{ id: 'w1' }],
      new Set(),
      new Set(),
    );
    expect(out).toHaveLength(2);
    expect(out[0].message).toContain('""'); // empty quoted title
    expect(out[1].message).toContain('El trabajador');
  });
});
