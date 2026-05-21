// Praeventio Guard — Sprint 22 (Bucket Y).
//
// Resend email service: a thin wrapper around the Resend SDK that
// centralizes "from" addressing, batching, and graceful no-op behavior
// when `RESEND_API_KEY` is not set (so dev/staging environments without
// the secret degrade cleanly instead of crashing on first send).
//
// Why a service (vs inline `new Resend(...)` per call site)? Round 18+
// scattered `new Resend(process.env.RESEND_API_KEY)` across server.ts,
// routes/projects.ts and curriculum endpoints. Sprint 22's email
// expansion (SOS backup, weekly digest, calendar invites, incident
// alerts) would multiply that drift. Centralizing here:
//
//   • One `fromEnv()` boot path so ops know exactly when email is live.
//   • One `from` default so noreply identity is consistent.
//   • One error envelope so callers don't each re-implement try/catch.
//   • One batch surface so digest jobs don't fan out N raw API calls.
//
// The service NEVER throws on send failure — it returns a discriminated
// `{ ok: false, error }` so the caller can decide whether to fall back
// to FCM, log to audit, or surface to the user. Email is best-effort by
// design (a worker's life shouldn't depend on Resend's uptime).

import { Resend } from 'resend';

/** Default From header — uses the verified Praeventio domain.
 *  Override via `EmailService` constructor if a tenant needs a custom
 *  sender (e.g. `proyectos@<tenant>.praeventio.app`). */
export const FROM_DEFAULT = 'Praeventio <noreply@praeventio.app>';

export interface EmailAttachment {
  filename: string;
  /** Buffer for binary (PDFs, .ics) or string for inline text. */
  content: Buffer | string;
  contentType?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  /** HTML body. Templates in `./templates.ts` produce this. */
  html: string;
  /** Plain text fallback. Generated automatically from HTML if absent. */
  text?: string;
  /** Override the configured From header for this single send. */
  from?: string;
  /** Reply-To header (e.g. supervisor email for SOS backup). */
  replyTo?: string;
  attachments?: EmailAttachment[];
  /** Tag for Resend dashboard segmentation (e.g. `sos-backup`,
   *  `weekly-digest`, `invitation`, `incident-alert`). Truncated by
   *  Resend if longer than its limit, but we cap to 256 chars defensively. */
  tag?: string;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface BatchResult {
  sent: number;
  failed: number;
  /** Per-message outcomes in input order — useful for audit logs. */
  results: SendResult[];
}

/** Strip HTML tags for a plain-text fallback. Not a sanitizer — Resend's
 *  text body is purely for clients that don't render HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export class EmailService {
  constructor(
    private readonly resend: Resend,
    public readonly fromAddress: string = FROM_DEFAULT,
  ) {}

  /** Construct an `EmailService` from `process.env.RESEND_API_KEY`. Returns
   *  `null` when the env var is absent so callers can short-circuit
   *  silently in environments without an email provider configured. */
  static fromEnv(envOverride?: NodeJS.ProcessEnv): EmailService | null {
    const env = envOverride ?? process.env;
    const key = env.RESEND_API_KEY;
    if (!key || key.trim() === '') return null;
    const from = env.RESEND_FROM_ADDRESS?.trim() || FROM_DEFAULT;
    return new EmailService(new Resend(key), from);
  }

  /** Build the payload Resend's SDK expects. Extracted so tests can
   *  assert the exact shape passed to `resend.emails.send`. */
  buildPayload(msg: EmailMessage): Record<string, unknown> {
    const text = msg.text ?? htmlToText(msg.html);
    const payload: Record<string, unknown> = {
      from: msg.from ?? this.fromAddress,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text,
    };
    if (msg.replyTo) payload.replyTo = msg.replyTo;
    if (msg.tag) payload.tags = [{ name: 'flow', value: msg.tag.slice(0, 256) }];
    if (msg.attachments && msg.attachments.length > 0) {
      payload.attachments = msg.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentType ? { contentType: a.contentType } : {}),
      }));
    }
    return payload;
  }

  /** Send a single message. Returns a discriminated result — never throws. */
  async send(msg: EmailMessage): Promise<SendResult> {
    try {
      const payload = this.buildPayload(msg);
      // resend.emails.send returns `{ data: { id }, error }` in v6.
      const response: any = await (this.resend as any).emails.send(payload);
      if (response?.error) {
        const errMsg =
          typeof response.error === 'string'
            ? response.error
            : response.error?.message ?? 'unknown_resend_error';
        return { ok: false, error: errMsg };
      }
      const id: string | undefined = response?.data?.id ?? response?.id;
      if (!id) {
        return { ok: false, error: 'missing_message_id' };
      }
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Send N messages sequentially. We do NOT use Resend's `/emails/batch`
   *  endpoint here because callers want per-recipient personalization
   *  (subject lines with worker names, attachment .ics per supervisor)
   *  and the batch endpoint shares a single payload across recipients.
   *  For >50 messages consider chunking + delay to stay under rate
   *  limits — current call sites stay well below. */
  async sendBatch(messages: EmailMessage[]): Promise<BatchResult> {
    const results: SendResult[] = [];
    let sent = 0;
    let failed = 0;
    for (const msg of messages) {
      const r = await this.send(msg);
      results.push(r);
      if (r.ok) sent += 1;
      else failed += 1;
    }
    return { sent, failed, results };
  }
}
