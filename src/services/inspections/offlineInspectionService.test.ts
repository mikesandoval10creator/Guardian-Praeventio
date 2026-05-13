// Praeventio Guard — Sprint 41 F.6 tests para offlineInspectionService.

import { describe, expect, it } from 'vitest';
import {
  computeSessionId,
  markSynced,
  prepareForSync,
  recordObservation,
  startInspection,
  validateSession,
  type InspectionSession,
  type InspectionTemplate,
} from './offlineInspectionService';

const ctxBase = {
  projectId: 'proj-1',
  workerUid: 'worker-1',
  startedAt: '2026-05-12T10:00:00.000Z',
};

const sampleTemplate: InspectionTemplate = {
  id: 'tpl-daily-safety',
  title: 'Inspección diaria de seguridad',
  items: [
    { id: 'epp', label: 'EPP completo', kind: 'yes_no' },
    { id: 'photo-site', label: 'Foto del frente', kind: 'photo' },
    { id: 'notes', label: 'Observaciones', kind: 'text' },
    { id: 'rating', label: 'Estado general', kind: 'rating' },
    { id: 'optional-comment', label: 'Comentario opcional', kind: 'text', required: false },
  ],
};

describe('computeSessionId', () => {
  it('is deterministic for the same inputs', () => {
    const a = computeSessionId('tpl-1', 'p', 'w', 's');
    const b = computeSessionId('tpl-1', 'p', 'w', 's');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('changes when any input changes', () => {
    const base = computeSessionId('tpl-1', 'p', 'w', 's');
    expect(computeSessionId('tpl-2', 'p', 'w', 's')).not.toBe(base);
    expect(computeSessionId('tpl-1', 'p2', 'w', 's')).not.toBe(base);
    expect(computeSessionId('tpl-1', 'p', 'w2', 's')).not.toBe(base);
    expect(computeSessionId('tpl-1', 'p', 'w', 's2')).not.toBe(base);
  });
});

describe('startInspection', () => {
  it('returns a session with deterministic id', () => {
    const s1 = startInspection('tpl-1', ctxBase);
    const s2 = startInspection('tpl-1', ctxBase);
    expect(s1.id).toBe(s2.id);
    expect(s1.templateId).toBe('tpl-1');
    expect(s1.projectId).toBe('proj-1');
    expect(s1.workerUid).toBe('worker-1');
    expect(s1.startedAt).toBe(ctxBase.startedAt);
    expect(s1.observations).toEqual([]);
    expect(s1.syncStatus).toBe('draft');
  });

  it('throws when required fields missing', () => {
    expect(() => startInspection('', ctxBase)).toThrow();
    expect(() => startInspection('t', { ...ctxBase, projectId: '' })).toThrow();
    expect(() => startInspection('t', { ...ctxBase, workerUid: '' })).toThrow();
    expect(() => startInspection('t', { ...ctxBase, startedAt: '' })).toThrow();
  });
});

describe('recordObservation', () => {
  const base: InspectionSession = startInspection('tpl-1', ctxBase);

  it('appends a new observation immutably', () => {
    const next = recordObservation(base, 'epp', true);
    expect(base.observations).toEqual([]);
    expect(next.observations).toHaveLength(1);
    expect(next.observations[0]).toMatchObject({ itemId: 'epp', response: true });
    expect(next).not.toBe(base);
  });

  it('replaces an existing observation for the same item', () => {
    const a = recordObservation(base, 'epp', false);
    const b = recordObservation(a, 'epp', true, { notes: 'corregido' });
    expect(b.observations).toHaveLength(1);
    expect(b.observations[0]).toMatchObject({
      itemId: 'epp',
      response: true,
      notes: 'corregido',
    });
  });

  it('preserves observations of other items', () => {
    const a = recordObservation(base, 'epp', true);
    const b = recordObservation(a, 'rating', 5);
    expect(b.observations).toHaveLength(2);
    expect(b.observations.map((o) => o.itemId).sort()).toEqual(['epp', 'rating']);
  });

  it('accepts optional extras (location, photoBlob)', () => {
    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const next = recordObservation(base, 'photo-site', undefined, {
      photoBlob: blob,
      locationLatLng: { lat: -33.4, lng: -70.6 },
    });
    expect(next.observations[0].photoBlob).toBe(blob);
    expect(next.observations[0].locationLatLng).toEqual({ lat: -33.4, lng: -70.6 });
  });

  it('throws if itemId is empty', () => {
    expect(() => recordObservation(base, '', true)).toThrow();
  });
});

describe('validateSession', () => {
  it('returns invalid when no observations recorded', () => {
    const session = startInspection(sampleTemplate.id, ctxBase);
    const result = validateSession(session, sampleTemplate);
    expect(result.valid).toBe(false);
    expect(result.missingItemIds).toEqual(['epp', 'photo-site', 'notes', 'rating']);
  });

  it('ignores items flagged required: false', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = recordObservation(s, 'epp', true);
    s = recordObservation(s, 'notes', 'todo ok');
    s = recordObservation(s, 'rating', 4);
    s = recordObservation(s, 'photo-site', undefined, {
      photoBlob: new Blob(['x']),
    });
    const result = validateSession(s, sampleTemplate);
    expect(result.valid).toBe(true);
    expect(result.missingItemIds).toEqual([]);
  });

  it('treats photo as missing if neither blob nor storage path present', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = recordObservation(s, 'epp', true);
    s = recordObservation(s, 'notes', 'ok');
    s = recordObservation(s, 'rating', 3);
    // photo-site queda sin blob -> missing
    const result = validateSession(s, sampleTemplate);
    expect(result.valid).toBe(false);
    expect(result.missingItemIds).toEqual(['photo-site']);
  });

  it('accepts a photo recorded via photoStoragePath only', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = recordObservation(s, 'epp', true);
    s = recordObservation(s, 'notes', 'ok');
    s = recordObservation(s, 'rating', 3);
    s = {
      ...s,
      observations: [
        ...s.observations,
        { itemId: 'photo-site', response: undefined, photoStoragePath: 'gs://bucket/x.jpg' },
      ],
    };
    const result = validateSession(s, sampleTemplate);
    expect(result.valid).toBe(true);
  });

  it('treats empty string response as missing', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = recordObservation(s, 'epp', true);
    s = recordObservation(s, 'notes', '');
    s = recordObservation(s, 'rating', 3);
    s = recordObservation(s, 'photo-site', undefined, { photoBlob: new Blob(['x']) });
    const result = validateSession(s, sampleTemplate);
    expect(result.valid).toBe(false);
    expect(result.missingItemIds).toContain('notes');
  });
});

describe('prepareForSync', () => {
  it('omits Blob fields and emits storage path placeholders', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = recordObservation(s, 'epp', true);
    s = recordObservation(s, 'photo-site', undefined, {
      photoBlob: new Blob(['fake']),
    });

    const serialized = prepareForSync(s);
    const photo = serialized.observations.find((o) => o.itemId === 'photo-site');
    expect(photo?.photoStoragePath).toBe('pending-upload://photo-site');
    // No debe haber Blob serializable en la salida
    expect(JSON.stringify(serialized)).not.toContain('[object Blob]');
  });

  it('keeps explicit photoStoragePath when present', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = {
      ...s,
      observations: [
        { itemId: 'photo-site', response: undefined, photoStoragePath: 'gs://b/x.jpg' },
      ],
    };
    const serialized = prepareForSync(s);
    expect(serialized.observations[0].photoStoragePath).toBe('gs://b/x.jpg');
  });

  it('promotes draft status to pending_sync', () => {
    const s = startInspection(sampleTemplate.id, ctxBase);
    const serialized = prepareForSync(s);
    expect(serialized.syncStatus).toBe('pending_sync');
  });

  it('preserves non-draft status', () => {
    const s = { ...startInspection(sampleTemplate.id, ctxBase), syncStatus: 'syncing' as const };
    const serialized = prepareForSync(s);
    expect(serialized.syncStatus).toBe('syncing');
  });

  it('produces JSON-safe output', () => {
    let s = startInspection(sampleTemplate.id, ctxBase);
    s = recordObservation(s, 'epp', true);
    s = recordObservation(s, 'notes', 'ok', {
      locationLatLng: { lat: 1, lng: 2 },
    });
    s = recordObservation(s, 'photo-site', undefined, { photoBlob: new Blob(['x']) });
    const serialized = prepareForSync(s);
    expect(() => JSON.parse(JSON.stringify(serialized))).not.toThrow();
  });
});

describe('markSynced', () => {
  it('sets status to synced and clears error', () => {
    const s: InspectionSession = {
      ...startInspection(sampleTemplate.id, ctxBase),
      syncStatus: 'sync_error',
      syncError: 'network down',
    };
    const next = markSynced(s, '2026-05-12T10:30:00.000Z');
    expect(next.syncStatus).toBe('synced');
    expect(next.syncedAt).toBe('2026-05-12T10:30:00.000Z');
    expect(next.syncError).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const s = startInspection(sampleTemplate.id, ctxBase);
    const next = markSynced(s, '2026-05-12T11:00:00.000Z');
    expect(s.syncStatus).toBe('draft');
    expect(next).not.toBe(s);
  });
});
