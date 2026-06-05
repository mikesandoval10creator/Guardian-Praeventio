// Praeventio Guard — Wire-orphan Bloque 3 §3.7: <PortalManager />.
//
// Admin panel para gestionar portales de auditor externo. CRUD completo:
//   - Tabla de portales activos / expirados / revocados con badge de estado.
//   - Botón "Crear portal" → diálogo con auditor name, afiliación, scope
//     (projectIds + módulos), TTL en días.
//   - Tras crear, una banda destacada muestra el token plaintext UNA SOLA
//     VEZ (visible ~60s o hasta cerrar). El operador debe copiar+pegar.
//   - Cada fila tiene "Revocar" (pide motivo ≥10 chars) y "Ver accesos"
//     (expande el log de acceso del portal).
//
// Tailwind, paleta teal preferida del usuario + dark mode.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  ShieldX,
  Clock,
  Plus,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  Copy,
  X,
} from 'lucide-react';
import type {
  AuditModule,
  AuditorAffiliation,
} from '../../services/auditPortal/externalAuditPortal';
import {
  createExternalAuditPortal,
  listExternalAuditPortals,
  revokeExternalAuditPortal,
  getExternalAuditPortalAccessLog,
  type AdminPortalView,
  type AdminPortalCreatedView,
  type PortalAccessLogEntry,
} from '../../hooks/useExternalAuditPortal';
import { randomId } from '../../utils/randomId';

interface PortalManagerProps {
  /** Project ids that can be assigned in scope. Provided by parent dashboard. */
  availableProjectIds: string[];
  /** Optional polling interval in ms. Default 0 (manual refresh only). */
  pollIntervalMs?: number;
}

const STATUS_META: Record<
  AdminPortalView['status'],
  { label: string; tone: string; Icon: typeof ShieldCheck }
> = {
  active: {
    label: 'Activo',
    tone: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800',
    Icon: ShieldCheck,
  },
  expired: {
    label: 'Expirado',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
    Icon: Clock,
  },
  revoked: {
    label: 'Revocado',
    tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800',
    Icon: ShieldX,
  },
};

const AFFILIATIONS: readonly AuditorAffiliation[] = [
  'mandante',
  'suseso',
  'mutualidad',
  'iso',
  'seremi',
  'dt',
  'cliente',
  'other',
];

const MODULES: readonly AuditModule[] = [
  'documents',
  'iper_matrix',
  'trainings',
  'epp',
  'incidents',
  'corrective_actions',
  'evidences',
  'compliance_snapshot',
];

const MODULE_LABEL: Record<AuditModule, string> = {
  documents: 'Documentos',
  iper_matrix: 'Matriz IPER',
  trainings: 'Capacitaciones',
  epp: 'EPP',
  incidents: 'Incidentes',
  corrective_actions: 'Acciones correctivas',
  evidences: 'Evidencias',
  compliance_snapshot: 'Cumplimiento',
};

const AFFILIATION_LABEL: Record<AuditorAffiliation, string> = {
  mandante: 'Mandante',
  suseso: 'SUSESO',
  mutualidad: 'Mutualidad',
  iso: 'Certificadora ISO',
  seremi: 'SEREMI',
  dt: 'Dirección del Trabajo',
  cliente: 'Cliente',
  other: 'Otro',
};

export function PortalManager({
  availableProjectIds,
  pollIntervalMs = 0,
}: PortalManagerProps) {
  const [portals, setPortals] = useState<AdminPortalView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [oneTimeToken, setOneTimeToken] = useState<{
    portal: AdminPortalCreatedView;
    revealed: boolean;
  } | null>(null);
  const [revokeFor, setRevokeFor] = useState<AdminPortalView | null>(null);
  const [accessLogFor, setAccessLogFor] = useState<string | null>(null);
  const [accessLog, setAccessLog] = useState<PortalAccessLogEntry[]>([]);
  const [accessLogLoading, setAccessLogLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { portals: rows } = await listExternalAuditPortals({ limit: 100 });
      setPortals(rows);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [pollIntervalMs, refresh]);

  const counters = useMemo(() => {
    const c = { active: 0, expired: 0, revoked: 0 } as Record<
      AdminPortalView['status'],
      number
    >;
    for (const p of portals) c[p.status] += 1;
    return c;
  }, [portals]);

  const openAccessLog = useCallback(
    async (portalId: string) => {
      if (accessLogFor === portalId) {
        setAccessLogFor(null);
        setAccessLog([]);
        return;
      }
      setAccessLogFor(portalId);
      setAccessLog([]);
      setAccessLogLoading(true);
      try {
        const { logs } = await getExternalAuditPortalAccessLog(portalId, {
          limit: 100,
        });
        setAccessLog(logs);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setAccessLogLoading(false);
      }
    },
    [accessLogFor],
  );

  return (
    <section
      className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4 shadow-sm"
      data-testid="portalManager.root"
      aria-label="Gestor de portales de auditor externo"
    >
      <header className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
          Portales de auditor externo
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          SUSESO / ISP / mutualidad / mandante — acceso de solo lectura por
          tiempo acotado.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            data-testid="portalManager.refresh"
            className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            data-testid="portalManager.openCreate"
            className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            Crear portal
          </button>
        </div>
      </header>

      <dl
        className="grid grid-cols-3 gap-2"
        data-testid="portalManager.counters"
      >
        {(Object.keys(STATUS_META) as AdminPortalView['status'][]).map((k) => {
          const meta = STATUS_META[k];
          return (
            <div
              key={k}
              className={`rounded-lg border px-3 py-2 ${meta.tone}`}
              data-testid={`portalManager.count.${k}`}
            >
              <dt className="text-[10px] uppercase tracking-wider font-bold">
                {meta.label}
              </dt>
              <dd className="text-xl font-bold tabular-nums">{counters[k]}</dd>
            </div>
          );
        })}
      </dl>

      {error && (
        <p
          className="text-xs text-rose-600 dark:text-rose-400"
          role="alert"
          data-testid="portalManager.error"
        >
          {error}
        </p>
      )}

      {oneTimeToken && (
        <OneTimeTokenBanner
          portal={oneTimeToken.portal}
          revealed={oneTimeToken.revealed}
          onToggleReveal={() =>
            setOneTimeToken({
              portal: oneTimeToken.portal,
              revealed: !oneTimeToken.revealed,
            })
          }
          onDismiss={() => setOneTimeToken(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          data-testid="portalManager.table"
        >
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
              <th className="py-2 pr-3 font-medium">Auditor</th>
              <th className="py-2 pr-3 font-medium">Afiliación</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 pr-3 font-medium">Vence</th>
              <th className="py-2 pr-3 font-medium">Módulos</th>
              <th className="py-2 pr-3 font-medium">Proyectos</th>
              <th className="py-2 pr-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {portals.length === 0 && !loading && (
              <tr data-testid="portalManager.empty">
                <td
                  colSpan={7}
                  className="py-6 text-center text-zinc-500 dark:text-zinc-400 text-xs"
                >
                  Aún no hay portales de auditor.
                </td>
              </tr>
            )}
            {portals.map((p) => {
              const meta = STATUS_META[p.status];
              const { Icon } = meta;
              const isExpanded = accessLogFor === p.id;
              return (
                <>
                  <tr
                    key={p.id}
                    className="border-b border-zinc-100 dark:border-zinc-800"
                    data-testid={`portalManager.row.${p.id}`}
                  >
                    <td className="py-2 pr-3 font-medium text-zinc-800 dark:text-zinc-100">
                      {p.auditorName}
                    </td>
                    <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300 text-xs">
                      {AFFILIATION_LABEL[p.auditorAffiliation]}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border ${meta.tone}`}
                        data-testid={`portalManager.row.${p.id}.status`}
                      >
                        <Icon className="w-3 h-3" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-zinc-500 dark:text-zinc-400 text-xs">
                      {new Date(p.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-3 text-zinc-500 dark:text-zinc-400 text-xs tabular-nums">
                      {p.scopeModules.length}
                    </td>
                    <td className="py-2 pr-3 text-zinc-500 dark:text-zinc-400 text-xs tabular-nums">
                      {p.scopeProjectIds.length}
                    </td>
                    <td className="py-2 pr-3 flex gap-1">
                      <button
                        type="button"
                        onClick={() => void openAccessLog(p.id)}
                        data-testid={`portalManager.row.${p.id}.viewLog`}
                        className="text-[11px] font-medium px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        {isExpanded ? 'Ocultar log' : 'Ver log'}
                      </button>
                      {p.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => setRevokeFor(p)}
                          data-testid={`portalManager.row.${p.id}.revoke`}
                          className="text-[11px] font-medium px-2 py-1 rounded border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                        >
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr
                      key={`${p.id}-log`}
                      data-testid={`portalManager.row.${p.id}.log`}
                    >
                      <td
                        colSpan={7}
                        className="bg-zinc-50 dark:bg-zinc-800/40 p-3"
                      >
                        <AccessLogPanel
                          logs={accessLog}
                          loading={accessLogLoading}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {createDialogOpen && (
        <CreatePortalDialog
          availableProjectIds={availableProjectIds}
          onClose={() => setCreateDialogOpen(false)}
          onCreated={(view) => {
            setOneTimeToken({ portal: view, revealed: false });
            setCreateDialogOpen(false);
            void refresh();
          }}
        />
      )}

      {revokeFor && (
        <RevokeDialog
          portal={revokeFor}
          onClose={() => setRevokeFor(null)}
          onRevoked={() => {
            setRevokeFor(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// One-time token banner — shows the plaintext token EXACTLY ONCE
// ────────────────────────────────────────────────────────────────────────

function OneTimeTokenBanner({
  portal,
  revealed,
  onToggleReveal,
  onDismiss,
}: {
  portal: AdminPortalCreatedView;
  revealed: boolean;
  onToggleReveal: () => void;
  onDismiss: () => void;
}) {
  const url = `${window.location.origin}/audit-portal/${portal.oneTimeAccessToken}`;
  const masked = portal.oneTimeAccessToken.slice(0, 8) + '…';
  return (
    <div
      className="rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-2"
      role="alert"
      data-testid="portalManager.oneTimeBanner"
    >
      <header className="flex items-center gap-2">
        <AlertTriangle
          className="w-4 h-4 text-amber-700 dark:text-amber-300"
          aria-hidden="true"
        />
        <h3 className="text-sm font-bold text-amber-900 dark:text-amber-100">
          Token único para {portal.auditorName}
        </h3>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/40"
          data-testid="portalManager.oneTimeBanner.dismiss"
          aria-label="Cerrar"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </header>
      <p className="text-xs text-amber-800 dark:text-amber-200">
        Este token se muestra una sola vez. Cópialo y entrégalo al auditor
        externo por un canal seguro. Después de cerrar, no podrás recuperarlo
        (revoca y crea uno nuevo si lo pierdes).
      </p>
      <div className="flex items-center gap-2">
        <code
          className="font-mono text-[11px] bg-white dark:bg-zinc-900 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 flex-1 truncate"
          data-testid="portalManager.oneTimeBanner.token"
        >
          {revealed ? portal.oneTimeAccessToken : masked}
        </code>
        <button
          type="button"
          onClick={onToggleReveal}
          className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-800/40"
          data-testid="portalManager.oneTimeBanner.reveal"
        >
          {revealed ? (
            <EyeOff className="w-3 h-3" aria-hidden="true" />
          ) : (
            <Eye className="w-3 h-3" aria-hidden="true" />
          )}
          {revealed ? 'Ocultar' : 'Mostrar'}
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
          }}
          className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-800/40"
          data-testid="portalManager.oneTimeBanner.copy"
        >
          <Copy className="w-3 h-3" aria-hidden="true" />
          Copiar URL
        </button>
      </div>
      <p className="text-[11px] text-amber-700 dark:text-amber-300 break-all">
        URL: {url}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Create dialog
// ────────────────────────────────────────────────────────────────────────

function CreatePortalDialog({
  availableProjectIds,
  onClose,
  onCreated,
}: {
  availableProjectIds: string[];
  onClose: () => void;
  onCreated: (view: AdminPortalCreatedView) => void;
}) {
  const [auditorName, setAuditorName] = useState('');
  const [affiliation, setAffiliation] = useState<AuditorAffiliation>('suseso');
  const [auditorEmail, setAuditorEmail] = useState('');
  const [scopeProjects, setScopeProjects] = useState<string[]>(
    availableProjectIds.slice(0, 1),
  );
  const [scopeModules, setScopeModules] = useState<AuditModule[]>([
    'documents',
    'iper_matrix',
    'incidents',
  ]);
  const [ttlDays, setTtlDays] = useState(14);
  const [internalNotes, setInternalNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // B17 (directiva #15): id de portal con `randomId()` (crypto.randomUUID
      // con fallback) en vez de Math.random — sin colisiones / no predecible.
      const portalId = `ap_${Date.now().toString(36)}_${randomId()}`;
      const { portal } = await createExternalAuditPortal(
        {
          id: portalId,
          auditorName,
          auditorAffiliation: affiliation,
          auditorEmail: auditorEmail.trim() || undefined,
          scopeProjectIds: scopeProjects,
          scopeModules,
          ttlDays,
          internalNotes: internalNotes.trim() || undefined,
        },
        { idempotencyKey: portalId },
      );
      onCreated(portal);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crear portal de auditor externo"
      data-testid="portalManager.createDialog"
    >
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <header className="flex items-center gap-2">
          <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
            Crear portal de auditor externo
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Cerrar"
            data-testid="portalManager.createDialog.close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <Field label="Nombre del auditor (mín. 3 caracteres)">
          <input
            type="text"
            value={auditorName}
            onChange={(e) => setAuditorName(e.target.value)}
            data-testid="portalManager.createDialog.auditorName"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100"
          />
        </Field>

        <Field label="Afiliación">
          <select
            value={affiliation}
            onChange={(e) =>
              setAffiliation(e.target.value as AuditorAffiliation)
            }
            data-testid="portalManager.createDialog.affiliation"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {AFFILIATIONS.map((a) => (
              <option key={a} value={a}>
                {AFFILIATION_LABEL[a]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Email del auditor (opcional)">
          <input
            type="email"
            value={auditorEmail}
            onChange={(e) => setAuditorEmail(e.target.value)}
            data-testid="portalManager.createDialog.email"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100"
          />
        </Field>

        <Field label="TTL en días (1-90)">
          <input
            type="number"
            min={1}
            max={90}
            value={ttlDays}
            onChange={(e) =>
              setTtlDays(
                Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)),
              )
            }
            data-testid="portalManager.createDialog.ttlDays"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100 tabular-nums"
          />
        </Field>

        <Field label="Proyectos en alcance">
          <div
            className="space-y-1 max-h-32 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg p-2"
            data-testid="portalManager.createDialog.projects"
          >
            {availableProjectIds.length === 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Sin proyectos disponibles
              </p>
            )}
            {availableProjectIds.map((pid) => (
              <label
                key={pid}
                className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={scopeProjects.includes(pid)}
                  onChange={() => {
                    setScopeProjects((prev) =>
                      prev.includes(pid)
                        ? prev.filter((x) => x !== pid)
                        : [...prev, pid],
                    );
                  }}
                  data-testid={`portalManager.createDialog.project.${pid}`}
                  className="accent-teal-600"
                />
                {pid}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Módulos en alcance">
          <div className="grid grid-cols-2 gap-1">
            {MODULES.map((m) => (
              <label
                key={m}
                className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={scopeModules.includes(m)}
                  onChange={() => {
                    setScopeModules((prev) =>
                      prev.includes(m)
                        ? prev.filter((x) => x !== m)
                        : [...prev, m],
                    );
                  }}
                  data-testid={`portalManager.createDialog.module.${m}`}
                  className="accent-teal-600"
                />
                {MODULE_LABEL[m]}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Notas internas (no visibles al auditor)">
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={2}
            data-testid="portalManager.createDialog.notes"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100"
          />
        </Field>

        {error && (
          <p
            className="text-xs text-rose-600 dark:text-rose-400"
            role="alert"
            data-testid="portalManager.createDialog.error"
          >
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              submitting ||
              auditorName.trim().length < 3 ||
              scopeProjects.length === 0 ||
              scopeModules.length === 0
            }
            data-testid="portalManager.createDialog.submit"
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 disabled:opacity-50"
          >
            {submitting ? 'Creando…' : 'Crear portal'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Revoke dialog
// ────────────────────────────────────────────────────────────────────────

function RevokeDialog({
  portal,
  onClose,
  onRevoked,
}: {
  portal: AdminPortalView;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await revokeExternalAuditPortal(
        { portalId: portal.id, reason },
        { idempotencyKey: `revoke-${portal.id}` },
      );
      onRevoked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Revocar portal ${portal.auditorName}`}
      data-testid="portalManager.revokeDialog"
    >
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4">
        <header className="flex items-center gap-2">
          <ShieldX
            className="w-4 h-4 text-rose-600 dark:text-rose-400"
            aria-hidden="true"
          />
          <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
            Revocar portal
          </h3>
        </header>
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          Esta acción es irreversible — el token de {portal.auditorName}{' '}
          dejará de funcionar inmediatamente.
        </p>
        <Field label="Motivo (mínimo 10 caracteres)">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            data-testid="portalManager.revokeDialog.reason"
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100"
          />
        </Field>
        {error && (
          <p
            className="text-xs text-rose-600 dark:text-rose-400"
            role="alert"
            data-testid="portalManager.revokeDialog.error"
          >
            {error}
          </p>
        )}
        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || reason.trim().length < 10}
            data-testid="portalManager.revokeDialog.submit"
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600 disabled:opacity-50"
          >
            {submitting ? 'Revocando…' : 'Confirmar revocación'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Access log panel
// ────────────────────────────────────────────────────────────────────────

function AccessLogPanel({
  logs,
  loading,
}: {
  logs: PortalAccessLogEntry[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
        Cargando log…
      </p>
    );
  }
  if (logs.length === 0) {
    return (
      <p
        className="text-xs text-zinc-500 dark:text-zinc-400"
        data-testid="portalManager.accessLog.empty"
      >
        Sin accesos registrados aún.
      </p>
    );
  }
  return (
    <table className="w-full text-xs" data-testid="portalManager.accessLog">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          <th className="py-1 pr-3 font-medium">Fecha</th>
          <th className="py-1 pr-3 font-medium">Módulo</th>
          <th className="py-1 pr-3 font-medium">Descarga</th>
          <th className="py-1 pr-3 font-medium">IP</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((l) => (
          <tr
            key={l.accessedAt}
            className="border-t border-zinc-200 dark:border-zinc-700"
          >
            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200 tabular-nums">
              {new Date(l.accessedAt).toLocaleString()}
            </td>
            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">
              {MODULE_LABEL[l.module] ?? l.module}
            </td>
            <td className="py-1 pr-3">
              {l.downloaded ? (
                <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300">
                  SÍ
                </span>
              ) : (
                <span className="text-[10px] text-zinc-500">no</span>
              )}
            </td>
            <td className="py-1 pr-3 text-zinc-500 dark:text-zinc-400 font-mono text-[10px]">
              {l.ip ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ────────────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
