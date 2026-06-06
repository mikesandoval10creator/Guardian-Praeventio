// Tests §12.6.2 — ManDown timer + escalation.

import { describe, it, expect } from 'vitest';
import {
  initManDownEvent,
  tickManDownEvent,
  acknowledgeManDownEvent,
  cancelManDownEvent,
  describeStage,
  timeUntilNextEscalation,
  DEFAULT_MAN_DOWN_CONFIG,
  type ManDownConfig,
} from './manDownTimer';

const config: ManDownConfig = {
  ...DEFAULT_MAN_DOWN_CONFIG,
  supervisorUids: ['sup-1', 'sup-2'],
  cphsUids: ['cphs-1'],
  emergencyBrigadeUids: ['eb-1', 'eb-2'],
};

const baseInput = {
  eventId: 'md-1',
  workerUid: 'worker-1',
  tenantId: 't1',
  projectId: 'p1',
  detectedAt: '2026-05-21T03:00:00.000Z',
  config,
};

describe('initManDownEvent', () => {
  it('inactivity → pre_alert', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    expect(e.stage).toBe('pre_alert');
    expect(e.escalationLog).toHaveLength(1);
  });

  it('fall_detected + skipPreAlert → level_1 directo', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'fall_detected' });
    expect(e.stage).toBe('level_1');
    expect(e.escalationLog[0]?.notifiedUids).toEqual(['sup-1', 'sup-2']);
  });

  it('ble_disconnect → pre_alert', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'ble_disconnect' });
    expect(e.stage).toBe('pre_alert');
  });

  it('preserva lastLocation', () => {
    const e = initManDownEvent({
      ...baseInput,
      trigger: 'inactivity',
      lastLocation: {
        lat: -33.4,
        lng: -70.6,
        accuracyM: 5,
        timestampIso: '2026-05-21T02:59:00.000Z',
      },
    });
    expect(e.lastLocation?.lat).toBe(-33.4);
  });
});

describe('tickManDownEvent', () => {
  it('pre_alert → level_1 después 60s', () => {
    const e0 = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const e1 = tickManDownEvent(e0, '2026-05-21T03:01:00.000Z', config); // +60s
    expect(e1.stage).toBe('level_1');
    expect(e1.escalationLog).toHaveLength(2);
  });

  it('level_1 → level_2 después 60+180s', () => {
    const e0 = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const e1 = tickManDownEvent(e0, '2026-05-21T03:01:00.000Z', config);
    const e2 = tickManDownEvent(e1, '2026-05-21T03:04:00.000Z', config); // 240s total
    expect(e2.stage).toBe('level_2');
    expect(e2.escalationLog).toHaveLength(3);
    expect(e2.escalationLog[2]?.notifiedUids).toEqual(['cphs-1']);
  });

  it('level_2 → level_3 (SAMU) después 540s', () => {
    let event = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    event = tickManDownEvent(event, '2026-05-21T03:01:00.000Z', config); // 60s → level_1
    event = tickManDownEvent(event, '2026-05-21T03:04:00.000Z', config); // 240s → level_2
    event = tickManDownEvent(event, '2026-05-21T03:09:00.000Z', config); // 540s → level_3
    expect(event.stage).toBe('level_3');
    expect(event.escalationLog[3]?.notifiedUids).toEqual(['eb-1', 'eb-2']);
    expect(event.escalationLog[3]?.channel).toBe('voice');
  });

  it('ticks perdidos: salta directo al stage que el tiempo amerita y registra cada escalación cruzada', () => {
    // Un solo tick a +600s desde pre_alert (p.ej. cron se saltó, o el device
    // estuvo offline). Antes esto solo avanzaba a level_1 → SAMU nunca paginado.
    const e0 = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const jumped = tickManDownEvent(e0, '2026-05-21T03:10:00.000Z', config); // +600s ≥ 540
    expect(jumped.stage).toBe('level_3');
    // Se registraron las 3 escalaciones cruzadas (level_1, level_2, level_3),
    // cada una notificando a sus responsables.
    const crossed = jumped.escalationLog.slice(1); // [0] = init pre_alert
    expect(crossed.map((e) => e.stage)).toEqual(['level_1', 'level_2', 'level_3']);
    expect(crossed[0].notifiedUids).toEqual(['sup-1', 'sup-2']);
    expect(crossed[1].notifiedUids).toEqual(['cphs-1']);
    expect(crossed[2].notifiedUids).toEqual(['eb-1', 'eb-2']);
    expect(crossed[2].channel).toBe('voice');
  });

  it('salto parcial: pre_alert a +300s → level_2 (no se queda en level_1)', () => {
    const e0 = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const jumped = tickManDownEvent(e0, '2026-05-21T03:05:00.000Z', config); // +300s (≥240, <540)
    expect(jumped.stage).toBe('level_2');
    expect(jumped.escalationLog.slice(1).map((e) => e.stage)).toEqual(['level_1', 'level_2']);
  });

  it('no avanza si no pasó tiempo suficiente', () => {
    const e0 = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const e1 = tickManDownEvent(e0, '2026-05-21T03:00:30.000Z', config); // +30s
    expect(e1.stage).toBe('pre_alert');
    expect(e1).toBe(e0);
  });

  it('estados terminales no avanzan', () => {
    const e0 = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const ack = acknowledgeManDownEvent(e0, 'sup-1', '2026-05-21T03:00:30.000Z');
    const ticked = tickManDownEvent(ack, '2026-05-21T03:10:00.000Z', config);
    expect(ticked).toBe(ack);
    expect(ticked.stage).toBe('resolved');
  });
});

describe('acknowledgeManDownEvent', () => {
  it('marca como resolved', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const ack = acknowledgeManDownEvent(e, 'sup-1', '2026-05-21T03:00:30.000Z');
    expect(ack.stage).toBe('resolved');
    expect(ack.acknowledgedByUid).toBe('sup-1');
    expect(ack.acknowledgedAt).toBe('2026-05-21T03:00:30.000Z');
  });

  it('no permite ACK sobre cancelled', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const cancelled = cancelManDownEvent(e, 'worker-1', 'falsa alarma', '2026-05-21T03:00:30.000Z');
    expect(() =>
      acknowledgeManDownEvent(cancelled, 'sup-1', '2026-05-21T03:01:00.000Z'),
    ).toThrow();
  });
});

describe('cancelManDownEvent', () => {
  it('marca como cancelled', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const cancelled = cancelManDownEvent(
      e,
      'worker-1',
      'falsa alarma',
      '2026-05-21T03:00:30.000Z',
    );
    expect(cancelled.stage).toBe('cancelled');
  });

  it('no permite cancel sobre resolved', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const ack = acknowledgeManDownEvent(e, 'sup-1', '2026-05-21T03:00:30.000Z');
    expect(() =>
      cancelManDownEvent(ack, 'worker-1', 'falsa', '2026-05-21T03:01:00.000Z'),
    ).toThrow();
  });
});

describe('timeUntilNextEscalation', () => {
  it('pre_alert con 30s pasados → 30s restantes', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const remaining = timeUntilNextEscalation(e, '2026-05-21T03:00:30.000Z', config);
    expect(remaining).toBe(30);
  });

  it('level_3 → 0', () => {
    let event = initManDownEvent({ ...baseInput, trigger: 'fall_detected' });
    event = tickManDownEvent(event, '2026-05-21T03:04:00.000Z', config); // +240s → level_2
    event = tickManDownEvent(event, '2026-05-21T03:09:00.000Z', config); // +540s → level_3
    expect(event.stage).toBe('level_3');
    expect(timeUntilNextEscalation(event, '2026-05-21T03:10:00.000Z', config)).toBe(0);
  });

  it('resolved → null', () => {
    const e = initManDownEvent({ ...baseInput, trigger: 'inactivity' });
    const ack = acknowledgeManDownEvent(e, 'sup-1', '2026-05-21T03:00:30.000Z');
    expect(timeUntilNextEscalation(ack, '2026-05-21T03:01:00.000Z', config)).toBeNull();
  });
});

describe('describeStage', () => {
  it('texto humano por estado', () => {
    expect(describeStage('pre_alert')).toContain('Pre-alerta');
    expect(describeStage('level_3')).toContain('SAMU');
    expect(describeStage('resolved')).toBe('Resuelto');
    expect(describeStage('cancelled')).toBe('Cancelado');
  });
});
