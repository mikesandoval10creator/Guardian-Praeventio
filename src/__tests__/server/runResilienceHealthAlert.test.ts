// Praeventio Guard — P0 security hardening contract test.
//
// Resilience health-report IDs use shape `<iso-ts>_<uuid>` where the
// ISO timestamp has `:` and `.` replaced with `-` to keep them
// filesystem-safe and lexicographically sortable by arrival time.
// The production implementation in
// src/server/jobs/runResilienceHealthAlert.ts uses crypto.randomUUID()
// (RFC-4122 v4, 128 bits of entropy).
//
// This file locks the ID-shape contract.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
// ISO timestamp with `:` and `.` replaced by `-`, followed by `_<uuid>`.
const REPORT_ID_RE = new RegExp(
  `^\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z_${UUID_RE.source}$`,
);

function makeId(now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}_${randomUUID()}`;
}

describe('runResilienceHealthAlert — report ID crypto-secure contract', () => {
  it('produces the shape `<iso-ts>_<uuid>`', () => {
    const id = makeId(new Date('2026-05-27T12:34:56.789Z'));
    expect(id).toMatch(REPORT_ID_RE);
  });

  it('two consecutive IDs differ', () => {
    const a = makeId(new Date());
    const b = makeId(new Date());
    expect(a).not.toBe(b);
  });

  it('IDs sort lexicographically by arrival timestamp', () => {
    const a = makeId(new Date('2026-05-27T00:00:00.000Z'));
    const b = makeId(new Date('2026-05-27T01:00:00.000Z'));
    expect(a < b).toBe(true);
  });
});
