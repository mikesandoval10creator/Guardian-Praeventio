// Praeventio Guard — Sprint 22 (Bucket Y).
//
// Email templates for the Resend service. Templates produce HTML strings
// (no MJML / react-email — keeping zero new deps) and a `text` fallback
// generated automatically by the service.
//
// Style notes:
//   • Brand teal #4db6ac (user color preference, see memory).
//   • Petroleum #014c66 for headings.
//   • Gold #d4af37 reserved for ⭐ accents.
//   • Coral #ff6f61 only on alert/incident templates.
//   • All colors inline; no <link> stylesheets — most webmail strips them.
//   • Single-table layout (no flex/grid) so Outlook 2007–2019 don't choke.
//
// Audit footer: every email carries `auditInfo` so a recipient can
// match an inbox copy to a `audit_logs` row in Firestore — required by
// SUSESO oversight for SOS backup notifications.

const TEAL = '#4db6ac';
const PETROLEUM = '#014c66';
const GOLD = '#d4af37';
const CORAL = '#ff6f61';
const BG = '#f4f4f5';
const CARD = '#ffffff';
const TEXT = '#18181b';
const MUTED = '#71717a';

const APP_URL_DEFAULT = 'https://app.praeventio.app';
const APP_URL = (): string => process.env.APP_URL || APP_URL_DEFAULT;

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function header(): string {
  return `<tr><td style="background:${PETROLEUM};padding:28px 40px;text-align:center">
  <span style="font-size:22px;font-weight:900;color:${TEAL};letter-spacing:-0.5px">PRAEVENTIO</span>
  <span style="font-size:10px;font-weight:700;color:#9ca3af;display:block;letter-spacing:4px;margin-top:2px">GUARD · PREVENCIÓN DE RIESGOS</span>
</td></tr>`;
}

function footer(auditInfo?: { auditId?: string; reason?: string }): string {
  const audit = auditInfo?.auditId
    ? `<p style="margin:4px 0 0;font-size:10px;color:#a1a1aa">Audit ID: ${escapeHtml(auditInfo.auditId)}</p>`
    : '';
  const reason = auditInfo?.reason
    ? `<p style="margin:4px 0 0;font-size:10px;color:#a1a1aa">Razón: ${escapeHtml(auditInfo.reason)}</p>`
    : '';
  const unsub = `${APP_URL()}/notifications/preferences`;
  return `<tr><td style="background:#f9fafb;padding:18px 40px;text-align:center;border-top:1px solid #e4e4e7">
  <p style="margin:0;font-size:11px;color:${MUTED}">© ${new Date().getFullYear()} Praeventio Guard · Plataforma de Prevención de Riesgos</p>
  <p style="margin:6px 0 0;font-size:11px;color:${MUTED}">
    <a href="${unsub}" style="color:${TEAL};text-decoration:none">Preferencias de notificación</a>
  </p>
  ${audit}
  ${reason}
</td></tr>`;
}

function shell(bodyHtml: string, accent: string = TEAL, audit?: { auditId?: string; reason?: string }): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Praeventio</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:${BG};color:${TEXT}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:${CARD};border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border-top:4px solid ${accent}">
${header()}
<tr><td style="padding:36px 40px">${bodyHtml}</td></tr>
${footer(audit)}
</table></td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href: string, label: string, color: string = TEAL): string {
  return `<div style="text-align:center;margin:28px 0">
    <a href="${href}" style="display:inline-block;background:${color};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:0.5px">${escapeHtml(label)}</a>
  </div>`;
}

// ---------------------------------------------------------------------------
// 1. SOS backup template
// ---------------------------------------------------------------------------

export interface SosBackupPayload {
  worker: { name: string; id?: string; phone?: string };
  project: { id: string; name: string };
  location?: { lat: number; lng: number } | null;
  timestamp: string | Date;
  alertId?: string;
}

export function sosBackupTemplate(payload: SosBackupPayload): string {
  const ts = typeof payload.timestamp === 'string'
    ? payload.timestamp
    : payload.timestamp.toISOString();
  const mapsLink = payload.location
    ? `https://www.google.com/maps?q=${payload.location.lat},${payload.location.lng}`
    : null;
  const locationBlock = mapsLink
    ? `<p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Ubicación:</strong>
        <a href="${mapsLink}" style="color:${TEAL};text-decoration:none">${payload.location!.lat.toFixed(5)}, ${payload.location!.lng.toFixed(5)} (abrir en Maps)</a></p>`
    : `<p style="margin:8px 0;font-size:13px;color:${MUTED}">Sin ubicación GPS reportada.</p>`;
  const phoneBlock = payload.worker.phone
    ? `<p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Teléfono:</strong> <a href="tel:${escapeHtml(payload.worker.phone)}" style="color:${TEAL}">${escapeHtml(payload.worker.phone)}</a></p>`
    : '';
  const dashboardLink = `${APP_URL()}/projects/${encodeURIComponent(payload.project.id)}/emergency`;
  const body = `
    <div style="background:#fef2f2;border-left:4px solid ${CORAL};padding:14px 18px;border-radius:6px;margin-bottom:24px">
      <p style="margin:0;font-size:18px;font-weight:900;color:${CORAL}">🚨 ALERTA SOS</p>
      <p style="margin:4px 0 0;font-size:13px;color:${TEXT}">Recibido por email porque la notificación push falló o no fue confirmada.</p>
    </div>
    <h2 style="margin:0 0 16px;font-size:18px;font-weight:800;color:${PETROLEUM}">Trabajador solicita ayuda</h2>
    <p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Trabajador:</strong> ${escapeHtml(payload.worker.name)}</p>
    ${phoneBlock}
    <p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Proyecto:</strong> ${escapeHtml(payload.project.name)}</p>
    <p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Hora:</strong> ${escapeHtml(ts)}</p>
    ${locationBlock}
    ${button(dashboardLink, 'Abrir panel de emergencia', CORAL)}
    <p style="margin:24px 0 0;font-size:12px;color:${MUTED}">Si ya respondiste por radio o teléfono, registra la atención en el panel para cerrar el alert.</p>
  `;
  return shell(body, CORAL, { auditId: payload.alertId, reason: 'SOS push fallback' });
}

// ---------------------------------------------------------------------------
// 2. Weekly digest template
// ---------------------------------------------------------------------------

export interface WeeklyDigestStats {
  projectId: string;
  projectName: string;
  weekStart: string;   // ISO
  weekEnd: string;     // ISO
  findingsCreated: number;
  findingsClosed: number;
  processesCompleted: number;
  crewXpGained: number;
  daysWithoutIncident: number;
  topRisks: { label: string; count: number }[];
}

export function weeklyDigestTemplate(stats: WeeklyDigestStats): string {
  const risksList = stats.topRisks.length === 0
    ? `<li style="color:${MUTED}">Sin riesgos destacados esta semana.</li>`
    : stats.topRisks
        .slice(0, 3)
        .map((r) => `<li style="margin-bottom:6px"><strong>${escapeHtml(r.label)}</strong> <span style="color:${MUTED}">(${r.count})</span></li>`)
        .join('');
  const dashboardLink = `${APP_URL()}/projects/${encodeURIComponent(stats.projectId)}/dashboard`;
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:900;color:${PETROLEUM}">Resumen semanal</h2>
    <p style="margin:0 0 24px;font-size:13px;color:${MUTED}">${escapeHtml(stats.projectName)} · ${escapeHtml(stats.weekStart.slice(0, 10))} → ${escapeHtml(stats.weekEnd.slice(0, 10))}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
      <tr>
        <td style="padding:12px;background:#f0fdfa;border-radius:8px;text-align:center;width:50%">
          <div style="font-size:28px;font-weight:900;color:${TEAL}">${stats.findingsCreated}</div>
          <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px">Hallazgos creados</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#f0fdfa;border-radius:8px;text-align:center;width:50%">
          <div style="font-size:28px;font-weight:900;color:${TEAL}">${stats.findingsClosed}</div>
          <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px">Hallazgos cerrados</div>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
      <tr>
        <td style="padding:12px;background:#fefce8;border-radius:8px;text-align:center;width:33%">
          <div style="font-size:22px;font-weight:900;color:${GOLD}">${stats.processesCompleted}</div>
          <div style="font-size:11px;color:${MUTED}">Procesos</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#fefce8;border-radius:8px;text-align:center;width:33%">
          <div style="font-size:22px;font-weight:900;color:${GOLD}">+${stats.crewXpGained}</div>
          <div style="font-size:11px;color:${MUTED}">XP cuadrillas</div>
        </td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#fefce8;border-radius:8px;text-align:center;width:33%">
          <div style="font-size:22px;font-weight:900;color:${GOLD}">${stats.daysWithoutIncident}</div>
          <div style="font-size:11px;color:${MUTED}">Días sin incidente</div>
        </td>
      </tr>
    </table>
    <h3 style="margin:24px 0 8px;font-size:14px;font-weight:800;color:${PETROLEUM}">Top 3 riesgos identificados</h3>
    <ul style="margin:0;padding:0 0 0 20px;font-size:14px;color:${TEXT}">${risksList}</ul>
    ${button(dashboardLink, 'Ver dashboard completo')}
  `;
  return shell(body, TEAL, { reason: 'Weekly digest (lunes 09:00)' });
}

// ---------------------------------------------------------------------------
// 3. Calendar invite template (.ics generated separately)
// ---------------------------------------------------------------------------

export interface CalendarEventPayload {
  eventId: string;
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
  location?: string;
  organizer?: { name: string; email: string };
  projectId?: string;
}

export function calendarInviteTemplate(event: CalendarEventPayload): string {
  const start = new Date(event.startIso);
  const startFmt = start.toLocaleString('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Santiago',
  });
  const detailsLink = event.projectId
    ? `${APP_URL()}/projects/${encodeURIComponent(event.projectId)}/calendar/${encodeURIComponent(event.eventId)}`
    : `${APP_URL()}/calendar/${encodeURIComponent(event.eventId)}`;
  const description = event.description
    ? `<p style="margin:14px 0;font-size:14px;color:${TEXT};line-height:1.6">${escapeHtml(event.description)}</p>`
    : '';
  const location = event.location
    ? `<p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Lugar:</strong> ${escapeHtml(event.location)}</p>`
    : '';
  const organizer = event.organizer
    ? `<p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Organiza:</strong> ${escapeHtml(event.organizer.name)} &lt;${escapeHtml(event.organizer.email)}&gt;</p>`
    : '';
  const body = `
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:900;color:${PETROLEUM}">📅 Invitación a evento</h2>
    <h3 style="margin:8px 0 16px;font-size:18px;font-weight:800;color:${TEAL}">${escapeHtml(event.title)}</h3>
    <p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Inicio:</strong> ${escapeHtml(startFmt)}</p>
    ${location}
    ${organizer}
    ${description}
    ${button(detailsLink, 'Ver detalle del evento')}
    <p style="margin:24px 0 0;font-size:12px;color:${MUTED}">Adjunto incluye archivo <code style="background:#f4f4f5;padding:1px 6px;border-radius:3px;font-size:11px">invite.ics</code> para tu calendario.</p>
  `;
  return shell(body, TEAL, { auditId: event.eventId, reason: 'Calendar invite' });
}

/** Generate a minimal RFC-5545 .ics body for the event. Returned as a
 *  string so the email service can attach it as `invite.ics`. */
export function calendarInviteIcs(event: CalendarEventPayload): string {
  const dt = (iso: string): string =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Praeventio Guard//ES',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${event.eventId}@praeventio.app`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(event.startIso)}`,
    `DTEND:${dt(event.endIso)}`,
    `SUMMARY:${escape(event.title)}`,
    event.description ? `DESCRIPTION:${escape(event.description)}` : '',
    event.location ? `LOCATION:${escape(event.location)}` : '',
    event.organizer ? `ORGANIZER;CN=${escape(event.organizer.name)}:mailto:${event.organizer.email}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

// ---------------------------------------------------------------------------
// 4. Project invitation template
// ---------------------------------------------------------------------------

export interface ProjectInvitationPayload {
  projectName: string;
  inviterName: string;
  invitedRole: string;
  token: string;
  invitationId?: string;
}

const ROLE_LABELS: Record<string, string> = {
  gerente: 'Gerente de Prevención',
  prevencionista: 'Prevencionista de Riesgos',
  supervisor: 'Supervisor',
  director_obra: 'Director de Obra',
  medico_ocupacional: 'Médico Ocupacional',
  operario: 'Operario',
  contratista: 'Contratista',
};

export function projectInvitationTemplate(invite: ProjectInvitationPayload): string {
  const acceptUrl = `${APP_URL()}/invite?token=${encodeURIComponent(invite.token)}`;
  const roleLabel = ROLE_LABELS[invite.invitedRole] || invite.invitedRole;
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:${PETROLEUM}">Fuiste invitado a un proyecto</h2>
    <p style="margin:0 0 24px;font-size:14px;color:${MUTED}">
      <strong style="color:${TEXT}">${escapeHtml(invite.inviterName)}</strong>
      te invitó a unirte a
      <strong style="color:${TEXT}">"${escapeHtml(invite.projectName)}"</strong>
      como <strong style="color:${TEAL}">${escapeHtml(roleLabel)}</strong>.
    </p>
    ${button(acceptUrl, 'Aceptar invitación')}
    <p style="margin:24px 0 0;font-size:12px;color:${MUTED};text-align:center">Si no esperabas esta invitación, puedes ignorar este email.</p>
    <p style="margin:8px 0 0;font-size:11px;color:#d4d4d8;text-align:center;word-break:break-all">${escapeHtml(acceptUrl)}</p>
  `;
  return shell(body, TEAL, { auditId: invite.invitationId, reason: 'Project invitation' });
}

// ---------------------------------------------------------------------------
// 5. Incident alert template
// ---------------------------------------------------------------------------

export interface IncidentAlertPayload {
  incidentId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description?: string;
  projectId: string;
  projectName: string;
  reporterName?: string;
  occurredAt: string;
  location?: string;
}

const SEVERITY_LABEL: Record<IncidentAlertPayload['severity'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

const SEVERITY_COLOR: Record<IncidentAlertPayload['severity'], string> = {
  low: TEAL,
  medium: GOLD,
  high: '#ea580c',
  critical: CORAL,
};

export function incidentAlertTemplate(incident: IncidentAlertPayload): string {
  const accent = SEVERITY_COLOR[incident.severity];
  const detailLink = `${APP_URL()}/projects/${encodeURIComponent(incident.projectId)}/incidents/${encodeURIComponent(incident.incidentId)}`;
  const description = incident.description
    ? `<p style="margin:14px 0;font-size:14px;color:${TEXT};line-height:1.6">${escapeHtml(incident.description)}</p>`
    : '';
  const reporter = incident.reporterName
    ? `<p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Reportado por:</strong> ${escapeHtml(incident.reporterName)}</p>`
    : '';
  const location = incident.location
    ? `<p style="margin:8px 0;font-size:14px;color:${TEXT}"><strong>Lugar:</strong> ${escapeHtml(incident.location)}</p>`
    : '';
  const body = `
    <div style="background:${accent};color:#ffffff;padding:8px 14px;border-radius:6px;display:inline-block;margin-bottom:18px;font-size:11px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase">
      ⚠ Incidente ${escapeHtml(SEVERITY_LABEL[incident.severity])}
    </div>
    <h2 style="margin:0 0 6px;font-size:20px;font-weight:900;color:${PETROLEUM}">${escapeHtml(incident.title)}</h2>
    <p style="margin:0 0 18px;font-size:13px;color:${MUTED}">${escapeHtml(incident.projectName)} · ${escapeHtml(incident.occurredAt)}</p>
    ${reporter}
    ${location}
    ${description}
    ${button(detailLink, 'Ver incidente', accent)}
    <p style="margin:24px 0 0;font-size:12px;color:${MUTED}">Por trazabilidad SUSESO, este email queda registrado en audit_logs con el ID del incidente.</p>
  `;
  return shell(body, accent, { auditId: incident.incidentId, reason: `Incident severity ${incident.severity}` });
}
