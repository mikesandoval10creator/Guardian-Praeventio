// Praeventio Guard — Sprint 22 (Bucket Y) tests.
//
// Covers:
//   1. fromEnv() returns null without RESEND_API_KEY
//   2. fromEnv() returns service when key is present
//   3. send() calls resend.emails.send with the correct payload shape
//   4. send() returns { ok:false, error } on Resend API error envelope
//   5. send() catches thrown errors and returns { ok:false, error }
//   6. sendBatch() aggregates counters correctly with mixed outcomes
//   7. Each template renders valid HTML containing the key payload fields

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailService, FROM_DEFAULT } from './resendService.js';
import {
  sosBackupTemplate,
  weeklyDigestTemplate,
  calendarInviteTemplate,
  calendarInviteIcs,
  projectInvitationTemplate,
  incidentAlertTemplate,
} from './templates.js';

function makeMockResend(sendImpl: (payload: any) => any) {
  const send = vi.fn(sendImpl);
  return {
    instance: { emails: { send } } as any,
    send,
  };
}

describe('EmailService.fromEnv', () => {
  const originalKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  });

  it('returns null when RESEND_API_KEY is not set', () => {
    expect(EmailService.fromEnv({})).toBeNull();
  });

  it('returns null when RESEND_API_KEY is empty string', () => {
    expect(EmailService.fromEnv({ RESEND_API_KEY: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns an EmailService when RESEND_API_KEY is present', () => {
    const svc = EmailService.fromEnv({ RESEND_API_KEY: 're_test_key' } as NodeJS.ProcessEnv);
    expect(svc).toBeInstanceOf(EmailService);
    expect(svc!.fromAddress).toBe(FROM_DEFAULT);
  });

  it('respects RESEND_FROM_ADDRESS override', () => {
    const svc = EmailService.fromEnv({
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_ADDRESS: 'Tenant <hi@tenant.example>',
    } as NodeJS.ProcessEnv);
    expect(svc!.fromAddress).toBe('Tenant <hi@tenant.example>');
  });
});

describe('EmailService.send', () => {
  it('calls resend.emails.send with the correct payload shape', async () => {
    const { instance, send } = makeMockResend(() => ({ data: { id: 'msg_abc' } }));
    const svc = new EmailService(instance);
    const result = await svc.send({
      to: 'sup@example.com',
      subject: 'Hola',
      html: '<p>Hola <strong>mundo</strong></p>',
      tag: 'sos-backup',
    });
    expect(result).toEqual({ ok: true, id: 'msg_abc' });
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.from).toBe(FROM_DEFAULT);
    expect(payload.to).toBe('sup@example.com');
    expect(payload.subject).toBe('Hola');
    expect(payload.html).toContain('<strong>mundo</strong>');
    // Auto plain-text fallback should strip HTML.
    expect(payload.text).toContain('Hola mundo');
    expect(payload.text).not.toContain('<strong>');
    expect(payload.tags).toEqual([{ name: 'flow', value: 'sos-backup' }]);
  });

  it('forwards attachments and replyTo', async () => {
    const { instance, send } = makeMockResend(() => ({ data: { id: 'msg_xyz' } }));
    const svc = new EmailService(instance);
    await svc.send({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Test',
      html: '<p>x</p>',
      replyTo: 'reply@example.com',
      attachments: [{ filename: 'invite.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
    });
    const payload = send.mock.calls[0][0];
    expect(payload.replyTo).toBe('reply@example.com');
    expect(payload.attachments).toEqual([
      { filename: 'invite.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' },
    ]);
  });

  it('returns { ok:false, error } when Resend response carries an error envelope', async () => {
    const { instance } = makeMockResend(() => ({
      data: null,
      error: { message: 'rate_limited' },
    }));
    const svc = new EmailService(instance);
    const result = await svc.send({ to: 'x@example.com', subject: 's', html: '<p/>' });
    expect(result).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('returns { ok:false, error } when send throws', async () => {
    const { instance } = makeMockResend(() => {
      throw new Error('network_down');
    });
    const svc = new EmailService(instance);
    const result = await svc.send({ to: 'x@example.com', subject: 's', html: '<p/>' });
    expect(result).toEqual({ ok: false, error: 'network_down' });
  });

  it('returns { ok:false, error: missing_message_id } when response has no id', async () => {
    const { instance } = makeMockResend(() => ({ data: {} }));
    const svc = new EmailService(instance);
    const result = await svc.send({ to: 'x@example.com', subject: 's', html: '<p/>' });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('missing_message_id');
  });
});

describe('EmailService.sendBatch', () => {
  it('aggregates counters across mixed outcomes', async () => {
    const responses = [
      { data: { id: 'm1' } },
      { error: { message: 'bounced' } },
      { data: { id: 'm3' } },
    ];
    let i = 0;
    const { instance } = makeMockResend(() => responses[i++]);
    const svc = new EmailService(instance);
    const result = await svc.sendBatch([
      { to: 'a@x.com', subject: 's', html: '<p/>' },
      { to: 'b@x.com', subject: 's', html: '<p/>' },
      { to: 'c@x.com', subject: 's', html: '<p/>' },
    ]);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(3);
    expect(result.results[1]).toEqual({ ok: false, error: 'bounced' });
  });

  it('handles an empty batch', async () => {
    const { instance } = makeMockResend(() => ({ data: { id: 'never' } }));
    const svc = new EmailService(instance);
    const result = await svc.sendBatch([]);
    expect(result).toEqual({ sent: 0, failed: 0, results: [] });
  });
});

describe('templates render valid HTML with payload fields', () => {
  it('sosBackupTemplate includes worker, project, and timestamp', () => {
    const html = sosBackupTemplate({
      worker: { name: 'Juan Pérez', phone: '+56999999999' },
      project: { id: 'proj_1', name: 'Obra Norte' },
      location: { lat: -33.45, lng: -70.66 },
      timestamp: '2026-05-04T12:34:56Z',
      alertId: 'alert_42',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('Obra Norte');
    expect(html).toContain('2026-05-04T12:34:56Z');
    expect(html).toContain('alert_42');
    expect(html).toContain('SOS');
    expect(html).toContain('google.com/maps');
  });

  it('weeklyDigestTemplate includes stats numbers', () => {
    const html = weeklyDigestTemplate({
      projectId: 'proj_1',
      projectName: 'Obra Norte',
      weekStart: '2026-04-27',
      weekEnd: '2026-05-03',
      findingsCreated: 12,
      findingsClosed: 9,
      processesCompleted: 7,
      crewXpGained: 1450,
      daysWithoutIncident: 21,
      topRisks: [
        { label: 'Caída de altura', count: 5 },
        { label: 'Cortes', count: 3 },
      ],
    });
    expect(html).toContain('Obra Norte');
    expect(html).toContain('12');
    expect(html).toContain('1450');
    expect(html).toContain('Caída de altura');
  });

  it('calendarInviteTemplate + ics produce attachable payload', () => {
    const event = {
      eventId: 'evt_1',
      title: 'Charla 5 minutos',
      description: 'Bloqueo y etiquetado',
      startIso: '2026-05-10T13:00:00Z',
      endIso: '2026-05-10T13:30:00Z',
      location: 'Sala A',
      organizer: { name: 'Ana Soto', email: 'ana@example.com' },
      projectId: 'proj_1',
    };
    const html = calendarInviteTemplate(event);
    expect(html).toContain('Charla 5 minutos');
    expect(html).toContain('Sala A');
    const ics = calendarInviteIcs(event);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('UID:evt_1@praeventio.app');
    expect(ics).toContain('SUMMARY:Charla 5 minutos');
  });

  it('projectInvitationTemplate includes accept link with token', () => {
    const html = projectInvitationTemplate({
      projectName: 'Obra Norte',
      inviterName: 'Daho',
      invitedRole: 'supervisor',
      token: 'abcdef123',
      invitationId: 'inv_1',
    });
    expect(html).toContain('Obra Norte');
    expect(html).toContain('Daho');
    expect(html).toContain('Supervisor');
    expect(html).toContain('token=abcdef123');
    expect(html).toContain('Aceptar invitación');
  });

  it('incidentAlertTemplate uses severity color and includes title', () => {
    const html = incidentAlertTemplate({
      incidentId: 'inc_99',
      severity: 'critical',
      title: 'Caída en altura sector C',
      projectId: 'proj_1',
      projectName: 'Obra Norte',
      occurredAt: '2026-05-04T11:00:00Z',
    });
    expect(html).toContain('Caída en altura sector C');
    expect(html).toContain('Crítica');
    expect(html).toContain('inc_99');
  });
});
