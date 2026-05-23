// Praeventio Guard — Sprint K §23-24 page: Control de Visitas + Inducción Express QR.
//
// UX overview
//   1. Top header shows the active project, an "online" chip, and the
//      "Nueva visita" CTA.
//   2. The list of *active* visits (those without a checkOutAt) is shown
//      as cards with hostUid, RUT, induction status, and a check-out button.
//   3. The "Nueva visita" CTA opens a modal with a four-field form. Either:
//        a. the host scans the visitor's RUT QR (we accept any QR code and
//           treat the decoded text as the RUT); or
//        b. the host types the RUT manually.
//      After registration, the modal shows the express induction screen:
//      a summary of the current induction version (lazy-loaded from
//      `inductions/{id}`), a checkbox acknowledgement, and a manual-signature
//      text input. Acknowledgement pins the induction version id on the
//      visitor doc via `POST /api/visitors/:id/acknowledge-induction`.
//   4. The active-visits list refreshes via Firestore onSnapshot through
//      `useFirestoreCollection`.
//
// Determinístico. Sin LLM. Los recordatorios y los textos son traducibles
// via i18n (`visitors.*`).

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  PlusCircle,
  CheckCircle2,
  X,
  LogOut,
  ScanLine,
  AlertCircle,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { QRScannerModal } from '../components/QRScannerModal';
import { auth } from '../services/firebase';
import { logger } from '../utils/logger';
import type { Visitor } from '../services/visitorControl/visitorRegistry';
import { apiAuthHeader } from '../lib/apiAuth';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

interface InductionDoc {
  id: string;
  title: string;
  summary?: string;
  version?: string;
  publishedAt?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function fmtRut(rut: string): string {
  return rut.trim().toUpperCase();
}

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: { error?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    throw new Error(parsed.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ────────────────────────────────────────────────────────────────────────
// Visitor card
// ────────────────────────────────────────────────────────────────────────

interface VisitorCardProps {
  visitor: Visitor;
  onCheckOut: (visitorId: string) => void;
  onInduct: (visitor: Visitor) => void;
  busyId: string | null;
}

function VisitorCard({ visitor, onCheckOut, onInduct, busyId }: VisitorCardProps) {
  const { t } = useTranslation();
  const inducted = Boolean(visitor.inductedAt);
  const busy = busyId === visitor.id;
  return (
    <article
      className="rounded-2xl border border-default-token bg-surface p-4 space-y-2"
      data-testid="visitor-card"
    >
      <div className="flex items-start gap-2 justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-black uppercase tracking-tight text-primary-token">
            {visitor.fullName}
          </h3>
          <p className="text-[11px] text-secondary-token">
            {visitor.company} · {fmtRut(visitor.rut)}
          </p>
        </div>
        {inducted ? (
          <span
            className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-teal-500/10 text-teal-600 dark:text-teal-300 border border-teal-500/20"
            data-testid="visitor-induct-ok"
          >
            <CheckCircle2 className="inline w-3 h-3 mr-1" aria-hidden="true" />
            {t('visitors.card.inducted', 'Inducido')}
          </span>
        ) : (
          <span
            className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 dark:text-amber-300 border border-amber-500/20"
            data-testid="visitor-induct-pending"
          >
            <AlertCircle className="inline w-3 h-3 mr-1" aria-hidden="true" />
            {t('visitors.card.pending', 'Inducción pendiente')}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[11px] text-secondary-token">
        <div>
          <dt className="uppercase tracking-widest text-[9px] opacity-70">
            {t('visitors.card.host', 'Acompañante')}
          </dt>
          <dd className="font-mono">{visitor.hostUid}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-widest text-[9px] opacity-70">
            {t('visitors.card.checkIn', 'Ingreso')}
          </dt>
          <dd>{fmtDateTime(visitor.checkInAt)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase tracking-widest text-[9px] opacity-70">
            {t('visitors.card.reason', 'Motivo')}
          </dt>
          <dd>{visitor.reason}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-end gap-2 pt-1">
        {!inducted && (
          <button
            type="button"
            onClick={() => onInduct(visitor)}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-teal-500/40 text-teal-600 dark:text-teal-300 hover:bg-teal-500/10 disabled:opacity-50"
            data-testid="visitor-induct-btn"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            {t('visitors.card.induct', 'Inducción')}
          </button>
        )}
        <button
          type="button"
          onClick={() => onCheckOut(visitor.id)}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 text-primary-token hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
          data-testid="visitor-checkout-btn"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          {t('visitors.card.checkOut', 'Salida')}
        </button>
      </div>
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────
// New visitor form (check-in)
// ────────────────────────────────────────────────────────────────────────

interface NewVisitorFormProps {
  projectId: string;
  onClose: () => void;
  onRegistered: (visitor: Visitor) => void;
}

function NewVisitorForm({ projectId, onClose, onRegistered }: NewVisitorFormProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [rut, setRut] = useState('');
  const [company, setCompany] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const valid =
    fullName.trim().length >= 3 &&
    rut.trim().length >= 3 &&
    company.trim().length > 0 &&
    reason.trim().length > 0;

  const handleScan = (decoded: string) => {
    // We accept any QR — the decoded text is treated as the RUT.
    setRut(decoded.trim());
    setScannerOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        setError(t('visitors.errors.noSession', 'Debes iniciar sesión.'));
        setSubmitting(false);
        return;
      }
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      const result = await fetchJson<{ ok: true; visitor: Visitor }>(
        '/api/visitors/check-in',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { 'Authorization': authHeader } : {}),
            'Idempotency-Key': newIdempotencyKey('vis-checkin'),
          },
          body: JSON.stringify({
            projectId,
            fullName: fullName.trim(),
            rut: rut.trim(),
            company: company.trim(),
            reason: reason.trim(),
          }),
        },
      );
      onRegistered(result.visitor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error('visitor_check_in_failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-default-token bg-surface p-4 sm:p-5 space-y-3"
      data-testid="visitor-form"
    >
      <div className="flex items-center gap-2 justify-between">
        <h3 className="text-sm font-black uppercase tracking-tight text-primary-token">
          {t('visitors.form.title', 'Nueva visita')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-secondary-token hover:text-primary-token"
          aria-label={t('common.close', 'Cerrar')}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          {t('visitors.form.fullName', 'Nombre completo')}
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ana Visitante"
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="visitor-input-fullName"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          {t('visitors.form.rut', 'RUT')}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            placeholder="12.345.678-9"
            className="flex-1 px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            data-testid="visitor-input-rut"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="px-3 py-2 rounded-xl border border-teal-500/40 text-teal-600 dark:text-teal-300 hover:bg-teal-500/10"
            aria-label={t('visitors.form.scan', 'Escanear QR')}
            data-testid="visitor-scan-btn"
          >
            <ScanLine className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          {t('visitors.form.company', 'Empresa / Organización')}
        </label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Auditora SpA"
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="visitor-input-company"
        />
      </div>
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
          {t('visitors.form.reason', 'Motivo de la visita')}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t('visitors.form.reasonPlaceholder', 'Auditoría ISO 45001…') as string}
          className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          data-testid="visitor-input-reason"
        />
      </div>
      {error && (
        <div
          className="text-xs text-rose-600 dark:text-rose-400"
          data-testid="visitor-form-error"
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-secondary-token hover:text-primary-token"
          data-testid="visitor-form-cancel"
        >
          {t('common.cancel', 'Cancelar')}
        </button>
        <button
          type="submit"
          disabled={!valid || submitting}
          className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-teal-500 text-white disabled:bg-zinc-400"
          data-testid="visitor-form-submit"
        >
          {submitting
            ? t('common.saving', 'Guardando…')
            : t('visitors.form.submit', 'Registrar ingreso')}
        </button>
      </div>
      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
      />
    </form>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Induction acknowledgment modal
// ────────────────────────────────────────────────────────────────────────

interface InductionAckProps {
  projectId: string;
  visitor: Visitor;
  inductions: InductionDoc[];
  onClose: () => void;
  onAcknowledged: (
    visitorId: string,
    inductionVersionId: string,
    inductedAt: string,
  ) => void;
}

function InductionAck({
  projectId,
  visitor,
  inductions,
  onClose,
  onAcknowledged,
}: InductionAckProps) {
  const { t } = useTranslation();
  const [selectedInductionId, setSelectedInductionId] = useState<string>(
    inductions[0]?.id ?? '',
  );
  const [ack, setAck] = useState(false);
  const [signatureText, setSignatureText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedInduction = useMemo(
    () => inductions.find((i) => i.id === selectedInductionId) ?? null,
    [inductions, selectedInductionId],
  );

  const valid = !!selectedInductionId && ack && signatureText.trim().length >= 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        setError(t('visitors.errors.noSession', 'Debes iniciar sesión.'));
        setSubmitting(false);
        return;
      }
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      const result = await fetchJson<{
        ok: true;
        inductionVersionId: string;
        inductedAt: string;
      }>(`/api/visitors/${encodeURIComponent(visitor.id)}/acknowledge-induction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
          'Idempotency-Key': newIdempotencyKey('vis-ack'),
        },
        body: JSON.stringify({
          projectId,
          inductionVersionId: selectedInductionId,
        }),
      });
      logger.info('visitor.induction.ack', {
        projectId,
        visitorId: visitor.id,
        inductionVersionId: result.inductionVersionId,
        signatureLength: signatureText.trim().length,
      });
      onAcknowledged(visitor.id, result.inductionVersionId, result.inductedAt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error('visitor_ack_failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={t('visitors.ack.title', 'Inducción express') as string}
      data-testid="visitor-ack-modal"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-surface p-5 space-y-3 border border-default-token"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-tight text-primary-token">
            {t('visitors.ack.title', 'Inducción express')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-secondary-token">
          {t('visitors.ack.subtitle', 'Acepta los términos antes de ingresar a faena.')}
        </p>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
            {t('visitors.ack.version', 'Versión de inducción')}
          </label>
          {inductions.length === 0 ? (
            <p
              className="text-[11px] text-amber-600 dark:text-amber-400"
              data-testid="visitor-ack-empty"
            >
              {t(
                'visitors.ack.empty',
                'Aún no hay versiones de inducción publicadas para este proyecto.',
              )}
            </p>
          ) : (
            <select
              value={selectedInductionId}
              onChange={(e) => setSelectedInductionId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token"
              data-testid="visitor-ack-version"
            >
              {inductions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} {i.version ? `· v${i.version}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedInduction?.summary && (
          <div
            className="rounded-xl border border-default-token bg-zinc-50 dark:bg-zinc-900/40 p-3 text-xs text-primary-token whitespace-pre-wrap"
            data-testid="visitor-ack-summary"
          >
            {selectedInduction.summary}
          </div>
        )}
        <label className="flex items-start gap-2 text-xs text-primary-token">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5"
            data-testid="visitor-ack-checkbox"
          />
          <span>
            {t(
              'visitors.ack.agreement',
              'He leído y acepto las reglas de seguridad de la faena.',
            )}
          </span>
        </label>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-secondary-token mb-1">
            {t('visitors.ack.signature', 'Firma manual (escribe tu nombre)')}
          </label>
          <input
            type="text"
            value={signatureText}
            onChange={(e) => setSignatureText(e.target.value)}
            placeholder={visitor.fullName}
            className="w-full px-3 py-2 rounded-xl border border-default-token bg-surface text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            data-testid="visitor-ack-signature"
          />
        </div>
        {error && (
          <div
            className="text-xs text-rose-600 dark:text-rose-400"
            role="alert"
            data-testid="visitor-ack-error"
          >
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-secondary-token hover:text-primary-token"
            data-testid="visitor-ack-cancel"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="submit"
            disabled={!valid || submitting}
            className="px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-teal-500 text-white disabled:bg-zinc-400"
            data-testid="visitor-ack-submit"
          >
            {submitting
              ? t('common.saving', 'Guardando…')
              : t('visitors.ack.submit', 'Confirmar inducción')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export function Visitors() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;
  const [formOpen, setFormOpen] = useState(false);
  const [ackVisitor, setAckVisitor] = useState<Visitor | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localVisitors, setLocalVisitors] = useState<Visitor[]>([]);

  // Pull inductions to power the express-induction modal. We fall back
  // to an empty list if the collection has not been seeded. Tenant scoping
  // happens server-side; the active-visit list is sourced via the
  // /api/visitors GET handler (initial load below) and locally updated
  // through the local-state path that the action handlers maintain.
  const { data: inductions } = useFirestoreCollection<InductionDoc>(
    projectId ? `projects/${projectId}/inductions` : null,
  );

  // Load the active list from the server once on mount + on project change.
  // The Firestore listener above is only useful on tenant-rewritten paths;
  // we treat /api/visitors as the source of truth for the active list.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        // §2.20 (2026-05-23) — apiAuthHeader unified.
        const authHeader = await apiAuthHeader();
        const result = await fetchJson<{ ok: true; visitors: Visitor[] }>(
          `/api/visitors?projectId=${encodeURIComponent(projectId)}`,
          { headers: { ...(authHeader ? { 'Authorization': authHeader } : {}) } },
        );
        if (!cancelled) setLocalVisitors(result.visitors);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('visitors_list_failed', { message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleRegistered = (visitor: Visitor) => {
    setLocalVisitors((prev) => [visitor, ...prev]);
    setFormOpen(false);
    // Open the induction modal immediately for fast flow.
    setAckVisitor(visitor);
  };

  const handleCheckOut = async (visitorId: string) => {
    if (!projectId) return;
    setBusyId(visitorId);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) return;
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      await fetchJson<{ ok: true; checkOutAt: string }>(
        `/api/visitors/${encodeURIComponent(visitorId)}/check-out`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { 'Authorization': authHeader } : {}),
            'Idempotency-Key': newIdempotencyKey('vis-out'),
          },
          body: JSON.stringify({ projectId }),
        },
      );
      setLocalVisitors((prev) => prev.filter((v) => v.id !== visitorId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error('visitor_check_out_failed', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleAcknowledged = (
    visitorId: string,
    inductionVersionId: string,
    inductedAt: string,
  ) => {
    setLocalVisitors((prev) =>
      prev.map((v) =>
        v.id === visitorId
          ? { ...v, inductionVersionId, inductedAt }
          : v,
      ),
    );
    setAckVisitor(null);
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="visitors-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Users className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('visitors.page.title', 'Control de Visitas')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'visitors.page.selectProject',
              'Selecciona un proyecto para registrar visitas.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="visitors-page"
    >
      <header className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <Users className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('visitors.page.title', 'Control de Visitas')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'visitors.page.subtitle',
              '§23-24 Sprint K — Visitas activas: {{count}}',
              { count: localVisitors.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="visitors-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-teal-500 text-white hover:bg-teal-600 transition-colors"
          data-testid="visitors-new-button"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          {formOpen
            ? t('common.close', 'Cerrar')
            : t('visitors.page.newVisit', 'Nueva visita')}
        </button>
      </header>

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          role="alert"
          data-testid="visitors-error"
        >
          {error}
        </div>
      )}

      {formOpen && projectId && (
        <NewVisitorForm
          projectId={projectId}
          onClose={() => setFormOpen(false)}
          onRegistered={handleRegistered}
        />
      )}

      {localVisitors.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="visitors-empty"
        >
          <Users className="w-10 h-10 mx-auto mb-3 text-teal-500/70" aria-hidden="true" />
          <p className="text-sm text-primary-token font-medium">
            {t('visitors.page.emptyTitle', 'Aún no hay visitas activas.')}
          </p>
          <p className="mt-2 text-xs text-secondary-token max-w-md mx-auto">
            {t(
              'visitors.page.emptyHint',
              'Registra una nueva visita para iniciar el control de acceso.',
            )}
          </p>
        </div>
      )}

      {localVisitors.length > 0 && (
        <div
          className="grid gap-3 sm:grid-cols-2"
          data-testid="visitors-list"
        >
          {localVisitors.map((v) => (
            <VisitorCard
              key={v.id}
              visitor={v}
              onCheckOut={handleCheckOut}
              onInduct={(visitor) => setAckVisitor(visitor)}
              busyId={busyId}
            />
          ))}
        </div>
      )}

      {ackVisitor && projectId && (
        <InductionAck
          projectId={projectId}
          visitor={ackVisitor}
          inductions={inductions}
          onClose={() => setAckVisitor(null)}
          onAcknowledged={handleAcknowledged}
        />
      )}
    </div>
  );
}

export default Visitors;
