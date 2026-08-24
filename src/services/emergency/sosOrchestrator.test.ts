import { describe, it, expect } from 'vitest';
import {
  buildSosOrchestration,
  SosContextValidationError,
  type SosContext,
} from './sosOrchestrator.js';
import {
  addBreadcrumb,
  emptyBreadcrumbState,
} from './gpsBreadcrumbTracker.js';

const FIXED_NOW_MS = Date.parse('2026-05-13T12:00:00Z');

function makeCtx(over: Partial<SosContext> = {}): SosContext {
  const base: SosContext = {
    workerUid: 'worker-1',
    projectId: 'proj-cl',
    coords: { lat: -33.45, lng: -70.66, accuracyMeters: 12 },
    reportedAt: '2026-05-13T12:00:00Z',
    reasonCode: 'manual',
    clientEventId: 'evt-uuid-1',
  };
  return { ...base, ...over };
}

describe('buildSosOrchestration', () => {
  it('happy path: produce plan completo con todos los componentes', () => {
    const plan = buildSosOrchestration(makeCtx(), { now: () => FIXED_NOW_MS });

    expect(plan.meshPacket.type).toBe('sos');
    expect(plan.meshPacket.priority).toBe('sos');
    expect(plan.meshPacket.fromUid).toBe('worker-1');
    expect(plan.meshPacket.toUid).toBe('broadcast');

    expect(plan.outboxEntry.event.clientEventId).toBe('evt-uuid-1');
    expect(plan.outboxEntry.event.workerUid).toBe('worker-1');

    // [P0][VIDA] 2026-08-17 — Brecha latente: el orchestrator debe copiar
    // ctx.projectId al outboxEvent, sino sosOutboxClient.sendSos() falla-cerrado
    // con { ok: false, error: 'missing_projectId' } y dead-letterea el evento
    // antes del primer envío. El mesh packet ya incluía projectId; el outbox
    // debe ser consistente. Verificado contra ticket 3c0aa66d-73fe-81d5-85f5-ed494aca08f3.
    expect(plan.outboxEntry.event.projectId).toBe('proj-cl');

    expect(plan.emergencyNumbers.regionCode).toBe('CL');
    expect(plan.emergencyNumbers.medical).toBe('131');

    expect(plan.disclaimer).toMatch(/no detenemos maquinaria/i);
    expect(plan.breadcrumbs).toEqual([]);
    expect(plan.breadcrumbPackets).toEqual([]);
  });

  it('idempotency: clientEventId se preserva end-to-end', () => {
    const plan = buildSosOrchestration(
      makeCtx({ clientEventId: 'unique-key-xyz' }),
      { now: () => FIXED_NOW_MS },
    );
    expect(plan.outboxEntry.event.clientEventId).toBe('unique-key-xyz');
  });

  it('sin coords: usa fallback location y números Chile', () => {
    const plan = buildSosOrchestration(makeCtx({ coords: undefined }), {
      now: () => FIXED_NOW_MS,
    });
    const payload = plan.meshPacket.payload as {
      location: { lat: number; lng: number; accuracyM: number };
    };
    expect(payload.location).toEqual({ lat: 0, lng: 0, accuracyM: -1 });
    expect(plan.emergencyNumbers.regionCode).toBe('CL');
    expect(plan.outboxEntry.event.coords).toBeUndefined();
  });

  it('reasonCode "fall" mapea a triggerReason "fall_detected"', () => {
    const plan = buildSosOrchestration(makeCtx({ reasonCode: 'fall' }), {
      now: () => FIXED_NOW_MS,
    });
    const payload = plan.meshPacket.payload as { triggerReason: string };
    expect(payload.triggerReason).toBe('fall_detected');
    expect(plan.outboxEntry.event.reason).toBe('fall_detected');
  });

  it('reasonCode "gas" mapea a outbox "gas_alert"', () => {
    const plan = buildSosOrchestration(makeCtx({ reasonCode: 'gas' }), {
      now: () => FIXED_NOW_MS,
    });
    expect(plan.outboxEntry.event.reason).toBe('gas_alert');
  });

  it('regionCode explícito override del GPS', () => {
    // Coords de Chile pero regionCode AR → debe ganar AR
    const plan = buildSosOrchestration(
      makeCtx({
        coords: { lat: -33.45, lng: -70.66 },
        regionCode: 'AR',
      }),
      { now: () => FIXED_NOW_MS },
    );
    expect(plan.emergencyNumbers.regionCode).toBe('AR');
    expect(plan.emergencyNumbers.medical).toBe('107');
  });

  it('coords en distintos países devuelven números correctos', () => {
    const lima = buildSosOrchestration(
      makeCtx({ coords: { lat: -12.05, lng: -77.05 } }),
      { now: () => FIXED_NOW_MS },
    );
    expect(lima.emergencyNumbers.regionCode).toBe('PE');
    expect(lima.emergencyNumbers.medical).toBe('106');

    const madrid = buildSosOrchestration(
      makeCtx({ coords: { lat: 40.4, lng: -3.7 } }),
      { now: () => FIXED_NOW_MS },
    );
    expect(madrid.emergencyNumbers.regionCode).toBe('ES');
    expect(madrid.emergencyNumbers.universal).toBe('112');

    const london = buildSosOrchestration(
      makeCtx({ coords: { lat: 51.5, lng: -0.12 } }),
      { now: () => FIXED_NOW_MS },
    );
    expect(london.emergencyNumbers.regionCode).toBe('GB');
    expect(london.emergencyNumbers.medical).toBe('999');
  });

  it('con breadcrumb state: anexa packets de breadcrumbs en orden asc', () => {
    const now = new Date(FIXED_NOW_MS);
    let state = emptyBreadcrumbState();
    state = addBreadcrumb(
      state,
      {
        lat: -33.4,
        lng: -70.6,
        accuracyMeters: 10,
        capturedAt: new Date(FIXED_NOW_MS - 15 * 60_000).toISOString(),
      },
      now,
    );
    state = addBreadcrumb(
      state,
      {
        lat: -33.42,
        lng: -70.62,
        accuracyMeters: 8,
        capturedAt: new Date(FIXED_NOW_MS - 5 * 60_000).toISOString(),
      },
      now,
    );

    const plan = buildSosOrchestration(makeCtx(), {
      now: () => FIXED_NOW_MS,
      breadcrumbState: state,
    });
    expect(plan.breadcrumbs).toHaveLength(2);
    expect(plan.breadcrumbPackets).toHaveLength(2);
    plan.breadcrumbPackets.forEach((p) => {
      expect(p.type).toBe('gps_breadcrumb');
      expect(p.priority).toBe('low');
      expect(p.ttl).toBe(3);
    });
    // Asc por capturedAt
    const times = plan.breadcrumbs.map((b) => Date.parse(b.capturedAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('respeta maxBreadcrumbs (cap en plan, no en state)', () => {
    const now = new Date(FIXED_NOW_MS);
    let state = emptyBreadcrumbState();
    for (let i = 0; i < 10; i += 1) {
      state = addBreadcrumb(
        state,
        {
          lat: -33.4,
          lng: -70.6,
          accuracyMeters: 5,
          capturedAt: new Date(FIXED_NOW_MS - (10 - i) * 60_000).toISOString(),
        },
        now,
      );
    }
    const plan = buildSosOrchestration(makeCtx(), {
      now: () => FIXED_NOW_MS,
      breadcrumbState: state,
      maxBreadcrumbs: 3,
    });
    expect(plan.breadcrumbs).toHaveLength(3);
    expect(plan.breadcrumbPackets).toHaveLength(3);
  });

  it('notes se propagan a payload y outbox', () => {
    const plan = buildSosOrchestration(
      makeCtx({ notes: 'compañero atrapado bajo viga' }),
      { now: () => FIXED_NOW_MS },
    );
    const payload = plan.meshPacket.payload as { notes?: string };
    expect(payload.notes).toBe('compañero atrapado bajo viga');
    expect(plan.outboxEntry.event.notes).toBe('compañero atrapado bajo viga');
  });

  it('disclaimer siempre presente (directiva 2)', () => {
    const plan = buildSosOrchestration(makeCtx(), { now: () => FIXED_NOW_MS });
    expect(plan.disclaimer.length).toBeGreaterThan(20);
  });

  // [P0][VIDA] Ticket Hy3-audit 3c3aa66d-73fe-8182-a4d3-e5050bab182e
  // (reabierto 2026-08-24): el orchestrator debe lanzar si los campos
  // requeridos del SosContext están vacíos. Sin guard, el mesh packet
  // sale con fromUid='' y el outbox con clientEventId='' → idempotencia
  // end-to-end rota (todos los SOS colisionan al mismo id en el servidor).
  it('lanza SosContextValidationError si workerUid está vacío', () => {
    expect(() =>
      buildSosOrchestration(makeCtx({ workerUid: '' }), { now: () => FIXED_NOW_MS }),
    ).toThrow(SosContextValidationError);
  });

  it('lanza SosContextValidationError si projectId está vacío', () => {
    expect(() =>
      buildSosOrchestration(makeCtx({ projectId: '' }), { now: () => FIXED_NOW_MS }),
    ).toThrow(SosContextValidationError);
  });

  it('lanza SosContextValidationError si clientEventId está vacío', () => {
    expect(() =>
      buildSosOrchestration(makeCtx({ clientEventId: '' }), { now: () => FIXED_NOW_MS }),
    ).toThrow(SosContextValidationError);
  });

  it('el error reporta todos los campos faltantes en `missing`', () => {
    try {
      buildSosOrchestration(
        makeCtx({ workerUid: '', projectId: '', clientEventId: '' }),
        { now: () => FIXED_NOW_MS },
      );
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SosContextValidationError);
      const e = err as SosContextValidationError;
      expect(e.missing).toEqual(
        expect.arrayContaining(['workerUid', 'projectId', 'clientEventId']),
      );
    }
  });
});
