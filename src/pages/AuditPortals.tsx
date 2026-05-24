// Praeventio Guard — Sprint K wire UI (2026-05-23) — Portales de auditor.
//
// Page `/audit-portals`. Service `externalAuditPortal.ts` (createPortal +
// derivePortalStatus + revokePortal + checkAccess + generateAccessToken)
// + card `ExternalAuditPortalCard.tsx` existían sin page.
//
// UX:
//   - El admin crea portales de acceso para auditores externos (SUSESO,
//     mutualidad, ISO certifier, mandante, etc.) con scope limitado a
//     proyectos + módulos + TTL en días.
//   - Cada portal genera un access token de 64 chars hex que el auditor
//     usa para entrar al portal público (URL fuera de scope acá).
//   - Botón "Revocar" cierra el portal antes de su TTL con motivo.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Plus,
  Loader2,
  AlertTriangle,
  Ban,
  Copy,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { ExternalAuditPortalCard } from '../components/auditPortal/ExternalAuditPortalCard';
import {
  createPortal,
  derivePortalStatus,
  revokePortal,
  type AuditPortalConfig,
  type AuditModule,
  type AuditorAffiliation,
} from '../services/auditPortal/externalAuditPortal';
import {
  savePortal,
  patchPortal,
  subscribePortals,
} from '../services/auditPortal/auditPortalStore';
import { logger } from '../utils/logger';

// Plan 2026-05-24 §Fase B.6 batch4 — i18n sweep AuditPortals.
export function AuditPortals() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const AFFILIATION_LABELS: Record<AuditorAffiliation, string> = {
    mandante: t('audit_portals.affiliation.mandante', 'Mandante'),
    suseso: t('audit_portals.affiliation.suseso', 'SUSESO'),
    mutualidad: t('audit_portals.affiliation.mutualidad', 'Mutualidad (ACHS/IST/Mutual/ISL)'),
    iso: t('audit_portals.affiliation.iso', 'Certificadora ISO'),
    seremi: t('audit_portals.affiliation.seremi', 'SEREMI Salud'),
    dt: t('audit_portals.affiliation.dt', 'Dirección del Trabajo'),
    cliente: t('audit_portals.affiliation.cliente', 'Cliente comercial'),
    other: t('audit_portals.affiliation.other', 'Otra'),
  };

  const MODULE_LABELS: Record<AuditModule, string> = {
    documents: t('audit_portals.module.documents', 'Documentos'),
    iper_matrix: t('audit_portals.module.iper_matrix', 'Matriz IPER'),
    trainings: t('audit_portals.module.trainings', 'Capacitaciones'),
    epp: t('audit_portals.module.epp', 'EPP'),
    incidents: t('audit_portals.module.incidents', 'Incidentes'),
    corrective_actions: t('audit_portals.module.corrective_actions', 'Acciones correctivas'),
    evidences: t('audit_portals.module.evidences', 'Evidencias'),
    compliance_snapshot: t('audit_portals.module.compliance_snapshot', 'Snapshot cumplimiento'),
  };

  const [portals, setPortals] = useState<AuditPortalConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form state.
  const [showForm, setShowForm] = useState(false);
  const [auditorName, setAuditorName] = useState('');
  const [auditorAffiliation, setAuditorAffiliation] = useState<AuditorAffiliation>('mandante');
  const [auditorEmail, setAuditorEmail] = useState('');
  const [ttlDays, setTtlDays] = useState(7);
  const [selectedModules, setSelectedModules] = useState<Set<AuditModule>>(
    new Set(['documents', 'iper_matrix', 'compliance_snapshot']),
  );
  const [internalNotes, setInternalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setPortals([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribePortals(
      projectId,
      (list) => {
        setPortals(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('audit_portals_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const toggleModule = (m: AuditModule) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const resetForm = () => {
    setShowForm(false);
    setAuditorName('');
    setAuditorAffiliation('mandante');
    setAuditorEmail('');
    setTtlDays(7);
    setSelectedModules(new Set(['documents', 'iper_matrix', 'compliance_snapshot']));
    setInternalNotes('');
    setFeedback(null);
  };

  const handleCreate = useCallback(async () => {
    if (!user || !selectedProject) {
      setFeedback(t('audit_portals.feedback.need_project', 'Necesitás un proyecto y autenticación válida.'));
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const portal = createPortal({
        id: `portal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdByUid: user.uid,
        auditorName: auditorName.trim(),
        auditorAffiliation,
        auditorEmail: auditorEmail.trim() || undefined,
        scopeProjectIds: [selectedProject.id],
        scopeModules: Array.from(selectedModules),
        ttlDays,
        internalNotes: internalNotes.trim() || undefined,
      });
      await savePortal(selectedProject.id, portal);
      setFeedback(
        t('audit_portals.feedback.created', {
          defaultValue: 'Portal creado. Token: {{token}}…',
          token: portal.accessToken.slice(0, 12),
        }),
      );
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('createPortal failed', { err: msg });
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  }, [user, selectedProject, auditorName, auditorAffiliation, auditorEmail, ttlDays, selectedModules, internalNotes]);

  const handleRevoke = useCallback(
    async (portal: AuditPortalConfig) => {
      if (!user || !selectedProject) return;
      const reason = window.prompt(
        t('audit_portals.revoke.prompt', 'Motivo de la revocación (mín 5 chars):'),
        '',
      );
      if (!reason || reason.trim().length < 5) {
        setFeedback(t('audit_portals.feedback.revoke_cancelled', 'Revocación cancelada o motivo demasiado corto.'));
        return;
      }
      try {
        const revoked = revokePortal(portal, user.uid, reason.trim());
        await patchPortal(selectedProject.id, portal.id, {
          revokedAt: revoked.revokedAt,
          revokedByUid: revoked.revokedByUid,
          revokedReason: revoked.revokedReason,
        });
        setFeedback(
          t('audit_portals.feedback.revoked', {
            defaultValue: 'Portal {{id}} revocado.',
            id: portal.id.slice(0, 12),
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject],
  );

  const handleCopyToken = useCallback(async (portal: AuditPortalConfig) => {
    try {
      await navigator.clipboard.writeText(portal.accessToken);
      setFeedback(t('audit_portals.feedback.token_copied', 'Token copiado al portapapeles.'));
    } catch {
      setFeedback(t('audit_portals.feedback.copy_failed', 'No se pudo copiar — copialo manualmente.'));
    }
  }, []);

  const activePortals = useMemo(
    () => portals.filter((p) => derivePortalStatus(p) === 'active'),
    [portals],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-emerald-500" /> {t('audit_portals.title', 'Portales de auditor')}
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              {t(
                'audit_portals.subtitle',
                'Acceso temporal con scope limitado para auditores externos (SUSESO, mutualidad, ISO certifier, mandante, SEREMI, DT). Token de 64 chars hex; TTL 1-90 días; módulos seleccionables. Revocable manualmente antes del vencimiento.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('audit_portals.cta_create', 'Crear portal')}
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            {t('audit_portals.empty.select_project', 'Seleccioná un proyecto.')}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {showForm && (
              <section className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/15 p-4 space-y-3">
                <h2 className="text-sm font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-widest">
                  {t('audit_portals.form.heading', 'Nuevo portal')}
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">
                      {t('audit_portals.form.field_name', 'Nombre auditor (mín 3 chars)')}
                    </span>
                    <input
                      type="text"
                      value={auditorName}
                      onChange={(e) => setAuditorName(e.target.value)}
                      placeholder={t('audit_portals.form.name_placeholder', 'Ej: Juan Pérez Bureau Veritas')}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('audit_portals.form.field_affiliation', 'Afiliación')}</span>
                    <select
                      value={auditorAffiliation}
                      onChange={(e) => setAuditorAffiliation(e.target.value as AuditorAffiliation)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      {Object.entries(AFFILIATION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('audit_portals.form.field_email', 'Email (opcional)')}</span>
                  <input
                    type="email"
                    value={auditorEmail}
                    onChange={(e) => setAuditorEmail(e.target.value)}
                    placeholder={t('audit_portals.form.email_placeholder', 'auditor@institucion.cl')}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('audit_portals.form.field_ttl', 'TTL en días (1-90)')}</span>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={ttlDays}
                    onChange={(e) => setTtlDays(parseInt(e.target.value, 10) || 7)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    {t('audit_portals.form.field_modules', 'Módulos accesibles (mín 1)')}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(MODULE_LABELS) as Array<[AuditModule, string]>).map(([m, v]) => (
                      <label key={m} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={selectedModules.has(m)}
                          onChange={() => toggleModule(m)}
                          className="rounded"
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    {t('audit_portals.form.field_notes', 'Notas internas (opcional, no visibles al auditor)')}
                  </span>
                  <textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    {t('common.cancel', 'Cancelar')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={submitting || auditorName.trim().length < 3 || selectedModules.size === 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {t('audit_portals.form.submit', 'Crear portal')}
                  </button>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">
                {t('audit_portals.list.heading', {
                  defaultValue: 'Portales activos ({{active}}) · Total ({{total}})',
                  active: activePortals.length,
                  total: portals.length,
                })}
              </h2>
              {portals.length === 0 ? (
                <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                  {t('audit_portals.list.empty', 'Sin portales creados.')}
                </div>
              ) : (
                <ul className="space-y-3">
                  {portals.map((p) => {
                    const status = derivePortalStatus(p);
                    return (
                      <li key={p.id} className="space-y-2">
                        <ExternalAuditPortalCard portal={p} status={status} />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyToken(p)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 flex items-center gap-1.5"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            {t('audit_portals.action.copy_token', 'Copiar token')}
                          </button>
                          {status === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleRevoke(p)}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              {t('audit_portals.action.revoke', 'Revocar')}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default AuditPortals;
