// Praeventio Guard — Sprint 22 (Bucket Y) email service barrel.
// Single import surface so call sites stay tidy:
//   import { EmailService, sosBackupTemplate } from '@/services/email';
export {
  EmailService,
  FROM_DEFAULT,
  type EmailMessage,
  type EmailAttachment,
  type SendResult,
  type BatchResult,
} from './resendService.js';
export {
  sosBackupTemplate,
  weeklyDigestTemplate,
  calendarInviteTemplate,
  calendarInviteIcs,
  projectInvitationTemplate,
  incidentAlertTemplate,
  type SosBackupPayload,
  type WeeklyDigestStats,
  type CalendarEventPayload,
  type ProjectInvitationPayload,
  type IncidentAlertPayload,
} from './templates.js';
