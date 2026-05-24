// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase C.3.
//
// Emulator round-trip para `siteBookStore.nextSequenceForYear` — counter
// custom que NO va por el factory genérico. Verifica:
//   1. Primer call de un año retorna 1
//   2. Calls subsiguientes incrementan
//   3. Counter es por-año (2026 y 2027 son independientes)
//   4. Counter es por-proyecto (proj-A y proj-B son independientes)

import { describe, it, expect, beforeEach } from 'vitest';
import { nextSequenceForYear } from './siteBookStore';

const PROJECT_ID = 'p-sitebook-counter-test';

describe('siteBookStore.nextSequenceForYear — emulator', () => {
  it('primer call del año retorna 1', async () => {
    const n = await nextSequenceForYear(PROJECT_ID, 2026);
    expect(n).toBe(1);
  });

  it('calls subsiguientes incrementan secuencialmente', async () => {
    const first = await nextSequenceForYear(PROJECT_ID, 2026);
    const second = await nextSequenceForYear(PROJECT_ID, 2026);
    const third = await nextSequenceForYear(PROJECT_ID, 2026);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(third).toBe(3);
  });

  it('counter es independiente por año', async () => {
    await nextSequenceForYear(PROJECT_ID, 2026);
    await nextSequenceForYear(PROJECT_ID, 2026);
    const year2026 = await nextSequenceForYear(PROJECT_ID, 2026); // = 3
    const year2027First = await nextSequenceForYear(PROJECT_ID, 2027); // = 1
    expect(year2026).toBe(3);
    expect(year2027First).toBe(1);
  });

  it('counter es independiente por proyecto', async () => {
    const projA = 'p-sitebook-counter-A';
    const projB = 'p-sitebook-counter-B';
    // Limpieza dedicada para cada proyecto en este test
    const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
    for (const p of [projA, projB]) {
      await fetch(
        `http://${host}/emulator/v1/projects/${p}/databases/(default)/documents`,
        { method: 'DELETE' },
      ).catch(() => {});
    }

    const a1 = await nextSequenceForYear(projA, 2026);
    const a2 = await nextSequenceForYear(projA, 2026);
    const b1 = await nextSequenceForYear(projB, 2026);
    expect(a1).toBe(1);
    expect(a2).toBe(2);
    expect(b1).toBe(1); // independiente
  });
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  ).catch(() => {});
});
