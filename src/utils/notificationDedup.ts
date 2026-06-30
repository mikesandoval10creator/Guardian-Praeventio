// notificationDedup — pure, deterministic de-duplication of in-app notifications.
//
// Why: identical notifications were piling up (e.g. a foreground FCM push handled
// by stacked onMessage listeners, or the same "welcome" content re-added across
// sessions). Each got a fresh crypto.randomUUID(), so they could NOT be deduped by
// id. We collapse by CONTENT signature (type + title + message) instead, keeping
// the most recent occurrence and preserving the unread state if ANY copy is unread.
//
// Pure: no I/O, no Date.now(), deterministic for a given input.

export interface DedupableNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: number;
}

/** Content signature — two notifications with the same signature are "the same". */
export function notificationSignature(n: { title: string; message: string; type: string }): string {
  return [n.type, n.title.trim(), n.message.trim()].join('::');
}

/**
 * Collapse notifications that share a content signature.
 * - Keeps the newest (max createdAt) id/title/time of each group.
 * - The surviving entry is unread if ANY member of the group is unread
 *   (so a read duplicate never hides a genuinely unread item).
 * - Output is sorted newest-first by createdAt.
 */
export function dedupeNotifications<T extends DedupableNotification>(list: T[]): T[] {
  const bySig = new Map<string, T>();
  for (const n of list) {
    const sig = notificationSignature(n);
    const existing = bySig.get(sig);
    if (!existing) {
      bySig.set(sig, n);
      continue;
    }
    const newest = n.createdAt >= existing.createdAt ? n : existing;
    bySig.set(sig, { ...newest, read: existing.read && n.read });
  }
  return Array.from(bySig.values()).sort((a, b) => b.createdAt - a.createdAt);
}
