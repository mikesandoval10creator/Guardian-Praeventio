import { describe, it, expect } from 'vitest';
import { dedupeNotifications, notificationSignature, type DedupableNotification } from './notificationDedup';

const mk = (over: Partial<DedupableNotification>): DedupableNotification => ({
  id: Math.random().toString(36).slice(2),
  title: 'T',
  message: 'M',
  type: 'info',
  read: false,
  createdAt: 0,
  ...over,
});

describe('notificationSignature', () => {
  it('is equal for same type+title+message (trimmed)', () => {
    expect(notificationSignature({ type: 'info', title: ' Hola ', message: 'x ' }))
      .toBe(notificationSignature({ type: 'info', title: 'Hola', message: 'x' }));
  });
  it('differs by type', () => {
    expect(notificationSignature({ type: 'info', title: 'A', message: 'B' }))
      .not.toBe(notificationSignature({ type: 'warning', title: 'A', message: 'B' }));
  });
});

describe('dedupeNotifications', () => {
  it('returns empty for empty input', () => {
    expect(dedupeNotifications([])).toEqual([]);
  });

  it('keeps distinct notifications, sorted newest-first', () => {
    const a = mk({ id: 'a', title: 'A', createdAt: 1 });
    const b = mk({ id: 'b', title: 'B', createdAt: 2 });
    const out = dedupeNotifications([a, b]);
    expect(out.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('collapses identical content to a single newest entry', () => {
    const list = [
      mk({ id: '1', title: 'Dup', message: 'same', createdAt: 10 }),
      mk({ id: '2', title: 'Dup', message: 'same', createdAt: 30 }),
      mk({ id: '3', title: 'Dup', message: 'same', createdAt: 20 }),
    ];
    const out = dedupeNotifications(list);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2'); // newest createdAt
    expect(out[0].createdAt).toBe(30);
  });

  it('keeps the surviving entry unread if ANY duplicate is unread', () => {
    const list = [
      mk({ id: '1', title: 'D', message: 'm', read: true, createdAt: 5 }),
      mk({ id: '2', title: 'D', message: 'm', read: false, createdAt: 9 }),
    ];
    const out = dedupeNotifications(list);
    expect(out).toHaveLength(1);
    expect(out[0].read).toBe(false);
  });

  it('marks read only when all duplicates are read', () => {
    const list = [
      mk({ id: '1', title: 'D', message: 'm', read: true, createdAt: 5 }),
      mk({ id: '2', title: 'D', message: 'm', read: true, createdAt: 9 }),
    ];
    expect(dedupeNotifications(list)[0].read).toBe(true);
  });

  it('does not merge different types with same title/message', () => {
    const list = [
      mk({ id: '1', type: 'info', title: 'D', message: 'm', createdAt: 1 }),
      mk({ id: '2', type: 'warning', title: 'D', message: 'm', createdAt: 2 }),
    ];
    expect(dedupeNotifications(list)).toHaveLength(2);
  });
});
