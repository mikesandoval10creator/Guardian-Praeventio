// Praeventio Guard — Sprint 42 Fase F.18 page wrapper.
//
// Historial Profesional Portátil del Trabajador (Ley 19.628).
//
// El trabajador es DUEÑO ABSOLUTO de su cartera profesional. Esta
// página:
//   1. Muestra un banner de privacidad explicando Ley 19.628.
//   2. Selector de trabajador (admin: autocomplete sobre el roster;
//      no-admin: solo ve su propio UID — el endpoint ya rechaza
//      cross-worker con 403).
//   3. Toggles de consent:
//        - Permitir exportación (default off — sin él identidad va
//          como [REDACTED] en el render Y el botón "Exportar" está
//          deshabilitado).
//        - Incluir historial de incidentes (default off — los
//          incidentes ni se leen del backend cuando está apagado).
//   4. Secciones: Identidad / Capacitaciones / EPP / Aptitudes /
//      Roles críticos / Firmas / (Incidentes si consent).
//   5. Botones "Exportar a JSON" y "Exportar a PDF" que llaman al
//      endpoint /export y descargan el blob con checksum SHA-256.
//
// Asistente NO bloqueante (directiva 2 del usuario): la página
// nunca push-a datos a organismos externos. Genera, el trabajador
// (o admin autorizado) descarga y entrega manualmente.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  WifiOff,
  ShieldCheck,
  Download,
  AlertTriangle,
  GraduationCap,
  HardHat,
  Stethoscope,
  Crown,
  PenTool,
  AlertOctagon,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
// 2026-05-17 — migrated from monolithic useSprintK.ts to dedicated hook
// per Sprint K reformulation directive. See docs/SPRINT_K_REFORMULATED.md.
import {
  useWorkerPortableHistory,
  updatePortableConsent,
  exportPortableHistory,
  type PortableHistoryFormat,
} from '../hooks/usePortableHistory';
import type { Worker } from '../types';
import { logger } from '../utils/logger';
import { PortableHistoryPreview } from '../components/workerHistory/PortableHistoryPreview';
import {
  buildPortableHistory,
  serializeAsJson,
  type WorkerData,
} from '../services/workerHistory/portableHistoryExporter';
import { humanErrorMessage } from '../lib/humanError';


interface ConsentDraft {
  allowsPortableExport: boolean;
  includesIncidents: boolean;
}

export function WorkerPortableHistory() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user, isAdmin } = useFirebase();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  // Worker selection:
  //   - admin: free selector with autocomplete over the roster
  //   - non-admin: locked to their own uid (the endpoint enforces this
  //     with 403, but we don't even render a selector to avoid the
  //     misleading "you can pick anyone" affordance).
  const [selectedWorkerUid, setSelectedWorkerUid] = useState<string | null>(
    user?.uid ?? null,
  );
  const [workerQuery, setWorkerQuery] = useState('');

  // Local consent draft — initialized from the bundle once it loads.
  // We keep a local copy so the toggles feel instant even though the
  // mutation is round-tripped to the server.
  const [draft, setDraft] = useState<ConsentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const { data: workers } = useFirestoreCollection<Worker>(
    isAdmin && projectId ? `projects/${projectId}/workers` : null,
  );

  const filteredWorkers = useMemo(() => {
    if (!isAdmin) return [];
    const q = workerQuery.trim().toLowerCase();
    if (!q) return workers.slice(0, 15);
    return workers
      .filter((w) =>
        ((w.name ?? '') + ' ' + (w.email ?? '') + ' ' + (w.role ?? ''))
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 15);
  }, [workers, workerQuery, isAdmin]);

  const effectiveWorkerUid = isAdmin ? selectedWorkerUid : user?.uid ?? null;

  const {
    data: portableResp,
    loading,
    error: hookError,
    refetch,
  } = useWorkerPortableHistory(projectId, effectiveWorkerUid);

  const bundle = portableResp?.bundle ?? null;

  const previewData = useMemo(() => {
    if (!bundle) return null;
    const workerData: WorkerData = {
      identity: {
        fullName: bundle.identity.fullName,
        rut: bundle.identity.rut,
        email: bundle.identity.email ?? undefined,
      },
      employmentSpans: [],
      completedTrainings: bundle.trainings.map((t) => ({
        trainingCode: t.trainingCode ?? '',
        trainingName: t.trainingName ?? t.trainingCode ?? '',
        obtainedAt: t.obtainedAt ?? '',
        expiresAt: null,
        issuer: '',
        hours: 0,
      })),
      certifications: [],
      eppHistory: bundle.eppDeliveries.map((e) => ({
        eppCategory: e.eppCategory ?? '',
        eppModel: e.eppModel ?? e.eppCategory ?? '',
        deliveredAt: e.deliveredAt ?? '',
        nextReplacementAt: null,
      })),
      exposureLog: [],
    };
    const history = buildPortableHistory(workerData, {
      redactionLevel: bundle.consent.allowsPortableExport ? 'employer' : 'public',
      exportedAt: bundle.generatedAt,
      requestedBy: { uid: bundle.workerUid, role: 'self' },
      includeMedical: false,
    });
    const serialized = serializeAsJson(history);
    return { history, serialized };
  }, [bundle]);

  // Hydrate the local consent draft from the bundle the first time it
  // loads (or when the bundle's `updatedAt` flips, indicating an
  // external update — e.g. a different device for the same worker).
  // We avoid a useEffect+state-sync race by initializing inline on
  // first render of the bundle.
  if (bundle && draft === null) {
    setDraft({
      allowsPortableExport: bundle.consent.allowsPortableExport,
      includesIncidents: bundle.consent.includesIncidents,
    });
  }

  const handleSaveConsent = async () => {
    if (!projectId || !effectiveWorkerUid || !draft) return;
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      await updatePortableConsent(projectId, effectiveWorkerUid, {
        allowsPortableExport: draft.allowsPortableExport,
        includesIncidents: draft.includesIncidents,
      });
      setStatusMsg(
        t('portableHistory.consent.saved', 'Consentimiento actualizado.'),
      );
      refetch?.();
      logger.info('portableHistory.consent.saved', {
        projectId,
        workerUid: effectiveWorkerUid,
      });
    } catch (err) {
      logger.error('portableHistory.consent.failed', err);
      setError(humanErrorMessage((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (format: PortableHistoryFormat) => {
    if (!projectId || !effectiveWorkerUid) return;
    setBusy(true);
    setError(null);
    setStatusMsg(null);
    try {
      const { blob, filename, checksum } = await exportPortableHistory(
        projectId,
        effectiveWorkerUid,
        format,
      );
      // Trigger a download via an anchor; cleanup the object URL on next tick.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatusMsg(
        t(
          'portableHistory.export.done',
          'Descarga lista ({{format}}). Checksum: {{checksum}}',
          {
            format: format.toUpperCase(),
            checksum: checksum?.slice(0, 12) ?? '—',
          },
        ),
      );
      logger.info('portableHistory.export.done', {
        format,
        checksum,
        workerUid: effectiveWorkerUid,
      });
    } catch (err) {
      logger.error('portableHistory.export.failed', err);
      setError(humanErrorMessage((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="portable-history-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <User
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('portableHistory.page.title', 'Historial Portátil del Trabajador')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'portableHistory.page.selectProject',
              'Selecciona un proyecto para revisar tu historial profesional portátil.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const renderError = error ?? hookError?.message ?? null;
  const exportEnabled = Boolean(
    bundle?.consent.allowsPortableExport && !busy,
  );

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="portable-history-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
          <User className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('portableHistory.page.title', 'Historial Portátil del Trabajador')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'portableHistory.page.subtitle',
              'Cartera profesional portable — el trabajador es dueño absoluto.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="portable-history-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* Ley 19.628 privacy banner — always present. */}
      <section
        className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 flex gap-3 items-start"
        data-testid="portable-history-privacy-banner"
        role="note"
      >
        <ShieldCheck
          className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="text-sm text-primary-token space-y-1">
          <p className="font-bold">
            {t(
              'portableHistory.privacy.title',
              'Ley 19.628 — Datos personales del trabajador',
            )}
          </p>
          <p className="text-secondary-token">
            {t(
              'portableHistory.privacy.body',
              'Esta sección contiene tu cartera profesional (capacitaciones, EPP, aptitudes, firmas). Tú decides qué se exporta y cuándo. Praeventio NO empuja este documento a SUSESO, SII, MINSAL ni a ningún organismo externo: tú o tu empresa lo entregan manualmente.',
            )}
          </p>
        </div>
      </section>

      {/* Worker selector — admin-only. */}
      {isAdmin && (
        <section
          className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
          data-testid="portable-history-selector"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('portableHistory.form.worker', 'Trabajador (admin)')}
            </span>
            <input
              type="text"
              value={workerQuery}
              onChange={(e) => setWorkerQuery(e.target.value)}
              placeholder={t(
                'portableHistory.form.workerPlaceholder',
                'Buscar por nombre, email o rol…',
              )}
              className="rounded-lg border border-default-token bg-canvas px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              data-testid="portable-history-search"
            />
            <select
              value={selectedWorkerUid ?? ''}
              onChange={(e) => {
                setSelectedWorkerUid(e.target.value || null);
                setDraft(null); // re-hydrate from the new worker's bundle
                setStatusMsg(null);
                setError(null);
              }}
              className="rounded-lg border border-default-token bg-canvas px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              data-testid="portable-history-select"
            >
              <option value="">
                {t(
                  'portableHistory.form.selectWorker',
                  '— Selecciona un trabajador —',
                )}
              </option>
              {filteredWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || w.email || w.id}
                  {w.role ? ` · ${w.role}` : ''}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {!effectiveWorkerUid && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center text-sm text-secondary-token"
          data-testid="portable-history-empty"
        >
          {t(
            'portableHistory.empty',
            'Selecciona un trabajador para revisar su historial portátil.',
          )}
        </div>
      )}

      {effectiveWorkerUid && loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="portable-history-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {effectiveWorkerUid && renderError && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="portable-history-error"
          role="alert"
        >
          {humanErrorMessage(renderError)}
        </div>
      )}

      {effectiveWorkerUid && !loading && !hookError && bundle && draft && (
        <>
          {/* Consent panel */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
            data-testid="portable-history-consent"
          >
            <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
              {t('portableHistory.consent.title', 'Consentimiento (Ley 19.628)')}
            </h2>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.allowsPortableExport}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    allowsPortableExport: e.target.checked,
                  })
                }
                className="w-5 h-5 rounded border-default-token text-blue-500 focus:ring-blue-500/40"
                data-testid="portable-history-consent-export"
              />
              <span className="text-sm text-primary-token">
                {t(
                  'portableHistory.consent.export',
                  'Permitir exportación (libera identidad — nombre + RUT visibles).',
                )}
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.includesIncidents}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    includesIncidents: e.target.checked,
                  })
                }
                className="w-5 h-5 rounded border-default-token text-blue-500 focus:ring-blue-500/40"
                data-testid="portable-history-consent-incidents"
              />
              <span className="text-sm text-primary-token">
                {t(
                  'portableHistory.consent.incidents',
                  'Incluir historial de incidentes en mi cartera portátil.',
                )}
              </span>
            </label>
            <button
              type="button"
              onClick={handleSaveConsent}
              disabled={busy}
              className="rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-4 py-2"
              data-testid="portable-history-consent-save"
            >
              {t('portableHistory.consent.save', 'Guardar consentimiento')}
            </button>
            {statusMsg && (
              <p
                className="text-xs text-emerald-600 dark:text-emerald-400"
                data-testid="portable-history-consent-status"
              >
                {statusMsg}
              </p>
            )}
          </section>

          {/* Identity */}
          <Section
            title={t('portableHistory.section.identity', 'Identidad')}
            icon={<User className="w-4 h-4" aria-hidden="true" />}
            testId="portable-history-section-identity"
          >
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs font-bold text-secondary-token uppercase">
                  {t('portableHistory.identity.name', 'Nombre')}
                </dt>
                <dd
                  className="text-primary-token"
                  data-testid="portable-history-identity-name"
                >
                  {bundle.identity.fullName || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold text-secondary-token uppercase">
                  {t('portableHistory.identity.rut', 'RUT')}
                </dt>
                <dd
                  className="text-primary-token"
                  data-testid="portable-history-identity-rut"
                >
                  {bundle.identity.rut || '—'}
                </dd>
              </div>
            </dl>
            {!bundle.consent.allowsPortableExport && (
              <p
                className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"
                data-testid="portable-history-identity-redacted-note"
              >
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {t(
                  'portableHistory.identity.redactedNote',
                  'Identidad redactada: activa el consentimiento de exportación para liberar nombre y RUT.',
                )}
              </p>
            )}
          </Section>

          {/* Trainings */}
          <Section
            title={t('portableHistory.section.trainings', 'Capacitaciones')}
            icon={<GraduationCap className="w-4 h-4" aria-hidden="true" />}
            testId="portable-history-section-trainings"
            count={bundle.trainings.length}
          >
            {bundle.trainings.length === 0 ? (
              <p className="text-xs text-secondary-token">
                {t('portableHistory.trainings.empty', 'Sin capacitaciones registradas.')}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {bundle.trainings.slice(0, 50).map((tr) => (
                  <li
                    key={tr.id}
                    className="flex justify-between gap-3 text-primary-token"
                  >
                    <span className="truncate">
                      {tr.trainingName || tr.trainingCode || tr.id}
                    </span>
                    <span className="text-secondary-token text-xs whitespace-nowrap">
                      {tr.obtainedAt ? tr.obtainedAt.slice(0, 10) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* EPP */}
          <Section
            title={t('portableHistory.section.epp', 'Entregas de EPP')}
            icon={<HardHat className="w-4 h-4" aria-hidden="true" />}
            testId="portable-history-section-epp"
            count={bundle.eppDeliveries.length}
          >
            {bundle.eppDeliveries.length === 0 ? (
              <p className="text-xs text-secondary-token">
                {t('portableHistory.epp.empty', 'Sin entregas de EPP registradas.')}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {bundle.eppDeliveries.slice(0, 50).map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between gap-3 text-primary-token"
                  >
                    <span className="truncate">
                      {e.eppCategory || e.eppModel || e.id}
                    </span>
                    <span className="text-secondary-token text-xs whitespace-nowrap">
                      {e.deliveredAt ? e.deliveredAt.slice(0, 10) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Aptitudes médicas */}
          <Section
            title={t('portableHistory.section.aptitudes', 'Aptitudes médicas')}
            icon={<Stethoscope className="w-4 h-4" aria-hidden="true" />}
            testId="portable-history-section-aptitudes"
            count={bundle.aptitudes.length}
          >
            {bundle.aptitudes.length === 0 ? (
              <p className="text-xs text-secondary-token">
                {t('portableHistory.aptitudes.empty', 'Sin aptitudes médicas registradas.')}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {bundle.aptitudes.slice(0, 50).map((a) => (
                  <li
                    key={a.id}
                    className="flex justify-between gap-3 text-primary-token"
                  >
                    <span className="truncate">
                      {a.category || a.id} {a.status ? `(${a.status})` : ''}
                    </span>
                    <span className="text-secondary-token text-xs whitespace-nowrap">
                      {a.recordedAt ? a.recordedAt.slice(0, 10) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Critical roles */}
          <Section
            title={t('portableHistory.section.criticalRoles', 'Roles críticos')}
            icon={<Crown className="w-4 h-4" aria-hidden="true" />}
            testId="portable-history-section-critical-roles"
            count={bundle.criticalRoles.length}
          >
            {bundle.criticalRoles.length === 0 ? (
              <p className="text-xs text-secondary-token">
                {t('portableHistory.criticalRoles.empty', 'Sin roles críticos registrados.')}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {bundle.criticalRoles.slice(0, 50).map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between gap-3 text-primary-token"
                  >
                    <span className="truncate">
                      {r.roleName || r.roleCode || r.id}
                    </span>
                    <span className="text-secondary-token text-xs whitespace-nowrap">
                      {r.startedAt ? r.startedAt.slice(0, 10) : '—'}
                      {r.endedAt ? ` → ${r.endedAt.slice(0, 10)}` : ' → activo'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Signatures (DDR/ODI/RIOHS) */}
          <Section
            title={t('portableHistory.section.signatures', 'Firmas DDR/ODI/RIOHS')}
            icon={<PenTool className="w-4 h-4" aria-hidden="true" />}
            testId="portable-history-section-signatures"
            count={bundle.signatures.length}
          >
            {bundle.signatures.length === 0 ? (
              <p className="text-xs text-secondary-token">
                {t('portableHistory.signatures.empty', 'Sin firmas registradas.')}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {bundle.signatures.slice(0, 50).map((s) => (
                  <li
                    key={s.id}
                    className="flex justify-between gap-3 text-primary-token"
                  >
                    <span className="truncate">
                      {s.documentTitle || s.documentKind || s.id}
                    </span>
                    <span className="text-secondary-token text-xs whitespace-nowrap">
                      {s.signedAt ? s.signedAt.slice(0, 10) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Incidents — only if consent.includesIncidents */}
          {bundle.consent.includesIncidents && (
            <Section
              title={t('portableHistory.section.incidents', 'Incidentes')}
              icon={<AlertOctagon className="w-4 h-4" aria-hidden="true" />}
              testId="portable-history-section-incidents"
              count={bundle.incidents.length}
            >
              {bundle.incidents.length === 0 ? (
                <p className="text-xs text-secondary-token">
                  {t('portableHistory.incidents.empty', 'Sin incidentes registrados.')}
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {bundle.incidents.slice(0, 50).map((i) => (
                    <li
                      key={i.id}
                      className="flex justify-between gap-3 text-primary-token"
                    >
                      <span className="truncate">
                        {i.category || i.id}
                        {i.severity ? ` · ${i.severity}` : ''}
                      </span>
                      <span className="text-secondary-token text-xs whitespace-nowrap">
                        {i.occurredAt ? i.occurredAt.slice(0, 10) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Export buttons */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
            data-testid="portable-history-export"
          >
            <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
              {t('portableHistory.export.title', 'Exportar mi historial')}
            </h2>
            <p className="text-xs text-secondary-token">
              {t(
                'portableHistory.export.note',
                'Sólo disponible cuando el consentimiento de exportación está activo. Cada archivo incluye un checksum SHA-256 para verificar integridad.',
              )}
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleExport('json')}
                disabled={!exportEnabled}
                className="flex items-center gap-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-4 py-2"
                data-testid="portable-history-export-json"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                {t('portableHistory.export.json', 'Exportar a JSON')}
              </button>
              <button
                type="button"
                onClick={() => handleExport('pdf')}
                disabled={!exportEnabled}
                className="flex items-center gap-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-4 py-2"
                data-testid="portable-history-export-pdf"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                {t('portableHistory.export.pdf', 'Exportar a PDF')}
              </button>
            </div>
            {!exportEnabled && bundle && !bundle.consent.allowsPortableExport && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t(
                  'portableHistory.export.consentBlocked',
                  'Activa el consentimiento de exportación y guarda para habilitar la descarga.',
                )}
              </p>
            )}
          </section>

          {previewData && (
            <PortableHistoryPreview
              history={previewData.history}
              serialized={previewData.serialized}
              onDownload={() => handleExport('json')}
            />
          )}

          <p className="text-[11px] text-secondary-token italic mt-2">
            {bundle.disclaimer}
          </p>
        </>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  testId: string;
  count?: number;
  children: React.ReactNode;
}

function Section({ title, icon, testId, count, children }: SectionProps) {
  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 space-y-2"
      data-testid={testId}
    >
      <header className="flex items-center gap-2">
        <span className="text-blue-500">{icon}</span>
        <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
          {title}
        </h2>
        {typeof count === 'number' && (
          <span className="ml-auto text-xs text-secondary-token font-mono">
            {count}
          </span>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}
