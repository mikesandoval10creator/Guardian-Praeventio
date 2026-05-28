// Tests §12.7.3 — Reconocimiento social Muro Dinámico.

import { describe, it, expect } from 'vitest';
import {
  createRecognition,
  checkRateLimit,
  calculateRecipientXp,
  buildLeaderboard,
  filterWallFeed,
  formatRecognitionForWall,
  WallEngineError,
  type Recognition,
} from './wallEngine';

const baseInput = {
  id: 'rec-1',
  kind: 'kudos_seguridad' as const,
  recipientUid: 'uid-recipient',
  emitterUid: 'uid-emitter',
  emittedAt: '2026-05-21T10:00:00.000Z',
  tenantId: 't-test',
  projectId: 'p-test',
};

describe('createRecognition', () => {
  it('crea recognition con XP por kind', () => {
    const r = createRecognition(baseInput);
    expect(r.xpAwarded).toBe(15); // kudos_seguridad
    expect(r.visibility).toBe('public'); // default
  });

  it('XP por kind: enterado=5, kudos=15, mentor=25, obs=10, cero=50', () => {
    expect(createRecognition({ ...baseInput, kind: 'enterado_aplicando' }).xpAwarded).toBe(5);
    expect(createRecognition({ ...baseInput, kind: 'mentor_del_dia' }).xpAwarded).toBe(25);
    expect(createRecognition({ ...baseInput, kind: 'observacion_positiva' }).xpAwarded).toBe(10);
    expect(createRecognition({ ...baseInput, kind: 'cero_accidentes_mes' }).xpAwarded).toBe(50);
  });

  it('rechaza self-recognition', () => {
    try {
      createRecognition({ ...baseInput, emitterUid: baseInput.recipientUid });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as WallEngineError).code).toBe('self_recognition_forbidden');
    }
  });

  it('rechaza comment muy largo', () => {
    try {
      createRecognition({ ...baseInput, comment: 'a'.repeat(501) });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as WallEngineError).code).toBe('comment_too_long');
    }
  });

  it('rechaza emittedAt inválido', () => {
    try {
      createRecognition({ ...baseInput, emittedAt: 'no-iso' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as WallEngineError).code).toBe('invalid_at');
    }
  });

  it('acepta visibility custom', () => {
    const r = createRecognition({ ...baseInput, visibility: 'private' });
    expect(r.visibility).toBe('private');
  });

  it('preserva originRef si se pasa', () => {
    const r = createRecognition({
      ...baseInput,
      originRef: { kind: 'lesson', id: 'l-123' },
    });
    expect(r.originRef).toEqual({ kind: 'lesson', id: 'l-123' });
  });
});

describe('checkRateLimit', () => {
  it('allowed cuando < 10 emisiones hoy', () => {
    const today: Recognition[] = Array.from({ length: 5 }, (_, i) =>
      createRecognition({ ...baseInput, id: `r-${i}` }),
    );
    const result = checkRateLimit(today);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });

  it('blocked en límite', () => {
    const today: Recognition[] = Array.from({ length: 10 }, (_, i) =>
      createRecognition({ ...baseInput, id: `r-${i}` }),
    );
    const result = checkRateLimit(today);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('blocked sobre límite', () => {
    const today: Recognition[] = Array.from({ length: 15 }, (_, i) =>
      createRecognition({ ...baseInput, id: `r-${i}` }),
    );
    const result = checkRateLimit(today);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('allowed cuando array vacío', () => {
    expect(checkRateLimit([]).allowed).toBe(true);
    expect(checkRateLimit([]).remaining).toBe(10);
  });
});

describe('calculateRecipientXp', () => {
  it('suma XP del recipient específico', () => {
    const recs: Recognition[] = [
      createRecognition({ ...baseInput, id: 'r1', kind: 'kudos_seguridad' }),
      createRecognition({ ...baseInput, id: 'r2', kind: 'mentor_del_dia' }),
      createRecognition({ ...baseInput, id: 'r3', kind: 'kudos_seguridad', recipientUid: 'otro' }),
    ];
    expect(calculateRecipientXp(recs, 'uid-recipient')).toBe(15 + 25); // 40
    expect(calculateRecipientXp(recs, 'otro')).toBe(15);
  });

  it('uid sin recognitions → 0', () => {
    expect(calculateRecipientXp([], 'cualquiera')).toBe(0);
  });
});

describe('buildLeaderboard', () => {
  it('ordena por XP descendente', () => {
    const recs: Recognition[] = [
      createRecognition({ ...baseInput, id: 'r1', recipientUid: 'A', kind: 'cero_accidentes_mes' }),
      createRecognition({ ...baseInput, id: 'r2', recipientUid: 'B', kind: 'kudos_seguridad' }),
      createRecognition({ ...baseInput, id: 'r3', recipientUid: 'B', kind: 'mentor_del_dia' }),
    ];
    const lb = buildLeaderboard(recs);
    expect(lb[0]?.uid).toBe('A'); // 50 XP
    expect(lb[0]?.xp).toBe(50);
    expect(lb[1]?.uid).toBe('B'); // 15+25=40
    expect(lb[1]?.xp).toBe(40);
    expect(lb[1]?.recognitionsCount).toBe(2);
  });

  it('topN limita', () => {
    const recs: Recognition[] = Array.from({ length: 15 }, (_, i) =>
      createRecognition({
        ...baseInput,
        id: `r-${i}`,
        recipientUid: `uid-${i}`,
      }),
    );
    expect(buildLeaderboard(recs, 5)).toHaveLength(5);
  });

  it('array vacío → vacío', () => {
    expect(buildLeaderboard([])).toEqual([]);
  });
});

describe('filterWallFeed', () => {
  it('public visible para todos', () => {
    const r = createRecognition({ ...baseInput, visibility: 'public' });
    expect(filterWallFeed([r], 'cualquier-uid', 'worker')).toHaveLength(1);
  });

  it('private solo recipient + supervisor + admin', () => {
    const r = createRecognition({ ...baseInput, visibility: 'private' });
    expect(filterWallFeed([r], 'uid-recipient', 'worker')).toHaveLength(1);
    expect(filterWallFeed([r], 'otro-uid', 'worker')).toHaveLength(0);
    expect(filterWallFeed([r], 'otro-uid', 'supervisor')).toHaveLength(1);
    expect(filterWallFeed([r], 'otro-uid', 'admin')).toHaveLength(1);
  });

  it('team visible para todos del proyecto', () => {
    const r = createRecognition({ ...baseInput, visibility: 'team' });
    expect(filterWallFeed([r], 'uid-cualquier', 'worker')).toHaveLength(1);
  });
});

describe('formatRecognitionForWall', () => {
  it('formatea kudos sin comment', () => {
    const r = createRecognition(baseInput);
    expect(formatRecognitionForWall(r)).toBe('recibió Kudos de Seguridad (+15 XP)');
  });

  it('formatea con comment', () => {
    const r = createRecognition({ ...baseInput, comment: 'Excelente labor' });
    expect(formatRecognitionForWall(r)).toContain('Excelente labor');
    expect(formatRecognitionForWall(r)).toContain('+15 XP');
  });

  it('cero accidentes mensual', () => {
    const r = createRecognition({ ...baseInput, kind: 'cero_accidentes_mes' });
    expect(formatRecognitionForWall(r)).toContain('Cero Accidentes del Mes');
    expect(formatRecognitionForWall(r)).toContain('+50 XP');
  });
});

describe('robustez WallEngineError', () => {
  it('codes accesibles en error class', () => {
    try {
      createRecognition({ ...baseInput, emitterUid: baseInput.recipientUid });
    } catch (e) {
      expect(e).toBeInstanceOf(WallEngineError);
      expect((e as WallEngineError).code).toBe('self_recognition_forbidden');
    }
  });
});
