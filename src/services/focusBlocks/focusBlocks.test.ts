import { describe, it, expect } from 'vitest';
import {
  validateInputs,
  deriveStatus,
  overlaps,
  groupByDay,
  weekDates,
  FOCUS_BLOCK_KINDS,
  type FocusBlock,
} from './focusBlocks.js';

const NOW = new Date('2026-05-13T12:00:00Z'); // miércoles 2026-05-13 UTC

function block(over: Partial<FocusBlock> = {}): FocusBlock {
  return {
    id: 'b1',
    uid: 'u1',
    startsAt: '2026-05-13T14:00:00Z',
    endsAt: '2026-05-13T16:00:00Z',
    kind: 'inspection',
    createdAt: '2026-05-13T10:00:00Z',
    ...over,
  };
}

describe('validateInputs', () => {
  it('válido: kind inspection, 2h duración', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: '2026-05-14T09:00:00Z',
      endsAt: '2026-05-14T11:00:00Z',
      kind: 'inspection',
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('inválido: uid vacío', () => {
    const r = validateInputs({
      uid: '   ',
      startsAt: '2026-05-14T09:00:00Z',
      endsAt: '2026-05-14T11:00:00Z',
      kind: 'inspection',
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('uid requerido');
  });

  it('inválido: kind desconocido', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: '2026-05-14T09:00:00Z',
      endsAt: '2026-05-14T11:00:00Z',
      // @ts-expect-error: probamos un valor fuera de la unión
      kind: 'meeting',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('kind inválido'))).toBe(true);
  });

  it('inválido: startsAt >= endsAt', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: '2026-05-14T11:00:00Z',
      endsAt: '2026-05-14T11:00:00Z',
      kind: 'inspection',
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('startsAt debe ser anterior a endsAt');
  });

  it('inválido: duración > 12h', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: '2026-05-14T00:00:00Z',
      endsAt: '2026-05-14T13:00:00Z',
      kind: 'admin',
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('Duración máxima por bloque: 12 horas');
  });

  it('inválido: nota muy larga', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: '2026-05-14T09:00:00Z',
      endsAt: '2026-05-14T10:00:00Z',
      kind: 'admin',
      note: 'x'.repeat(281),
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('Nota máxima 280 caracteres');
  });

  it('inválido: fecha mal formada', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: 'no-es-fecha',
      endsAt: '2026-05-14T10:00:00Z',
      kind: 'admin',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('startsAt inválido'))).toBe(true);
  });

  it('acepta Date además de string ISO', () => {
    const r = validateInputs({
      uid: 'u1',
      startsAt: new Date('2026-05-14T09:00:00Z'),
      endsAt: new Date('2026-05-14T10:00:00Z'),
      kind: 'training',
    });
    expect(r.ok).toBe(true);
  });

  it('FOCUS_BLOCK_KINDS cubre los 4 kinds del spec', () => {
    expect(FOCUS_BLOCK_KINDS).toEqual([
      'inspection',
      'training',
      'audit',
      'admin',
    ]);
  });
});

describe('deriveStatus', () => {
  it('upcoming si now < startsAt', () => {
    expect(deriveStatus(block(), new Date('2026-05-13T13:00:00Z'))).toBe('upcoming');
  });
  it('active si now entre startsAt y endsAt', () => {
    expect(deriveStatus(block(), new Date('2026-05-13T15:00:00Z'))).toBe('active');
  });
  it('past si now > endsAt', () => {
    expect(deriveStatus(block(), new Date('2026-05-13T17:00:00Z'))).toBe('past');
  });
});

describe('overlaps', () => {
  it('detecta solapamiento parcial', () => {
    expect(
      overlaps(
        block(),
        block({ startsAt: '2026-05-13T15:00:00Z', endsAt: '2026-05-13T17:00:00Z' }),
      ),
    ).toBe(true);
  });
  it('NO solapa si son adyacentes (endsAt == startsAt)', () => {
    expect(
      overlaps(
        block(),
        block({ startsAt: '2026-05-13T16:00:00Z', endsAt: '2026-05-13T17:00:00Z' }),
      ),
    ).toBe(false);
  });
  it('NO solapa si están separados en días distintos', () => {
    expect(
      overlaps(
        block(),
        block({ startsAt: '2026-05-14T14:00:00Z', endsAt: '2026-05-14T16:00:00Z' }),
      ),
    ).toBe(false);
  });
});

describe('groupByDay', () => {
  it('agrupa por día UTC y ordena por startsAt', () => {
    const blocks: FocusBlock[] = [
      block({ id: 'b1', startsAt: '2026-05-13T16:00:00Z', endsAt: '2026-05-13T17:00:00Z' }),
      block({ id: 'b2', startsAt: '2026-05-13T08:00:00Z', endsAt: '2026-05-13T09:00:00Z' }),
      block({ id: 'b3', startsAt: '2026-05-14T10:00:00Z', endsAt: '2026-05-14T11:00:00Z' }),
    ];
    const g = groupByDay(blocks);
    expect(Array.from(g.keys()).sort()).toEqual(['2026-05-13', '2026-05-14']);
    expect(g.get('2026-05-13')!.map((b) => b.id)).toEqual(['b2', 'b1']);
    expect(g.get('2026-05-14')!.map((b) => b.id)).toEqual(['b3']);
  });
});

describe('weekDates', () => {
  it('devuelve 7 días con lunes como primer día', () => {
    const days = weekDates(NOW); // miércoles 2026-05-13
    expect(days).toHaveLength(7);
    // 2026-05-13 es miércoles → lunes = 2026-05-11
    expect(days[0].toISOString().slice(0, 10)).toBe('2026-05-11');
    expect(days[6].toISOString().slice(0, 10)).toBe('2026-05-17');
  });
  it('funciona si ref es domingo', () => {
    const days = weekDates(new Date('2026-05-17T12:00:00Z'));
    expect(days[0].toISOString().slice(0, 10)).toBe('2026-05-11');
  });
  it('funciona si ref es lunes', () => {
    const days = weekDates(new Date('2026-05-11T05:00:00Z'));
    expect(days[0].toISOString().slice(0, 10)).toBe('2026-05-11');
  });
});
