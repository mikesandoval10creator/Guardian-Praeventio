import { describe, it, expect } from 'vitest';
import {
  startInspection,
  recordObservation,
  validateSession,
  prepareForSync,
  markSynced,
  markQueued,
  type InspectionTemplate,
  type InspectionContext,
} from './offlineInspectionService.js';

const TEMPLATE: InspectionTemplate = {
  id: 'tpl_altura_v1',
  title: 'Inspección Trabajo en Altura',
  items: [
    { id: 'arnes_ok', label: 'Arnés en buen estado', kind: 'yes_no', required: true },
    { id: 'punto_anclaje', label: 'Punto de anclaje verificado', kind: 'yes_no', required: true },
    { id: 'foto_area', label: 'Foto del área de trabajo', kind: 'photo', required: true },
    { id: 'observaciones', label: 'Observaciones libres', kind: 'text', required: false },
    { id: 'rating_orden', label: 'Rating orden 1-5', kind: 'rating', required: false },
  ],
};

const CTX: InspectionContext = {
  projectId: 'proj_001',
  workerUid: 'w1',
  startedAt: 1735689600000,
};

describe('startInspection', () => {
  it('produce session con todos los campos del context', () => {
    const s = startInspection(TEMPLATE.id, CTX);
    expect(s.templateId).toBe(TEMPLATE.id);
    expect(s.projectId).toBe('proj_001');
    expect(s.workerUid).toBe('w1');
    expect(s.startedAt).toBe(1735689600000);
    expect(s.observations).toEqual([]);
    expect(s.syncStatus).toBe('draft');
  });

  it('id determinístico: mismo input → mismo id', () => {
    const a = startInspection(TEMPLATE.id, CTX);
    const b = startInspection(TEMPLATE.id, CTX);
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('id distinto si cambia templateId', () => {
    const a = startInspection(TEMPLATE.id, CTX);
    const b = startInspection('tpl_other', CTX);
    expect(a.id).not.toBe(b.id);
  });

  it('id distinto si cambia workerUid', () => {
    const a = startInspection(TEMPLATE.id, CTX);
    const b = startInspection(TEMPLATE.id, { ...CTX, workerUid: 'w2' });
    expect(a.id).not.toBe(b.id);
  });

  it('id distinto si cambia startedAt', () => {
    const a = startInspection(TEMPLATE.id, CTX);
    const b = startInspection(TEMPLATE.id, { ...CTX, startedAt: CTX.startedAt + 1 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('recordObservation — inmutabilidad', () => {
  it('no muta la sesión original', () => {
    const s0 = startInspection(TEMPLATE.id, CTX);
    const obsSnapshot = s0.observations;
    const s1 = recordObservation(s0, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    expect(s0.observations).toBe(obsSnapshot);
    expect(s0.observations).toHaveLength(0);
    expect(s1.observations).toHaveLength(1);
    expect(s1).not.toBe(s0);
  });

  it('appendea observación nueva', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'punto_anclaje', { kind: 'yes_no', value: 'no' });
    expect(s.observations).toHaveLength(2);
    expect(s.observations.map((o) => o.itemId).sort()).toEqual([
      'arnes_ok',
      'punto_anclaje',
    ]);
  });

  it('reemplaza observación previa del mismo itemId (última gana)', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'no' });
    expect(s.observations).toHaveLength(1);
    expect(s.observations[0].response).toEqual({ kind: 'yes_no', value: 'no' });
  });

  it('captura notes, photoBlobRef y locationLatLng cuando vienen', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(
      s,
      'foto_area',
      { kind: 'photo', blobRef: 'idb://blob/abc' },
      {
        notes: 'área despejada',
        photoBlobRef: 'idb://blob/abc',
        locationLatLng: { lat: -33.45, lng: -70.66 },
      },
    );
    const o = s.observations[0];
    expect(o.notes).toBe('área despejada');
    expect(o.photoBlobRef).toBe('idb://blob/abc');
    expect(o.locationLatLng).toEqual({ lat: -33.45, lng: -70.66 });
  });
});

describe('validateSession', () => {
  it('valid=true cuando todos los required están respondidos', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'punto_anclaje', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'foto_area', { kind: 'photo', blobRef: 'idb://x' });
    const v = validateSession(s, TEMPLATE);
    expect(v.valid).toBe(true);
    expect(v.missingRequired).toEqual([]);
  });

  it('valid=false con required faltantes listados', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    const v = validateSession(s, TEMPLATE);
    expect(v.valid).toBe(false);
    expect(v.missingRequired.sort()).toEqual(['foto_area', 'punto_anclaje']);
  });

  it('ignora items opcionales no respondidos', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'punto_anclaje', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'foto_area', { kind: 'photo', blobRef: 'idb://x' });
    // observaciones y rating quedan sin responder pero son opcionales
    const v = validateSession(s, TEMPLATE);
    expect(v.valid).toBe(true);
  });

  it('invalid si templateId no coincide', () => {
    const s = startInspection('tpl_other', CTX);
    const v = validateSession(s, TEMPLATE);
    expect(v.valid).toBe(false);
    expect(v.missingRequired.length).toBeGreaterThan(0);
  });
});

describe('prepareForSync', () => {
  it('produce payload JSON-safe (sin Blob, photoBlobRef → storage path)', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(
      s,
      'foto_area',
      { kind: 'photo', blobRef: 'idb://blob/local-abc' },
      { photoBlobRef: 'idb://blob/local-abc' },
    );
    const payload = prepareForSync(s);
    // JSON.stringify no debería fallar
    expect(() => JSON.stringify(payload)).not.toThrow();
    const obs = payload.observations[0];
    expect(obs.photoStoragePath).toBe(`inspections/${s.id}/foto_area.jpg`);
    // El blobRef original local NO debe filtrarse
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('idb://blob/local-abc');
    // El response.photo.blobRef debe apuntar al storage path, no al local
    expect(obs.response).toEqual({
      kind: 'photo',
      blobRef: `inspections/${s.id}/foto_area.jpg`,
    });
  });

  it('preserva respuestas no-foto tal cual', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'arnes_ok', { kind: 'yes_no', value: 'yes' });
    s = recordObservation(s, 'observaciones', { kind: 'text', value: 'todo ok' });
    s = recordObservation(s, 'rating_orden', { kind: 'rating', value: 4 });
    const payload = prepareForSync(s);
    const byId = Object.fromEntries(payload.observations.map((o) => [o.itemId, o]));
    expect(byId.arnes_ok.response).toEqual({ kind: 'yes_no', value: 'yes' });
    expect(byId.observaciones.response).toEqual({ kind: 'text', value: 'todo ok' });
    expect(byId.rating_orden.response).toEqual({ kind: 'rating', value: 4 });
    expect(byId.arnes_ok.photoStoragePath).toBeUndefined();
  });

  it('no incluye photoStoragePath cuando no hay foto', () => {
    let s = startInspection(TEMPLATE.id, CTX);
    s = recordObservation(s, 'observaciones', { kind: 'text', value: 'nada' });
    const payload = prepareForSync(s);
    expect(payload.observations[0].photoStoragePath).toBeUndefined();
  });
});

describe('markSynced / markQueued — transiciones', () => {
  it('markQueued: draft → queued (inmutable)', () => {
    const s0 = startInspection(TEMPLATE.id, CTX);
    const s1 = markQueued(s0);
    expect(s0.syncStatus).toBe('draft');
    expect(s1.syncStatus).toBe('queued');
    expect(s1).not.toBe(s0);
  });

  it('markSynced: setea status=synced y syncedAt (inmutable)', () => {
    const s0 = startInspection(TEMPLATE.id, CTX);
    const s1 = markSynced(s0, 1735690000000);
    expect(s0.syncStatus).toBe('draft');
    expect(s0.syncedAt).toBeUndefined();
    expect(s1.syncStatus).toBe('synced');
    expect(s1.syncedAt).toBe(1735690000000);
  });
});
